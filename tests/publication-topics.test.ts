import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { tag } from "./setup.ts";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { listTopicSummaries, loadTopicPage, TOPIC_PAGE_SIZE, topicPageCounts } from "@aihot/backend/publication/topics";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-topics-${T}`;
const TOPIC = `test-topic-${T}`;
const EMPTY_SELECTED = `test-empty-selected-${T}`;
const COMPANY = `test-company-${T}`;
const ENTITY = `test-entity-${T}`;
const NOW = new Date();
const ids: string[] = [];
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at)
    VALUES(${SOURCE},'Topic test','rss','T1','editorial','2100-01-01')`;
  await sql`INSERT INTO topics(slug,name,grp,entity_id,tags,definition,position) VALUES
    (${TOPIC},'摄影主题','field',NULL,${[TOPIC]},'主题摘要测试',999),
    (${EMPTY_SELECTED},'暂无精选','field',NULL,${[EMPTY_SELECTED]},'只有普通摘要',1000),
    (${COMPANY},'测试机构','company',${ENTITY},${[TOPIC]},'只匹配主体标签',1001)`;
  for (let n = 0; n < 28; n++) {
    const timelineAt = new Date(NOW.getTime() - (n + 1) * 60_000);
    const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/topic-${T}-${n}`,
      title: `Camera ${n}`, bodyText: `PRIVATE FULL BODY ${T}`, bodyStatus: "ok", via: "fetch",
      publishedAt: timelineAt });
    ids.push(articleId);
    await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected)
      VALUES(${articleId},1,'rule','pass','camera-lighting',${`摄影 ${n}`},${`摘要 ${n}`},70,false)`;
    await publishArticle(articleId);
    const tags = [TOPIC];
    if (n === 2 || n === 3) tags.push(EMPTY_SELECTED);
    if (n === 4) tags.push(`entity:${ENTITY}`);
    if (n === 5) tags.push(`mention:${ENTITY}`);
    await sql`UPDATE publications SET tags=${tags},timeline_at=${timelineAt},sort_at=${timelineAt} WHERE article_id=${articleId}`;
  }
  await sql`UPDATE publications SET selected=true,visible_after=now()-interval '1 minute' WHERE article_id IN ${sql([ids[0]!, ids[1]!])}`;
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[23]!}`;
  await sql`UPDATE publications SET visibility='summary-only' WHERE article_id=${ids[24]!}`;
  await sql`UPDATE publications SET eligible=false,selected=true,visible_after=now()-interval '1 minute' WHERE article_id=${ids[25]!}`;
  await sql`UPDATE publications SET selected=true,visible_after=now()+interval '1 day' WHERE article_id=${ids[26]!}`;
  await sql`UPDATE publications SET selected=true,visible_after=NULL WHERE article_id=${ids[27]!}`;
});

after(async () => {
  await sql`DELETE FROM topics WHERE slug IN ${sql([TOPIC, EMPTY_SELECTED, COMPANY])}`;
  await sql`DELETE FROM articles WHERE id=ANY(${ids}::text[])`;
  await sql`DELETE FROM sources WHERE id=${SOURCE}`;
  await app.close();
  await stopBoss();
  await closeDb();
});

test("topic summary totals include non-selected articles while selected indexing metadata stays unchanged", async () => {
  const summaries = await listTopicSummaries();
  const topic = summaries.find((entry) => entry.slug === TOPIC)!;
  assert.equal(topic.total, 2);
  assert.equal(topic.summaryTotal, 23);
  assert.equal(topic.recent, 2);
  assert.equal(topic.indexable, false);
  const [latest] = await sql<{ timeline_at: Date }[]>`SELECT timeline_at FROM publications WHERE article_id=${ids[0]!}`;
  assert.equal(topic.latestAt, latest!.timeline_at.toISOString());
  const counts = (await topicPageCounts()).find((entry) => entry.slug === TOPIC)!;
  assert.equal(counts.pages, 1, "sitemap pagination continues to count selected articles");
  const selected = (await loadTopicPage(TOPIC, 1))!;
  assert.equal(selected.view, "selected");
  assert.equal(selected.pageCount, 1);
  assert.deepEqual(selected.items.map((item) => item.id), ids.slice(0, 2));
  assert.ok(selected.items.every((item) => item.selected));
  assert.equal(await loadTopicPage(TOPIC, 2), null);
});

test("all topic summaries paginate the entire readable set and work without selected articles", async () => {
  const first = (await loadTopicPage(TOPIC, 1, new Date(), "all"))!;
  const second = (await loadTopicPage(TOPIC, 2, new Date(), "all"))!;
  assert.equal(first.view, "all");
  assert.equal(first.topic.summaryTotal, 23);
  assert.equal(first.pageCount, 2);
  assert.equal(first.items.length, TOPIC_PAGE_SIZE);
  assert.equal(second.items.length, 3);
  assert.deepEqual([...first.items, ...second.items].map((item) => item.id), ids.slice(0, 23));
  assert.equal(await loadTopicPage(TOPIC, 3, new Date(), "all"), null);
  const selected = (await loadTopicPage(EMPTY_SELECTED, 1))!;
  assert.equal(selected.topic.total, 0);
  assert.equal(selected.topic.summaryTotal, 2);
  assert.deepEqual(selected.items, []);
  const all = (await loadTopicPage(EMPTY_SELECTED, 1, new Date(), "all"))!;
  assert.deepEqual(all.items.map((item) => item.id), ids.slice(2, 4));
  assert.ok(all.items.every((item) => !item.selected));
});

test("topic summaries preserve publication safety and company subject matching", async () => {
  const all = [...(await loadTopicPage(TOPIC, 1, new Date(), "all"))!.items,
    ...(await loadTopicPage(TOPIC, 2, new Date(), "all"))!.items];
  assert.ok(ids.slice(23).every((id) => !all.some((item) => item.id === id)), "withdrawn, summary-only, ineligible and unreleased entries stay hidden");
  assert.ok(!JSON.stringify(all).includes("PRIVATE FULL BODY"));
  const company = (await loadTopicPage(COMPANY, 1, new Date(), "all"))!;
  assert.equal(company.topic.total, 0);
  assert.equal(company.topic.summaryTotal, 1);
  assert.deepEqual(company.items.map((item) => item.id), [ids[4]!], "company fallback tags and mere mentions do not match");
  assert.equal(await loadTopicPage("unknown-topic", 1, new Date(), "all"), null);
  for (const page of [0, -1, 1.5, NaN, Infinity]) assert.equal(await loadTopicPage(TOPIC, page, new Date(), "all"), null);
});

test("site topic API exposes counts and selects summary views without changing its default", async () => {
  const directory = await app.inject({ url: "/api/site/topics" });
  assert.equal(directory.statusCode, 200);
  const summary = directory.json().topics.find((entry: { slug: string }) => entry.slug === TOPIC);
  assert.equal(summary.total, 2);
  assert.equal(summary.summaryTotal, 23);
  const selected = await app.inject({ url: `/api/site/topics/${TOPIC}` });
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.json().view, "selected");
  assert.equal(selected.json().items.length, 2);
  const all = await app.inject({ url: `/api/site/topics/${TOPIC}?view=all&page=2` });
  assert.equal(all.statusCode, 200);
  assert.equal(all.json().view, "all");
  assert.equal(all.json().pageCount, 2);
  assert.deepEqual(all.json().items.map((item: { id: string }) => item.id), ids.slice(20, 23));
  const noSelected = await app.inject({ url: `/api/site/topics/${EMPTY_SELECTED}?view=all` });
  assert.equal(noSelected.statusCode, 200);
  assert.equal(noSelected.json().items.length, 2);
  for (const page of ["0", "-1", "1.5", "NaN", "Infinity", "3"]) {
    assert.equal((await app.inject({ url: `/api/site/topics/${TOPIC}?view=all&page=${page}` })).statusCode, 404);
  }
  assert.equal((await app.inject({ url: "/api/site/topics/unknown-topic?view=all" })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/site/topics/${TOPIC}?view=unknown` })).statusCode, 400);
});
