// The analysis-to-extraction handoff must preserve failures so bounded retries can finish.
import { Reply, stub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { PgBoss } from 'pg-boss';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { extractFromUrl } from '@aihot/backend/content/extract';
import { registerContentJobs, registerExtractionJobs } from '@aihot/backend/jobs/content';
import { QUEUES, stopBoss } from '@aihot/backend/jobs/queue';

for (const name of Object.keys(process.env)) if (/_MODEL$/.test(name) && name !== 'LLM_MODEL' && name !== 'EMBEDDING_MODEL') delete process.env[name];
let prefilters = 0;
const provider = await stub((_hit, req) => {
  if (req.url === '/v1/chat/completions') {
    prefilters++;
    return { choices: [{ message: { content: JSON.stringify({ label: 'PASS', reason: '技术演示' }) } }] };
  }
  return new Reply(500, { error: 'temporary extraction failure' });
});
Object.assign(process.env, { LLM_BASE_URL: provider.url+'/v1', LLM_API_KEY: 'test-key', LLM_MODEL: 'one-model', MODEL_CALLS_ENABLED: 'true',
  JINA_API_KEY: 'test-key', JINA_BASE_URL: provider.url });
const source = 'test-extraction-'+tag();
type Handler = (jobs: Array<{ data: { articleId: string } }>) => Promise<{ state: string } | undefined>;
const handlers: Record<string, Handler> = {};
const boss = { work: async (name: string, _opts: unknown, handler: Handler) => { handlers[name] = handler; } } as unknown as PgBoss;
before(async () => {
  await sql`INSERT INTO sources(id,name,kind,participation_mode,config,next_fetch_at)
    VALUES(${source},'Extraction test','rss','editorial','{"bodyPolicy":"prefilter_first"}','2100-01-01')`;
  await registerContentJobs(boss, 1);
  await registerExtractionJobs(boss);
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

test('three extraction failures across analysis handoffs stop instead of cycling forever', async () => {
  const { articleId } = await upsertMaterial({ sourceId: source, url: 'https://example.com/extraction-'+tag(),
    title: 'A technical visual effects presentation', excerpt: 'A technical presentation.', via: 'fetch' });
  const jobs = [{ data: { articleId } }];
  for (let attempt=1; attempt<=3; attempt++) {
    await sql`UPDATE articles SET processing_retry_at=NULL WHERE id=${articleId}`;
    assert.equal((await handlers[QUEUES.analyze]!(jobs))!.state, 'fetching-body');
    const [handoff] = await sql`SELECT processing_attempts,processing_queued_at FROM articles WHERE id=${articleId}`;
    assert.equal(handoff!.processing_attempts, attempt-1, 'analysis does not erase extraction failures');
    assert.ok(handoff!.processing_queued_at, 'the extraction queue handoff remains recorded');
    assert.equal((await handlers[QUEUES.extractBody]!(jobs))!.state, attempt<3 ? 'retrying' : 'unconfirmed');
  }
  const [article] = await sql`SELECT body_status,processing_attempts,processing_retry_at,processing_error FROM articles WHERE id=${articleId}`;
  assert.deepEqual(article, { body_status: 'unconfirmed', processing_attempts: 0, processing_retry_at: null, processing_error: null });
  assert.equal(prefilters, 1, 'the same successful prefilter is reused across handoffs');
});

test('an unconfigured optional reader fallback sends no request and leaves extraction unconfirmed', async () => {
  delete process.env.JINA_API_KEY;
  try {
    const hits = provider.hits();
    assert.equal(await extractFromUrl('https://example.com/missing-reader', { allowJina: true, subject: 'test-unconfigured' }), null);
    assert.equal(provider.hits(), hits);
    const { articleId } = await upsertMaterial({ sourceId: source, url: 'https://example.com/unconfigured-'+tag(), title: 'A video page', via: 'fetch' });
    await sql`UPDATE articles SET processing_attempts=1,processing_error='extract: old failure',processing_retry_at=now() WHERE id=${articleId}`;
    assert.equal((await handlers[QUEUES.extractBody]!([{data:{articleId}}]))!.state, 'unconfirmed');
    const [article] = await sql`SELECT processing_attempts,processing_error,processing_retry_at FROM articles WHERE id=${articleId}`;
    assert.deepEqual(article, { processing_attempts: 0, processing_error: null, processing_retry_at: null });
    assert.equal(provider.hits(), hits);
  } finally { process.env.JINA_API_KEY='test-key'; }
});
