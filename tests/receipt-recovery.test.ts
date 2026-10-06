// Lost article answers resume the existing revision and reuse settled requests.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { autoReleaseUnknownReceipts, releaseReceipt } from "@aihot/backend/admin/runs";
import { paidRequest, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";

const SOURCE = `test-recovery-${tag()}`;
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, participation_mode, next_fetch_at)
    VALUES (${SOURCE}, 'Recovery tests', 'rss', 'editorial', '2100-01-01')`;
});
after(async () => { await stopBoss(); await closeDb(); });

async function lostArticle(purpose: string) {
  const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${tag()}`,
    title: 'A lens release', bodyText: 'Public technical specifications.', bodyStatus: 'ok', via: 'fetch' });
  const request = { service: 'recovery-test', purpose, subject: `article:${articleId}@1`, identity: { key: tag() } };
  await assert.rejects(paidRequest(request, async () => { throw new Error('socket hang up'); }));
  const [receipt] = await sql<{ id: number }[]>`SELECT id FROM receipts WHERE subject = ${request.subject}`;
  const id = receipt!.id;
  await sql`UPDATE receipts SET updated_at = now() - interval '31 minutes' WHERE id = ${id}`;
  await sql`UPDATE articles SET processing_state = 'failed', processing_attempts = 1,
    processing_error = ${`receipt ${id} outcome unknown`}, processing_retry_at = now() WHERE id = ${articleId}`;
  return { articleId, id, request };
}

test('every article analysis step and the legacy purpose resume after automatic release', async () => {
  for (const purpose of ['prefilter_article', 'score_article', 'structure_article', 'understand_article', 'summarize_article', 'analyze_article']) {
    const { articleId, id, request } = await lostArticle(purpose);
    const settled = { ...request, purpose: 'previous-step', identity: { settled: tag() } };
    let sent = 0;
    const first = await paidRequest(settled, async () => { sent++; return { response: { ok: true } }; });
    const result = await autoReleaseUnknownReceipts();
    assert.equal(result.requeued, 1, purpose);
    const [article] = await sql`SELECT processing_state, processing_attempts, processing_error, processing_retry_at FROM articles WHERE id = ${articleId}`;
    assert.deepEqual(article, { processing_state: 'new', processing_attempts: 0, processing_error: null, processing_retry_at: null });
    const jobs = await sql`SELECT data FROM pgboss.job WHERE name = 'content.analyze' AND data->>'articleId' = ${articleId}`;
    assert.deepEqual(jobs.map(j => j.data), [{ articleId }], 'same revision and no new paid re-evaluation tag');
    const again = await paidRequest(settled, async () => { throw new Error('must reuse'); });
    assert.equal(again.receiptId, first.receiptId);
    assert.equal(again.reused, true);
    assert.equal(sent, 1);
    await assert.rejects(paidRequest(request, async () => { throw new Error('second socket hang up'); }));
    await sql`UPDATE receipts SET updated_at = now() - interval '31 minutes' WHERE id = ${id}`;
    assert.equal((await autoReleaseUnknownReceipts()).released, 0, 'a second lost answer requires review');
    await assert.rejects(paidRequest(request, async () => { throw new Error('must not send'); }), ReceiptUnknownError);
  }
});

test('releasing old revisions, unrelated failures and non-analysis requests does not reset an article', async () => {
  for (const variant of ['old-revision', 'other-failure', 'other-purpose']) {
    const { articleId, id } = await lostArticle(variant === 'other-purpose' ? 'x_article' : 'score_article');
    if (variant === 'old-revision') await sql`UPDATE articles SET revision = 2 WHERE id = ${articleId}`;
    if (variant === 'other-failure') await sql`UPDATE articles SET processing_error = 'permanent refusal' WHERE id = ${articleId}`;
    assert.equal((await autoReleaseUnknownReceipts()).requeued, 0, variant);
    const [article] = await sql`SELECT processing_state FROM articles WHERE id = ${articleId}`;
    assert.equal(article!.processing_state, 'failed');
    const [receipt] = await sql`SELECT status FROM receipts WHERE id = ${id}`;
    assert.equal(receipt!.status, 'failed');
    assert.equal((await sql`SELECT id FROM pgboss.job WHERE data->>'articleId' = ${articleId}`).length, 0);
  }
});

