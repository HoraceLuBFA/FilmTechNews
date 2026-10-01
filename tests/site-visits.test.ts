import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { loadSiteVisits } from "@aihot/backend/publication/visits";
import { registerSite } from "../apps/api/src/routes/site.ts";

const app = Fastify({ logger: false });
registerSite(app);
const original = await loadSiteVisits();
const headers = { origin: new URL(config.siteUrl).origin, "sec-fetch-site": "same-origin", "user-agent": "Mozilla/5.0" };

after(async () => {
  await app.close();
  await sql`UPDATE site_visits SET total = ${original.total} WHERE singleton = true`;
  await closeDb();
});

test("parallel page views accumulate atomically and disclose only the aggregate", async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () => app.inject({ method: "POST", url: "/api/site/visits", headers })));
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["set-cookie"], undefined);
    assert.deepEqual(Object.keys(response.json()).sort(), ["startedAt", "total"]);
  }
  const result = await loadSiteVisits();
  assert.equal(result.total, original.total + 20);
  assert.equal(result.startedAt, original.startedAt);
  const columns = await sql<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'site_visits' ORDER BY ordinal_position`;
  assert.deepEqual(columns.map((row) => row.column_name), ["singleton", "total", "started_at"]);
});

test("reading the aggregate does not count visits, including conditional requests", async () => {
  const before = await loadSiteVisits();
  for (let i = 0; i < 3; i++) {
    const response = await app.inject({ method: "GET", url: "/api/site/visits", headers: { "if-none-match": "anything" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), before);
  }
  assert.deepEqual(await loadSiteVisits(), before);
});

test("cross-origin requests, supplied browsing data and obvious robots do not increment", async () => {
  const before = await loadSiteVisits();
  for (const bad of [{}, { ...headers, origin: "https://another.example" }, { ...headers, "sec-fetch-site": "cross-site" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/api/site/visits", headers: bad })).statusCode, 403);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/site/visits", headers, payload: { path: "/all", visitorId: "unwanted" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/site/visits", headers: { ...headers, "user-agent": "Googlebot" } })).statusCode, 204);
  assert.deepEqual(await loadSiteVisits(), before);
});
