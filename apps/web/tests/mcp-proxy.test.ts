// Real production proxy and MCP server, with discovery only: no database or model calls.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_TOOL_NAMES } from "@aihot/contracts/mcp";
import { registerMcp } from "../../api/src/routes/mcp.ts";

const api = Fastify();
registerMcp(api);
api.post("/api/proxy-echo", async (req, reply) => reply
  .header("Connection", "keep-alive, x-hop-response")
  .header("X-Hop-Response", "private-hop")
  .header("MCP-Protocol-Version", "2025-11-25")
  .send({ body: req.body, hop: req.headers["x-hop-request"] ?? null, protocol: req.headers["mcp-protocol-version"] }));
let web: ChildProcess;
let origin: string;

before(async () => {
  const address = await api.listen({ host: "127.0.0.1", port: 0 });
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, API_BASE_URL: address, WEB_PORT: "0", COLLECT_ENABLED: "false", MODEL_CALLS_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let logs = "";
    const timeout = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timeout); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (chunk) => { logs += String(chunk); });
    web.stdout!.on("data", (chunk) => {
      logs += String(chunk);
      const match = logs.match(/"msg":"web started","port":(\d+)/);
      if (match) { origin = `http://127.0.0.1:${match[1]}`; clearTimeout(timeout); resolve(); }
    });
  });
});

after(async () => {
  if (web && web.exitCode === null) { web.kill("SIGTERM"); await once(web, "exit"); }
  api.server.closeAllConnections();
  await api.close();
});

test("legacy MCP completes initialization and successive requests behind Connection: close", { timeout: 15_000 }, async () => {
  for (let i = 0; i < 3; i++) {
    const client = new Client({ name: "proxy-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: { headers: { Connection: "close" } },
    });
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), Object.values(MCP_TOOL_NAMES).sort());
      await client.ping();
      assert.equal((await client.listTools()).tools.length, 5);
    } finally { await client.close(); }
  }
});

test("proxy reframes chunked bodies and strips nominated hop headers in both directions", { timeout: 5000 }, async () => {
  const result = await new Promise<{ headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request(`${origin}/api/proxy-echo`, {
      method: "POST", headers: {
        Connection: "close, x-hop-request", "X-Hop-Request": "private-hop",
        "Transfer-Encoding": "chunked", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25",
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write('{"message":');
    req.end('"影视技术"}');
  });
  assert.deepEqual(JSON.parse(result.body), { body: { message: "影视技术" }, hop: null, protocol: "2025-11-25" });
  assert.equal(result.headers["x-hop-response"], undefined);
  assert.equal(result.headers["mcp-protocol-version"], "2025-11-25");
  assert.equal(result.headers.connection, "close");
});