test('manual release resumes the matching split-step article and records the operator decision', async () => {
  const { articleId, id } = await lostArticle('structure_article');
  const result = await releaseReceipt(id, { billed: false, note: 'Provider billing checked in test' }, 'test-admin');
  assert.equal(result!.requeued, true);
  const [record] = await sql`SELECT actor, after FROM audit_log WHERE subject = ${`receipt:${id}`} ORDER BY id DESC LIMIT 1`;
  assert.equal(record!.actor, 'test-admin');
  assert.deepEqual(record!.after, { status: 'failed', billed: false, requeued: true });
  assert.equal((await sql`SELECT id FROM pgboss.job WHERE data->>'articleId' = ${articleId}`).length, 1);
});

test('a queue write failure rolls back the receipt release and article reset together', async () => {
  const { articleId, id } = await lostArticle('score_article');
  const boss = await getBoss();
  const send = boss.send;
  boss.send = async () => { throw new Error('queue write unavailable'); };
  try {
    await assert.rejects(releaseReceipt(id, { billed: false, note: 'Test rollback' }, 'test-admin'), /queue write unavailable/);
  } finally { boss.send = send; }
  const [receipt] = await sql`SELECT status FROM receipts WHERE id = ${id}`;
  const [attempt] = await sql`SELECT status FROM receipt_attempts WHERE receipt_id = ${id}`;
  const [article] = await sql`SELECT processing_state, processing_error FROM articles WHERE id = ${articleId}`;
  assert.equal(receipt!.status, 'unknown');
  assert.equal(attempt!.status, 'unknown');
  assert.deepEqual(article, { processing_state: 'failed', processing_error: `receipt ${id} outcome unknown` });
  assert.equal((await sql`SELECT id FROM audit_log WHERE subject = ${`receipt:${id}`}`).length, 0);
  assert.equal((await releaseReceipt(id, { billed: false, note: 'Queue restored' }, 'test-admin'))!.requeued, true);
});

// Seed lost responses and healthy traffic without calling a model or consuming a live budget.
async function secondUnknown(ageMinutes = 121, purpose = 'score_article') {
  const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${tag()}`,
    title: 'A lighting kit release', bodyText: 'Public technical specifications.', bodyStatus: 'ok', via: 'fetch' });
  const model = `recovery-model-${tag()}`;
  const [r] = await sql<{ id: number }[]>`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,attempts,updated_at)
    VALUES(${tag()},'llm',${model},${purpose},${`article:${articleId}@1`},'unknown',2,${new Date(Date.now()-ageMinutes*60_000)}) RETURNING id`;
  const id = r!.id;
  await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,error)
    VALUES(${id},1,'llm',${model},'failed','自动放行：结果未知超过 30 分钟，未核对是否计费'),
      (${id},2,'llm',${model},'unknown','response lost')`;
  await sql`UPDATE articles SET processing_state='failed',processing_error=${`receipt ${id} outcome unknown`} WHERE id=${articleId}`;
  return { articleId, id, model };
}

