import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { registerPrivateLog } from "../apps/api/src/routes/private-log.ts";

const token = "private-log-local-test-token-0123456789abcdef";
process.env.PRIVATE_LOG_API_TOKEN = token;
const app = Fastify({ logger: false }); registerPrivateLog(app);
const T = tag(), directory = await mkdtemp(path.join(tmpdir(), "filmtech-log-feedback-"));
config.dataDir = directory;
await mkdir(path.join(directory, "feedback-screenshots"));
const screenshot = Buffer.from("89504e470d0a1a0a", "hex");
await writeFile(path.join(directory, "feedback-screenshots", `${T}.png`), screenshot);
const rows = await sql<{ id: number; updated_at: Date }[]>`
  INSERT INTO feedback (content, email, page_url, source_hash, screenshot_key, note)
  VALUES (${`反馈 ${T} <img src=x onerror=alert(1)>`}, 'reader@example.invalid', 'javascript:alert(1)', ${T}, ${`local:${T}.png`}, '内部备注') RETURNING id, updated_at`;
const id = rows[0]!.id, version = rows[0]!.updated_at.toISOString();
const headers = { "x-filmtech-log-token": token, "x-filmtech-log-user": "admin" };
const writeHeaders = { ...headers, origin: new URL(config.siteUrl).origin, "sec-fetch-site": "same-origin" };
const url = `/api/private-log/feedback/${id}/viewed`;

after(async () => {
  await app.close();
  await sql`DELETE FROM audit_log WHERE subject = ${`feedback:${id}`}`;
  await sql`DELETE FROM feedback WHERE id = ${id}`;
  await rm(directory, { recursive: true, force: true }); delete process.env.PRIVATE_LOG_API_TOKEN;
  await closeDb();
});

test("private feedback routes require a configured server token and the admin gateway identity", async () => {
  for (const bad of [{}, { ...headers, "x-filmtech-log-token": "wrong" }, { ...headers, "x-filmtech-log-token": "é".repeat(token.length) }, { ...headers, "x-filmtech-log-user": "reader" }]) {
    for (const endpoint of ["/api/private-log/feedback", `/api/private-log/feedback/${id}/screenshot`]) {
      assert.equal((await app.inject({ url: endpoint, headers: bad })).statusCode, 403);
    }
  }
  delete process.env.PRIVATE_LOG_API_TOKEN;
  assert.equal((await app.inject({ url: "/api/private-log/feedback", headers })).statusCode, 403);
  process.env.PRIVATE_LOG_API_TOKEN = token;
});

test("the private reader returns full text and protected screenshots without internal identifiers", async () => {
  const response = await app.inject({ url: `/api/private-log/feedback?q=${T}`, headers });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["cache-control"]), /no-store/);
  const data = response.json(); assert.equal(data.rows.length, 1);
  assert.match(data.rows[0].content, /<img src=x onerror=alert\(1\)>/);
  assert.equal(data.rows[0].email, "reader@example.invalid");
  assert.equal(data.rows[0].source_hash, undefined); assert.equal(data.bans, undefined);
  assert.equal(data.rows[0].forward_error, undefined); assert.equal(data.rows[0].screenshot_key, undefined);
  assert.ok(!response.body.includes(token));
  const image = await app.inject({ url: `/api/private-log/feedback/${id}/screenshot`, headers });
  assert.equal(image.statusCode, 200); assert.equal(image.headers["content-type"], "image/png");
  assert.deepEqual(image.rawPayload, screenshot);
  assert.equal((await sql`SELECT status FROM feedback WHERE id=${id}`)[0]!.status, "new", "reading never marks feedback");
  assert.equal((await app.inject({ url: "/api/private-log/feedback?page=1.5", headers })).statusCode, 400);
});

test("only explicit same-origin marking moves new feedback to triaged and records an audit", async () => {
  for (const bad of [headers, { ...writeHeaders, origin: "https://another.example" }, { ...writeHeaders, "sec-fetch-site": "cross-site" }]) {
    assert.equal((await app.inject({ method: "PATCH", url, headers: bad, payload: { version } })).statusCode, 403);
  }
  assert.equal((await app.inject({ method: "PATCH", url, headers: writeHeaders, payload: { version, status: "resolved" } })).statusCode, 400);
  const result = await app.inject({ method: "PATCH", url, headers: writeHeaders, payload: { version } });
  assert.equal(result.statusCode, 200); assert.equal(result.json().status, "triaged");
  assert.equal((await sql`SELECT note FROM feedback WHERE id=${id}`)[0]!.note, "内部备注");
  assert.equal((await sql`SELECT actor FROM audit_log WHERE subject=${`feedback:${id}`} ORDER BY id DESC LIMIT 1`)[0]!.actor, "private-log:admin");
});

test("stale marks are rejected and completed feedback cannot be moved back to pending", async () => {
  await sql`UPDATE feedback SET status='resolved', updated_at=now()+interval '3 seconds' WHERE id=${id}`;
  assert.equal((await app.inject({ method: "PATCH", url, headers: writeHeaders, payload: { version } })).statusCode, 409);
  const current = (await sql<{ updated_at: Date }[]>`SELECT updated_at FROM feedback WHERE id=${id}`)[0]!;
  assert.equal((await app.inject({ method: "PATCH", url, headers: writeHeaders, payload: { version: current.updated_at.toISOString() } })).json().status, "resolved");
});
