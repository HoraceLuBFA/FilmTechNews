// Private worker-side adapter. Never publish this listener through the site reverse proxy.
import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { codexCompletion, CodexOutcomeError } from './lib/codex-client.mjs';
const token = process.env.CODEX_BRIDGE_TOKEN;
const model = process.env.CODEX_BRIDGE_MODEL || 'gpt-5.6-sol';
const host = process.env.CODEX_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.env.CODEX_BRIDGE_PORT || 3320);
const timeoutMs = Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 110_000);
const maxConcurrent = Number(process.env.CODEX_BRIDGE_CONCURRENCY || 4);
if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) throw new Error('CODEX_BRIDGE_CONCURRENCY must be between 1 and 16');
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) throw new Error('CODEX_BRIDGE_TIMEOUT_MS must be between 1000 and 900000');
if (!token || token.length < 32) throw new Error('Set a private CODEX_BRIDGE_TOKEN of at least 32 characters');
let active = 0;
const server = createServer(async (req, res) => {
  const reply = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { error: 'Unauthorized' });
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, model, reasoningEffort: 'medium', timeoutMs, maxConcurrent, active });
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return reply(404, { error: 'Not found' });
  if (active >= maxConcurrent) return reply(429, { error: 'Private model worker is busy' });
  let body = '';
  try {
    for await (const chunk of req) { body += chunk; if (body.length > 160_000) return reply(413, { error: 'Input too large' }); }
    body = JSON.parse(body);
  } catch { return reply(400, { error: 'Invalid JSON' }); }
  if (body.model !== model || !Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string')) return reply(400, { error: 'Configured model and system/user text messages required' });
  active++;
  const started = Date.now();
  try {
    const result = await codexCompletion(body.messages, { model, timeoutMs, binary: process.env.CODEX_BINARY || 'codex' });
    reply(200, { id: `codex-${randomUUID()}`, model, choices: [{ message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }], usage: result.usage, provider: 'codex-chatgpt', cost: null });
  } catch (error) {
    console.error(JSON.stringify({ event: 'codex-outcome-unknown', reason: error instanceof CodexOutcomeError ? error.reason : 'spawn', exitCode: error instanceof CodexOutcomeError ? error.exitCode : null, elapsedMs: Date.now() - started }));
    // A killed or failed CLI may already have consumed quota. Receipts must not auto-retry it.
    reply(502, { error: 'Codex result unavailable; inspect the receipt before retrying' }, { 'x-provider-outcome': 'unknown' });
  } finally { active--; }
});
server.requestTimeout = timeoutMs + 10_000;
server.listen(port, host, () => console.log(`Private Codex bridge listening on ${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