async function healthyCall(model: string, ageMinutes = 1, service = 'llm', origin = 'live') {
  const [r] = await sql<{ id: number }[]>`INSERT INTO receipts(logical_key,service,model,purpose,status,origin,attempts)
    VALUES(${tag()},${service},${model},'score_article','received',${origin},1) RETURNING id`;
  await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,origin,started_at,finished_at)
    VALUES(${r!.id},1,${service},${model},'received',${origin},
      ${new Date(Date.now()-ageMinutes*60_000-1000)},${new Date(Date.now()-ageMinutes*60_000)})`;
}

test('healthy service allows one delayed recovery of the current article, with no fourth automatic attempt', async () => {
  const { articleId, id, model } = await secondUnknown();
  await healthyCall(model);
  assert.deepEqual(await autoReleaseUnknownReceipts(), { released: 1, requeued: 1 });
  const [a] = await sql`SELECT processing_state,processing_error FROM articles WHERE id=${articleId}`;
  assert.deepEqual(a, { processing_state: 'new', processing_error: null });
  const jobs = await sql`SELECT data FROM pgboss.job WHERE data->>'articleId'=${articleId}`;
  assert.deepEqual(jobs.map(j => j.data), [{ articleId }]);
  const [record] = await sql`SELECT after FROM audit_log WHERE subject=${`receipt:${id}`} ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(record!.after, { status: 'failed', billed: null, requeued: true });
  const attempts = await sql`SELECT attempt,error FROM receipt_attempts WHERE receipt_id=${id} ORDER BY attempt`;
  assert.match(attempts[0]!.error, /^自动放行/);
  assert.match(attempts[1]!.error, /^延迟自动放行/);
  await sql`UPDATE receipts SET status='unknown',attempts=3,updated_at=now()-interval '3 hours' WHERE id=${id}`;
  await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status) VALUES(${id},3,'llm',${model},'unknown')`;
  await sql`UPDATE articles SET processing_state='failed',processing_error=${`receipt ${id} outcome unknown`} WHERE id=${articleId}`;
  assert.equal((await autoReleaseUnknownReceipts()).released, 0);
});

test('delayed recovery requires sufficient wait and recent live success on the same service and model', async () => {
  for (const variant of ['too-soon', 'no-success', 'wrong-model', 'wrong-service', 'old-success', 'imported-success', 'success-before-failure']) {
    const { articleId, id, model } = await secondUnknown(variant === 'too-soon' ? 119 : 121);
    if (variant !== 'no-success') await healthyCall(variant === 'wrong-model' ? `${model}-other` : model,
      variant === 'old-success' ? 31 : 1, variant === 'wrong-service' ? 'other-service' : 'llm',
      variant === 'imported-success' ? 'imported' : 'live');
    if (variant === 'success-before-failure') await sql`UPDATE receipt_attempts SET started_at=now()-interval '3 hours'
      WHERE model=${model} AND status='received'`;
    assert.equal((await autoReleaseUnknownReceipts()).released, 0, variant);
    // These negative fixtures should not be reconsidered by later test cases.
    await sql`UPDATE articles SET processing_state='analyzed',processing_error=NULL WHERE id=${articleId}`;
    await sql`UPDATE receipts SET status='failed' WHERE id=${id}`;
  }
});

test('delayed recovery leaves new revisions, unrelated failures, paused articles and non-article calls untouched', async () => {
  for (const variant of ['old-revision', 'other-failure', 'paused', 'other-purpose', 'too-many-attempts']) {
    const { articleId, id, model } = await secondUnknown(121, variant === 'other-purpose' ? 'report_daily' : 'score_article');
    await healthyCall(model);
    if (variant === 'old-revision') await sql`UPDATE articles SET revision=2 WHERE id=${articleId}`;
    if (variant === 'other-failure') await sql`UPDATE articles SET processing_error='permanent refusal' WHERE id=${articleId}`;
    if (variant === 'paused') await sql`UPDATE articles SET processing_state='paused' WHERE id=${articleId}`;
    if (variant === 'too-many-attempts') await sql`UPDATE receipts SET attempts=3 WHERE id=${id}`;
    const [before] = await sql`SELECT processing_state,processing_error FROM articles WHERE id=${articleId}`;
    assert.equal((await autoReleaseUnknownReceipts()).released, 0, variant);
    const [after] = await sql`SELECT processing_state,processing_error FROM articles WHERE id=${articleId}`;
    assert.deepEqual(after, before, variant);
    assert.equal((await sql`SELECT id FROM pgboss.job WHERE data->>'articleId'=${articleId}`).length, 0);
    await sql`UPDATE receipts SET status='failed' WHERE id=${id}`;
  }
});

test('delayed recovery is atomic when the queue silently refuses the job, and concurrent scans enqueue once', async () => {
  const { articleId, id, model } = await secondUnknown();
  await healthyCall(model);
  const boss = await getBoss();
  const send = boss.send;
  boss.send = async () => null;
  try { await assert.rejects(autoReleaseUnknownReceipts(), /receipt recovery did not enqueue/); }
  finally { boss.send = send; }
  const [r] = await sql`SELECT status FROM receipts WHERE id=${id}`;
  const [a] = await sql`SELECT processing_state FROM articles WHERE id=${articleId}`;
  assert.equal(r!.status, 'unknown');
  assert.equal(a!.processing_state, 'failed');
  const [attempt] = await sql`SELECT status,error FROM receipt_attempts WHERE receipt_id=${id} AND attempt=2`;
  assert.deepEqual(attempt, { status: 'unknown', error: 'response lost' });
  assert.equal((await sql`SELECT id FROM audit_log WHERE subject=${`receipt:${id}`}`).length, 0);
  const results = await Promise.all([autoReleaseUnknownReceipts(), autoReleaseUnknownReceipts()]);
  assert.equal(results.reduce((n, r) => n+r.requeued, 0), 1);
  assert.equal((await sql`SELECT id FROM pgboss.job WHERE data->>'articleId'=${articleId}`).length, 1);
});
