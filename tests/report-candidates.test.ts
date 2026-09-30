import { gate, stub, tag } from "./setup.ts";
// A selected item released across the 08:00 boundary must appear in the next issue exactly once.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle, publishArticleTx } from "@aihot/backend/publication/publish";
import { candidates, composeDaily, composeWeekly, composeMonthly } from "@aihot/backend/reports/compose";

const T = tag();
const SOURCE = `test-report-boundary-${T}`;
const provider = await stub((hit) => ({
  id: `report-boundary-${T}-${hit}`,
  choices: [{ message: { content: JSON.stringify({ title: "测试导语", leadParagraph: "测试摘要", highlights: [1], headline: "历史汇编", overview: "实际已取得材料的阶段汇总", themes: [{ heading: "技术进展", summary: "来源日期归档", refs: [1] }] }) } }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
}));
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES (${SOURCE}, 'Report boundary test', 'rss', 'T1', 'editorial', '2100-01-01')`;
});

test("historical weekly and monthly reports include backfills and respect an explicit cutoff", async () => {
  const inside = await selected("period-archive", "2020-02-11T12:00:00Z", "2020-03-01T12:00:00Z");
  const later = await selected("period-later", "2020-02-13T12:00:00Z", "2020-03-01T12:00:00Z");
  const hidden = await selected("period-withdrawn", "2020-02-11T13:00:00Z", "2020-03-01T12:00:00Z");
  await sql`UPDATE publications SET backfill=true WHERE article_id IN ${sql([inside,later,hidden])}`;
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${hidden}`;
  const asOf = new Date("2020-02-12T12:00:00Z");
  await assert.rejects(composeWeekly("2020-W07", "invalid cutoff", { asOf }), /historical period/);
  await composeWeekly("2020-W07");
  await composeWeekly("2020-W07", "historical refresh", { historical:true,asOf });
  await composeMonthly("2020-02", "historical refresh", { historical:true,asOf });
  for (const kind of ["weekly","monthly"]) {
    const [r] = await sql`SELECT id,revision,content,window_end FROM reports WHERE kind=${kind} AND key=${kind==="weekly"?"2020-W07":"2020-02"}`;
    assert.ok(r!.content.storyOrder.includes(inside));
    assert.ok(!r!.content.storyOrder.includes(later));
    assert.ok(!r!.content.storyOrder.includes(hidden));
    assert.equal(r!.window_end.toISOString(),asOf.toISOString());
    assert.equal(r!.content.periodEnd,"2020-02-12");
    assert.equal(r!.content.generator.attribution,"source-published-at");
    assert.equal(r!.content.generator.asOf,asOf.toISOString());
    if(kind==="weekly") {
      assert.equal(r!.revision,2);
      const [old] = await sql`SELECT content FROM report_revisions WHERE report_id=${r!.id} AND revision=1`;
      assert.equal(old!.content.metrics.selectedCount,0);
    }
  }
});
after(async () => {
  await sql`DELETE FROM reports WHERE (kind='weekly' AND key='2020-W07') OR (kind='monthly' AND key='2020-02')`;
  await sql`DELETE FROM reports WHERE kind = 'daily' AND key IN ('2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05', '2020-02-02', '2020-02-03')`;
  await provider.close();
  await stopBoss();
  await closeDb();
});

