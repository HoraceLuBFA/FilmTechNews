import { gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { BudgetExceededError, paidRequest, ProviderRejectedError, ReceiptBusyError } from "@aihot/backend/providers/receipts";

const prefix = `test-pacing-${tag()}`;
const savedConfig = { limit: config.llmHourlyCallLimit, reserve: config.llmReportHourlyReserve, concurrent: config.llmMaxConcurrentCalls, concurrentReserve: config.llmReportConcurrentReserve };
let originalBudget: { per_minute: number; per_hour: number; per_day: number };
let originalGrace: unknown;
let existing: { id: number; started_at: Date }[];
let calls = 0;
const request = (purpose = "prefilter_article", identity = tag()) => ({
  service: "llm", purpose, subject: prefix, identity,
});
const call = async () => { calls++; return { response: { ok: true } }; };

before(async () => {
  [originalBudget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'` as [typeof originalBudget];
  originalGrace = (await sql`SELECT value FROM settings WHERE key='llm_budget_grace'`)[0]?.value;
  existing = await sql`SELECT id,started_at FROM receipt_attempts WHERE service='llm' AND started_at>now()-interval '1 day'`;
  await sql`UPDATE receipt_attempts SET started_at=now()-interval '2 days' WHERE service='llm' AND started_at>now()-interval '1 day'`;
});
beforeEach(async () => {
  calls = 0;
  config.llmHourlyCallLimit = 12;
  config.llmReportHourlyReserve = 2;
  config.llmMaxConcurrentCalls = 0;
  config.llmReportConcurrentReserve = 0;
  await sql`UPDATE budgets SET per_minute=100,per_hour=100,per_day=300 WHERE service='llm'`;
  await sql`DELETE FROM settings WHERE key='llm_budget_grace'`;
});
afterEach(async () => {
  await sql`DELETE FROM receipts WHERE subject=${prefix}`;
});
after(async () => {
  Object.assign(config, { llmHourlyCallLimit: savedConfig.limit, llmReportHourlyReserve: savedConfig.reserve,
    llmMaxConcurrentCalls: savedConfig.concurrent, llmReportConcurrentReserve: savedConfig.concurrentReserve });
  await sql`UPDATE budgets SET per_minute=${originalBudget.per_minute},per_hour=${originalBudget.per_hour},per_day=${originalBudget.per_day} WHERE service='llm'`;
  await sql`DELETE FROM settings WHERE key='llm_budget_grace'`;
  if (originalGrace !== undefined) await sql`INSERT INTO settings(key,value) VALUES('llm_budget_grace',${sql.json(originalGrace as never)})`;
  for (const row of existing) await sql`UPDATE receipt_attempts SET started_at=${row.started_at} WHERE id=${row.id}`;
  await closeDb();
});

test("concurrent article work cannot take the report reserve or overshoot hourly pacing", async () => {
  const result = await Promise.allSettled(Array.from({ length: 16 }, () => paidRequest(request(), call)));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 10);
  assert.equal(calls, 10);
  for (const r of result) if (r.status === "rejected") {
    assert.ok(r.reason instanceof BudgetExceededError);
    assert.ok(r.reason.retryAfterSeconds > 3500);
  }
  const report = request("report_daily");
  const first = await paidRequest(report, call);
  await paidRequest(request("report_lead"), call);
  await assert.rejects(paidRequest(request("report_monthly"), call), /hourly pacing/);
  assert.equal(calls, 12);
  await sql`UPDATE budgets SET per_day=0 WHERE service='llm'`;
  assert.equal((await paidRequest(report, call)).receiptId, first.receiptId, "received results remain reusable with no budget");
  assert.equal(calls, 12);
});

test("an aged call releases one slot without resetting other receipts", async () => {
  for (let i = 0; i < 10; i++) await paidRequest(request(), call);
  await assert.rejects(paidRequest(request(), call), /hourly pacing/);
  await sql`UPDATE receipt_attempts SET started_at=now()-interval '61 minutes'
    WHERE id=(SELECT min(a.id) FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.subject=${prefix})`;
  await paidRequest(request(), call);
  await assert.rejects(paidRequest(request(), call), /hourly pacing/);
  assert.equal(calls, 11);
});

test("pacing never overrides a stricter existing budget", async () => {
  await sql`UPDATE budgets SET per_minute=1 WHERE service='llm'`;
  await paidRequest(request(), call);
  await assert.rejects(paidRequest(request("report_daily"), call), /minute/);
  assert.equal(calls, 1);
});

test("maintenance aging cannot grant normal calls through a stale reconciled budget", async () => {
  for (let i = 0; i < 3; i++) await paidRequest(request(), call);
  const [old] = await sql`SELECT max(id)::int AS id FROM receipt_attempts WHERE service='llm'`;
  await sql`INSERT INTO settings(key,value) VALUES('llm_budget_grace',${sql.json({ baselineMaxId: old!.id, original: { per_minute: 100, per_hour: 100, per_day: 2 } })})`;
  await sql`UPDATE budgets SET per_day=5 WHERE service='llm'`;
  await paidRequest(request(), call);
  await paidRequest(request(), call);
  await sql`UPDATE receipt_attempts SET started_at=now()-interval '25 hours' WHERE id=${old!.id}`;
  await assert.rejects(paidRequest(request(), call), /day/);
  assert.equal(calls, 5, "the once-a-minute reconciliation cannot leak another call");
});

test("temporary daily headroom expires in the request guard even before the timer updates", async () => {
  const value = { baselineMaxId: 0, original: { per_minute: 100, per_hour: 100, per_day: 1 }, extra: { perDay: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
  await sql`INSERT INTO settings(key,value) VALUES('llm_budget_grace',${sql.json(value)})`;
  for (let i = 0; i < 3; i++) await paidRequest(request(), call);
  await assert.rejects(paidRequest(request(), call), /day/);
  value.extra.expiresAt = new Date(Date.now() - 1000).toISOString();
  await sql`UPDATE settings SET value=${sql.json(value)} WHERE key='llm_budget_grace'`;
  await assert.rejects(paidRequest(request("report_daily"), call), /day/);
  assert.equal(calls, 3);
});

test("in-flight article work leaves a report slot and a busy refusal sends nothing", async () => {
  config.llmMaxConcurrentCalls = 4;
  config.llmReportConcurrentReserve = 1;
  const started = gate(), reportStarted = gate(), release = gate();
  let running = 0;
  const work = async () => { if (++running === 3) started.open(); await release.promise; return { response: { ok: true } }; };
  const articles = Promise.all(Array.from({ length: 3 }, () => paidRequest(request(), work)));
  await started.promise;
  try {
    await assert.rejects(paidRequest(request(), call), ReceiptBusyError);
    const report = paidRequest(request("report_daily"), async () => { reportStarted.open(); await release.promise; return { response: { ok: true } }; });
    await reportStarted.promise;
    await assert.rejects(paidRequest(request("report_monthly"), call), ReceiptBusyError);
    assert.equal(calls, 0, "the two refused requests never reach the provider");
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${prefix}`)[0]!.n, 4);
    release.open();
    await Promise.all([articles, report]);
  } finally { release.open(); await articles; }
});

test("a clear provider refusal preserves attempt accounting without spending a model-work slot", async () => {
  config.llmHourlyCallLimit = 2;
  config.llmReportHourlyReserve = 0;
  await sql`UPDATE budgets SET per_day=3 WHERE service='llm'`;
  await assert.rejects(paidRequest(request(), async () => { throw new ProviderRejectedError('Private model worker is busy',429,true); }), ProviderRejectedError);
  await paidRequest(request(), call);
  await paidRequest(request("report_daily"), call);
  await assert.rejects(paidRequest(request(), call), /day/);
  assert.equal(calls, 2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.subject=${prefix}`)[0]!.n, 3);
});
