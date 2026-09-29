import './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {z} from 'zod';
import {chatJson} from '@aihot/backend/providers/llm';
import {closeDb,sql} from '@aihot/backend/db';
import {ReceiptUnknownError} from '@aihot/backend/providers/receipts';
test('adapter uncertainty stays unknown and an immediate retry makes no second call',async()=>{
 let hits=0;
 const server=http.createServer((_req,res)=>{hits++;res.writeHead(502,{'x-provider-outcome':'unknown'});res.end('{}');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 process.env.LLM_BASE_URL=`http://127.0.0.1:${port}/v1`;process.env.LLM_API_KEY='test';process.env.LLM_MODEL='codex-test';
 const subject=`adapter-unknown-${Date.now()}`;
 const ask=()=>chatJson({model:'default',purpose:'adapter_test',subject,promptVersion:'v1',system:'s',user:subject,schema:z.object({ok:z.boolean()})});
 try {
  await assert.rejects(ask(),/outcome unknown/);
  const [r]=await sql`select status from receipts where subject=${subject}`;
  assert.equal(r!.status,'unknown');
  await assert.rejects(ask(),ReceiptUnknownError);assert.equal(hits,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await closeDb();}
});