test("explicit historical editions use source dates, retain selection and preserve the old revision", async () => {
  const id = await selected("archive", "2020-02-01T12:00:00Z", "2020-03-01T12:00:00Z");
  const hidden = await selected("archive-hidden", "2020-02-01T13:00:00Z", "2020-03-01T12:00:00Z");
  const notSelected = await selected("archive-not-selected", "2020-02-01T14:00:00Z", "2020-03-01T12:00:00Z");
  await sql`UPDATE publications SET backfill=true WHERE article_id IN ${sql([id, hidden, notSelected])}`;
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${hidden}`;
  await sql`UPDATE publications SET selected=false WHERE article_id=${notSelected}`;
  const start = new Date("2020-02-01T00:00:00Z"), end = new Date("2020-02-02T00:00:00Z");
  assert.equal((await candidates(start, end)).length, 0);
  const archive = await candidates(start, end, true);
  assert.deepEqual(archive.map((c) => c.itemId), [id]);
  assert.equal(archive[0]!.publishedAt, "2020-02-01T12:00:00.000Z");
  assert.equal((await candidates(end, new Date("2020-02-03T00:00:00Z"), true)).length, 0);
  const duplicate = await selected("archive-duplicate", "2020-02-01T15:00:00Z", "2020-03-01T12:00:00Z");
  await sql`UPDATE publications SET backfill=true WHERE article_id=${duplicate}`;
  await assert.rejects(composeDaily("2020-02-02", "bad override", { duplicateItemIds: [duplicate] }), /only supported/);
  await composeDaily("2020-02-02");
  await composeDaily("2020-02-02", "test historical backfill", { historical: true, duplicateItemIds: [duplicate] });
  const [report] = await sql`SELECT id,revision,content FROM reports WHERE kind='daily' AND key='2020-02-02'`;
  assert.equal(report!.revision, 2);
  assert.equal(report!.content.generator.attribution, "source-published-at");
  assert.equal(report!.content.metrics.totalEvents, 1);
  assert.deepEqual(report!.content.generator.duplicateItemIds, [duplicate]);
  const [duplicatePublication] = await sql`SELECT selected,visibility FROM publications WHERE article_id=${duplicate}`;
  assert.equal(duplicatePublication!.selected, true);
  assert.equal(duplicatePublication!.visibility, "public");
  const [prior] = await sql`SELECT content FROM report_revisions WHERE report_id=${report!.id} AND revision=1`;
  assert.equal(prior!.content.metrics.totalEvents, 0);
  const hits = provider.hits();
  await composeDaily("2020-02-03", "test empty historical backfill", { historical: true });
  assert.equal(provider.hits(), hits + 1);
  const [empty] = await sql`SELECT content FROM reports WHERE kind='daily' AND key='2020-02-03'`;
  assert.ok(empty!.content.lead);
  assert.deepEqual(empty!.content.highlights, []);
  assert.equal(empty!.content.metrics.totalEvents, 0);
});

async function analyzed(label: string, timelineAt: string): Promise<string> {
  const { articleId, backfill } = await upsertMaterial({
    sourceId: SOURCE,
    url: `https://example.com/report-boundary-${T}-${label}`,
    title: `Report boundary ${label}`,
    bodyText: `Report boundary ${label} body`,
    bodyStatus: "ok",
    publishedAt: new Date(timelineAt),
    discoveredAt: new Date(timelineAt),
    via: "fetch",
  });
  assert.equal(backfill, false);
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
            VALUES (${articleId}, 1, 'rule', 'pass', 'ai-film', ${`标题 ${label}`}, ${`摘要 ${label}`}, 90, true)`;
  return articleId;
}

async function selected(label: string, timelineAt: string, releasedAt: string): Promise<string> {
  const articleId = await analyzed(label, timelineAt);
  const published = await publishArticle(articleId, { now: new Date(releasedAt), releasedAt: new Date(releasedAt) });
  assert.equal(published?.selected, true);
  return articleId;
}

test("reports assign delayed and boundary releases to the period readers first see them", async () => {
  const onTime = await selected("on-time", "2020-01-01T23:58:00Z", "2020-01-01T23:59:00Z");
  const delayed = await selected("delayed", "2020-01-01T23:59:00Z", "2020-01-02T00:02:00Z");
  const atBoundary = await selected("at-boundary", "2020-01-01T23:59:00Z", "2020-01-02T00:00:00Z");
  const groupedBefore = await analyzed("grouped-before", "2020-01-01T23:58:00Z");
  await publishArticle(groupedBefore, { now: new Date("2020-01-01T23:58:00Z") });
  await sql`UPDATE articles SET grouped_at = ${new Date("2020-01-01T23:59:00Z")} WHERE id = ${groupedBefore}`;
  await publishArticle(groupedBefore, { now: new Date("2020-01-01T23:59:10Z") });
  const groupedLate = await analyzed("grouped-late", "2020-01-01T23:58:00Z");
  await publishArticle(groupedLate, { now: new Date("2020-01-01T23:58:00Z") }); // gated until 08:01
  await sql`UPDATE articles SET grouped_at = ${new Date("2020-01-01T23:59:50Z")} WHERE id = ${groupedLate}`;
  const boundary = new Date("2020-01-02T00:00:00Z"); // 08:00 Beijing
  const previous = new Set((await candidates(new Date("2020-01-01T00:00:00Z"), boundary)).map((c) => c.itemId));

  assert.equal(previous.has(onTime), true);
  assert.equal(previous.has(groupedBefore), true);
  for (const id of [delayed, atBoundary, groupedLate]) assert.equal(previous.has(id), false);

  await composeDaily("2020-01-02");
  await publishArticle(groupedLate, { now: new Date("2020-01-02T00:00:10Z") });
  const [release] = await sql<{ visible_after: Date }[]>`SELECT visible_after FROM publications WHERE article_id = ${groupedLate}`;
  assert.equal(release!.visible_after.toISOString(), "2020-01-02T00:00:10.000Z");
  const next = new Set((await candidates(boundary, new Date("2020-01-03T00:00:00Z"))).map((c) => c.itemId));
  assert.equal(next.has(onTime), false);
  assert.equal(next.has(groupedBefore), false);
  for (const id of [delayed, atBoundary, groupedLate]) assert.equal(next.has(id), true);
  await composeDaily("2020-01-03");
  const reports = await sql<{ key: string; content: { sections: Array<{ items: Array<{ itemId: string }> }> } }[]>`
    SELECT key, content FROM reports WHERE kind = 'daily' AND key IN ('2020-01-02', '2020-01-03')`;
  const items = (key: string) => new Set(reports.find((r) => r.key === key)!.content.sections.flatMap((s) => s.items.map((i) => i.itemId)));
  assert.equal(items("2020-01-02").has(onTime), true);
  assert.equal(items("2020-01-02").has(groupedBefore), true);
  assert.equal(items("2020-01-02").has(delayed), false);
  assert.equal(items("2020-01-02").has(atBoundary), false);
  assert.equal(items("2020-01-02").has(groupedLate), false);
  assert.equal(items("2020-01-03").has(onTime), false);
  assert.equal(items("2020-01-03").has(groupedBefore), false);
  assert.equal(items("2020-01-03").has(delayed), true);
  assert.equal(items("2020-01-03").has(atBoundary), true);
  assert.equal(items("2020-01-03").has(groupedLate), true);
});

/** Observe an actual PostgreSQL lock wait before advancing the clock or releasing the transaction. */
async function waitForBlocked(blocker: number, operation: Promise<unknown>) {
  const deadline = performance.now() + 5_000;
  while (!(await sql`SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`)[0]) {
    if (performance.now() >= deadline) assert.fail("operation did not wait for the held transaction");
    await Promise.race([operation.then(() => assert.fail("operation finished before the held transaction committed")), delay(10)]);
  }
}

for (const lock of ["article", "report snapshot"] as const) {
  test(`a release waiting for the ${lock} lock uses the time after the cutoff`, async (t) => {
    const id = await analyzed(`waiting-${lock}`, "2020-01-01T23:58:00Z");
    await publishArticle(id, { now: new Date("2020-01-01T23:58:00Z") });
    await sql`UPDATE articles SET grouped_at = ${new Date("2020-01-01T23:59:00Z")} WHERE id = ${id}`;
    const acquired = gate<number>();
    const release = gate();
    const holding = sql.begin(async (tx) => {
      if (lock === "article") await tx`SELECT 1 FROM articles WHERE id = ${id} FOR UPDATE`;
      else await tx`SELECT pg_advisory_xact_lock(hashtext('report_candidates'))`;
      const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      acquired.open(row!.pid);
      await release.promise;
    });
    let publication: Promise<unknown> | undefined;
    try {
      const pid = await Promise.race([acquired.promise, holding.then(() => assert.fail("lock holder exited before acquiring its lock"))]);
      t.mock.timers.enable({ apis: ["Date"], now: new Date("2020-01-01T23:59:59Z") });
      publication = publishArticle(id);
      await waitForBlocked(pid, publication);
      t.mock.timers.setTime(new Date("2020-01-02T00:00:10Z").getTime());
      release.open();
      await holding;
      await publication;

      const [published] = await sql<{ visible_after: Date; visible_at: Date }[]>`
        SELECT p.visible_after, l.visible_at FROM publications p JOIN selected_ledger l ON l.article_id = p.article_id
        WHERE p.article_id = ${id} ORDER BY l.seq DESC LIMIT 1`;
      assert.equal(published!.visible_after.toISOString(), "2020-01-02T00:00:10.000Z");
      assert.equal(published!.visible_at.toISOString(), published!.visible_after.toISOString());
      const boundary = new Date("2020-01-02T00:00:00Z");
      assert.equal((await candidates(new Date("2020-01-01T00:00:00Z"), boundary)).some((c) => c.itemId === id), false);
      assert.equal((await candidates(boundary, new Date("2020-01-03T00:00:00Z"))).some((c) => c.itemId === id), true);
    } finally {
      release.open();
      await Promise.allSettled([holding, publication]);
    }
  });
}

test("daily composition waits for a pre-cutoff release to commit instead of losing it between issues", async (t) => {
  const id = await analyzed("commit-after-cutoff", "2020-01-03T23:58:00Z");
  await publishArticle(id, { now: new Date("2020-01-03T23:58:00Z") });
  await sql`UPDATE articles SET grouped_at = ${new Date("2020-01-03T23:59:00Z")} WHERE id = ${id}`;
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2020-01-03T23:59:59Z") });
  const written = gate<number>();
  const commit = gate();
  const publication = sql.begin(async (tx) => {
    await publishArticleTx(tx, id);
    const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    written.open(row!.pid);
    await commit.promise;
  });
  let report: ReturnType<typeof composeDaily> | undefined;
  try {
    const pid = await Promise.race([written.promise, publication.then(() => assert.fail("publication exited before the commit gate"))]);
    t.mock.timers.setTime(new Date("2020-01-04T00:00:10Z").getTime());
    report = composeDaily("2020-01-04");
    await waitForBlocked(pid, report);
    commit.open();
    await publication;
    await report;
    await composeDaily("2020-01-05");
    const reports = await sql<{ key: string; content: { sections: Array<{ items: Array<{ itemId: string }> }> } }[]>`
      SELECT key, content FROM reports WHERE kind = 'daily' AND key IN ('2020-01-04', '2020-01-05')`;
    const hasItem = (key: string) => reports.find((r) => r.key === key)!.content.sections.some((s) => s.items.some((item) => item.itemId === id));
    assert.equal(hasItem("2020-01-04"), true);
    assert.equal(hasItem("2020-01-05"), false);
  } finally {
    commit.open();
    await Promise.allSettled([publication, report]);
  }
});
