import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { tag } from "./setup.ts";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { listSourceCounts, loadSourcePage } from "@aihot/backend/publication/sources";
import { topicPageCounts } from "@aihot/backend/publication/topics";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const ids: string[] = [];
const app = await buildApp();
before(async () => {
  for (const id of ["cined", "redshark"]) await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at) VALUES(${id},${id},'rss','T1','editorial','2100-01-01') ON CONFLICT DO NOTHING`;
  for (let n = 0; n < 45; n++) {
    const { articleId } = await upsertMaterial({ sourceId: n < 44 ? "cined" : "redshark", url: `https://example.com/source-${T}-${n}`, title: `Camera ${n}`, bodyText: "Camera engineering", bodyStatus: "ok", via: "fetch", publishedAt: new Date(Date.now() - (n + 1) * 60000) });
    ids.push(articleId);
    await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected) VALUES(${articleId},1,'rule','pass','camera-lighting',${`摄影 ${n}`},'摘要',70,false)`;
    await publishArticle(articleId);
  }
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[42]!}`;
  await sql`UPDATE publications SET selected=true,visible_after=now()+interval '1 day' WHERE article_id=${ids[43]!}`;
  const topic = `source-public-${T}`;
  await sql`INSERT INTO topics(slug,name,grp,tags,definition,position) VALUES(${topic},'Public source test','field',${[topic]},'Public articles',999)`;
  await sql`UPDATE publications SET tags=${[topic]},selected=true WHERE article_id IN ${sql([ids[0]!,ids[42]!,ids[43]!])}`;
  await sql`UPDATE publications SET visible_after=now()-interval '1 minute' WHERE article_id=${ids[0]!}`;
});
after(async () => { await sql`DELETE FROM topics WHERE slug=${`source-public-${T}`}`; await sql`DELETE FROM articles WHERE id=ANY(${ids}::text[])`; await app.close(); await stopBoss(); await closeDb(); });

test("reader source counts equal the paginated public set and keep sources separate", async () => {
  const counts = await listSourceCounts();
  assert.equal(counts.find((s) => s.id === "cined")!.total, 42);
  const first = (await loadSourcePage("cined", 1))!;
  const second = (await loadSourcePage("cined", 2))!;
  assert.equal(first.total, 42);
  assert.equal(first.pageCount, 2);
  assert.equal(first.items.length, 40);
  assert.equal(second.items.length, 2);
  assert.ok([...first.items, ...second.items].every((i) => i.source.name === "cined"));
  assert.equal(new Set([...first.items, ...second.items].map((i) => i.id)).size, 42);
  assert.equal(await loadSourcePage("cined", 3), null);
  assert.equal(await loadSourcePage("unknown", 1), null);
  assert.equal((await topicPageCounts()).find((topic) => topic.slug === `source-public-${T}`)!.total, 1, "topic totals exclude withdrawn and unreleased articles");
  const response = await app.inject({ url: "/api/site/source-directory" });
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.sources.length, 32);
  assert.deepEqual(Object.keys(data.sources[0]).sort(), ["id", "total"]);
  assert.equal((await app.inject({ url: "/api/site/source-directory/cined?page=2" })).json().total, 42);
  assert.equal((await app.inject({ url: "/api/site/source-directory/cined?page=1.5" })).statusCode, 404);
});
