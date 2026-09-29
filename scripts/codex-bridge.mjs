// Private worker-side adapter. Never publish this listener through the site reverse proxy.
import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { codexCompletion } from './lib/codex-client.mjs';
const token = process.env.CODEX_BRIDGE_TOKEN;
const model = process.env.CODEX_BRIDGE_MODEL || 'gpt-6-astra';
const host = process.env.CODEX_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.env.CODEX_BRIDGE_PORT || 3320);
if (!token || token.length < 32) throw new Error('Set a private CODEX_BRIDGE_TOKEN of at least 32 characters');
let active = 0;
const server = createServer(async (req, res) => {
  const reply = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { error: 'Unauthorized' });
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, model, active });
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return reply(404, { error: 'Not found' });
  if (active >= 4) return reply(429, { error: 'Private model worker is busy' });
  let body = '';
  try {
    for await (const chunk of req) { body += chunk; if (body.length > 160_000) return reply(413, { error: 'Input too large' }); }
    body = JSON.parse(body);
  } catch { return reply(400, { error: 'Invalid JSON' }); }
  if (body.model !== model || !Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string')) return reply(400, { error: 'Configured model and system/user text messages required' });
  active++;
  try {
    const result = await codexCompletion(body.messages, { model, binary: process.env.CODEX_BINARY || 'codex' });
    reply(200, { id: `codex-${randomUUID()}`, model, choices: [{ message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }], usage: result.usage, provider: 'codex-chatgpt', cost: null });
  } catch {
    // A killed or failed CLI may already have consumed quota. Receipts must not auto-retry it.
    reply(502, { error: 'Codex result unavailable; inspect the receipt before retrying' }, { 'x-provider-outcome': 'unknown' });
  } finally { active--; }
});
server.requestTimeout = 120_000;
server.listen(port, host, () => console.log(`Private Codex bridge listening on ${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
