import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { tag } from "./setup.ts";
import { beijingDate } from "@aihot/contracts/time";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { listTagSummaries, normalizePublicTag } from "@aihot/backend/publication/tags";
import { loadPool } from "@aihot/backend/publication/pool";
import { listTopicSummaries } from "@aihot/backend/publication/topics";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-tags-${T}`;
const TAG = `Tag-${T}`;
const ZERO = `Zero-${T}`;
const HIDDEN = `Hidden-${T}`;
const FIELD = `tag-field-${T}`;
const COMPANY = `tag-company-${T}`;
const TIE_A = `A-${T}`;
const TIE_B = `B-${T}`;
const KEYWORD = `needle-${T}`;
const BODYWORD = `bodyneedle-${T}`;
const NOW = new Date();
const ids: string[] = [];
const app = await buildApp();
const scope = { channel: "all" as const, category: null, tag: TAG, now: NOW };

before(async () => {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,site_fulltext,next_fetch_at)
    VALUES(${SOURCE},'Tag test','rss','T1','editorial',true,'2100-01-01')`;
  await sql`INSERT INTO topics(slug,name,grp,entity_id,tags,definition,position) VALUES
    (${FIELD},'标签领域','field',NULL,${[TAG, ZERO, `entity:${T}`, TAG]},'公开组成标签',999),
    (${COMPANY},'摄影机构','company','arri',${[TAG]},'显示机构名，仍按主体匹配',1000)`;
  for (let n = 0; n < 50; n++) {
    const timelineAt = new Date(NOW.getTime() - (n + 1) * 1000);
    const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/tags-${T}-${n}`,
      title: `Camera ${n}`, bodyText: n === 1 || n === 42 ? BODYWORD : "Public camera body", bodyStatus: "ok", via: "fetch", publishedAt: timelineAt });
    ids.push(articleId);
    await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected)
      VALUES(${articleId},1,'rule','pass','camera-lighting',${n === 0 || n === 41 ? `摄影 ${KEYWORD}` : `摄影 ${n}`},'摄影摘要',70,false)`;
    await publishArticle(articleId);
    const tags = [TAG, TAG, `entity:${T}`];
    if (n === 41 || n === 42) tags.push(ZERO);
    if (n === 44) tags.push(TIE_A, TIE_B);
    if (n >= 45) tags.push(HIDDEN);
    await sql`UPDATE publications SET tags=${tags},timeline_at=${timelineAt},sort_at=${timelineAt} WHERE article_id=${articleId}`;
  }
  await sql`UPDATE publications SET selected=true,visible_after=${new Date(NOW.getTime() - 60_000)} WHERE article_id IN ${sql(ids.slice(0, 41))}`;
  await sql`UPDATE publications SET category='ai-film',channel='x' WHERE article_id=${ids[43]!}`;
  await sql`UPDATE publications SET first_party=true WHERE article_id=${ids[44]!}`;
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[45]!}`;
  await sql`UPDATE publications SET visibility='summary-only' WHERE article_id=${ids[46]!}`;
  await sql`UPDATE publications SET eligible=false,selected=true,visible_after=${new Date(NOW.getTime() - 60_000)} WHERE article_id=${ids[47]!}`;
  await sql`UPDATE publications SET selected=true,visible_after=${new Date(NOW.getTime() + 86_400_000)} WHERE article_id=${ids[48]!}`;
  await sql`UPDATE publications SET selected=true,visible_after=NULL WHERE article_id=${ids[49]!}`;
});

after(async () => {
  await sql`DELETE FROM topics WHERE slug IN ${sql([FIELD, COMPANY])}`;
  await sql`DELETE FROM articles WHERE id=ANY(${ids}::text[])`;
  await sql`DELETE FROM sources WHERE id=${SOURCE}`;
  await app.close();
  await stopBoss();
  await closeDb();
});

test("public tag directory counts unique article memberships, hides unsafe tags and sorts stably", async () => {
  const tags = await listTagSummaries(NOW);
  assert.deepEqual(tags.find((entry) => entry.tag === TAG), { tag: TAG, total: 45, selectedTotal: 41 });
  assert.deepEqual(tags.find((entry) => entry.tag === ZERO), { tag: ZERO, total: 2, selectedTotal: 0 });
  assert.ok(!tags.some((entry) => entry.tag === HIDDEN || entry.tag.startsWith("entity:")));
  assert.ok(tags.findIndex((entry) => entry.tag === TIE_A) < tags.findIndex((entry) => entry.tag === TIE_B));
  for (let n = 1; n < tags.length; n++) assert.ok(tags[n - 1]!.total >= tags[n]!.total);
  const response = await app.inject({ url: "/api/site/tags" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().tags.find((entry: { tag: string }) => entry.tag === TAG), { tag: TAG, total: 45, selectedTotal: 41 });
  assert.equal(await normalizePublicTag(`＃${TAG.toLowerCase()}`), TAG);
  assert.equal(await normalizePublicTag(" # "), null);
  assert.equal(await normalizePublicTag(`unknown-${T}`), `unknown-${T}`);
});

test("tag pool all and selected views preserve pagination and full structural counts", async () => {
  const all = await loadPool(scope);
  const selected = await loadPool({ ...scope, view: "selected" });
  assert.equal(all.filters.view, "all");
  assert.equal(all.total, 45);
  assert.equal(selected.filters.view, "selected");
  assert.equal(selected.total, 41);
  assert.equal(selected.pageCount, 2);
  assert.ok(selected.items.every((item) => item.selected));
  assert.deepEqual((await loadPool({ ...scope, view: "selected", page: 2 })).items.map((item) => item.id), [ids[40]!]);
  assert.deepEqual((await loadPool({ ...scope, page: 2 })).items.map((item) => item.id), ids.slice(40, 45));
  assert.deepEqual(all.tagCounts, { total: 45, selected: 41 });
  assert.deepEqual(selected.tagCounts, all.tagCounts);
  assert.deepEqual((await loadPool({ ...scope, maxPages: 1 })).tagCounts, all.tagCounts, "full tag scope is not capped with list totals");
  const selectedToday = ids.slice(0, 41).filter((_id, n) => beijingDate(NOW.getTime() - (n + 1) * 1000) === beijingDate(NOW)).length;
  assert.equal(selected.todayCount, selectedToday);
  assert.deepEqual((await loadPool({ ...scope, channel: "news", category: "camera-lighting" })).tagCounts, { total: 44, selected: 41 });
  assert.deepEqual((await loadPool({ ...scope, topicTags: [ZERO] })).tagCounts, { total: 2, selected: 0 });
  assert.deepEqual((await loadPool({ ...scope, channel: "firstParty" })).tagCounts, { total: 1, selected: 0 });
  assert.equal((await loadPool({ ...scope, tag: null, sourceId: SOURCE })).tagCounts, null);
  const zero = await loadPool({ ...scope, tag: ZERO, view: "selected" });
  assert.equal(zero.total, 0);
  assert.deepEqual(zero.items, []);
  assert.deepEqual(zero.tagCounts, { total: 2, selected: 0 });
});

test("both keyword orderings and today counts honor selected filtering without changing tag scope counts", async () => {
  const all = await loadPool({ ...scope, q: KEYWORD });
  const selected = await loadPool({ ...scope, q: KEYWORD, view: "selected" });
  assert.equal(all.total, 2);
  assert.equal(selected.total, 1);
  assert.deepEqual(selected.items.map((item) => item.id), [ids[0]!]);
  assert.deepEqual(selected.tagCounts, { total: 45, selected: 41 }, "tag counts describe the structural scope, independently of q");
  assert.equal((await loadPool({ ...scope, q: BODYWORD, view: "selected" })).total, 0, "time search retains its title/summary semantics");
  const relevant = await loadPool({ ...scope, q: BODYWORD, tab: "relevance", view: "selected" });
  assert.equal(relevant.total, 1);
  assert.deepEqual(relevant.items.map((item) => item.id), [ids[1]!]);
  const split = await loadPool({ channel: "all", category: null, tag: null, sourceId: SOURCE, now: NOW, q: BODYWORD, tab: "relevance", view: "selected" });
  assert.equal(split.total, 1, "unfiltered relevance search also filters the scored set by view");
  assert.ok(!JSON.stringify(relevant.items).includes(BODYWORD), "list projections do not include original bodies");
});

test("site hash queries normalize existing labels, retain exact unknown filters and keep view caches separate", async () => {
  const fetch = async (params: Record<string, string>) => {
    const response = await app.inject({ url: `/api/site/pool?${new URLSearchParams(params)}` });
    assert.equal(response.statusCode, 200);
    return response.json();
  };
  const selected = await fetch({ tag: `#${TAG.toLowerCase()}`, view: "selected" });
  const all = await fetch({ q: `＃${TAG.toLowerCase()}`, tag: ZERO, tab: "relevance" });
  assert.equal(selected.total, 41);
  assert.equal(all.total, 45);
  assert.equal(all.filters.tag, TAG);
  assert.equal(all.filters.q, null);
  assert.equal(all.filters.tab, "time");
  assert.deepEqual(all.tagCounts, { total: 45, selected: 41 });
  assert.equal((await fetch({ tag: TAG, view: "selected" })).total, 41, "cached totals are distinct per view");
  const unknown = await fetch({ q: `#unknown-${T}` });
  assert.equal(unknown.total, 0);
  assert.equal(unknown.filters.q, null);
  assert.deepEqual(unknown.tagCounts, { total: 0, selected: 0 });
  assert.equal((await fetch({ q: "#", tag: TAG })).filters.tag, null);
  assert.equal((await fetch({ tag: `entity:${T}` })).total, 45, "existing direct internal-tag filters retain public-scope compatibility");
  assert.equal((await app.inject({ url: `/api/site/pool?tag=${TAG}&view=invalid` })).statusCode, 400);
});

test("topic summaries expose readable component labels while preserving company subject matching", async () => {
  const topics = await listTopicSummaries();
  assert.deepEqual(topics.find((entry) => entry.slug === FIELD)!.tags, [TAG, ZERO]);
  const company = topics.find((entry) => entry.slug === COMPANY)!;
  assert.deepEqual(company.tags, ["ARRI"]);
  assert.equal(company.summaryTotal, 0, "company membership still follows entity:arri, not display labels");
  assert.ok(!JSON.stringify(topics).includes(`entity:${T}`));
});
