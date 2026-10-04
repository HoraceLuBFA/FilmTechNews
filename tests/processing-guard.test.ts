import { stub, tag, gate } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { PgBoss } from 'pg-boss';
import Fastify from 'fastify';
import { createServer } from 'node:http';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { processingProgress, processingFailure, MAX_STALLED_HANDOFFS } from '@aihot/backend/jobs/progress';
import { processArticle, queueProcessing, registerContentJobs, registerExtractionJobs, sweepUnprocessed } from '@aihot/backend/jobs/content';
import { getBoss, stopBoss, QUEUES, enqueue } from '@aihot/backend/jobs/queue';
import { registerPrivateLog } from '../apps/api/src/routes/private-log.ts';
import { paidRequest } from '@aihot/backend/providers/receipts';
import { resumePausedArticle } from '@aihot/backend/jobs/content';

for (const name of Object.keys(process.env)) if (/_MODEL$/.test(name) && name !== 'LLM_MODEL' && name !== 'EMBEDDING_MODEL') delete process.env[name];
const provider = await stub(() => ({ choices: [{message: {content: JSON.stringify({label:'PASS',reason:'Technical presentation'})}}] }));
Object.assign(process.env,{LLM_BASE_URL:provider.url+'/v1',LLM_API_KEY:'test-key',LLM_MODEL:'one-model',MODEL_CALLS_ENABLED:'true'});
const t=tag(),source='test-guard-'+t,originalQueue=QUEUES.analyze;
Object.assign(QUEUES,{analyze:'test.processing-guard-'+t});
type Handler=(jobs:Array<{data:{articleId:string}}>)=>Promise<{state:string}|undefined>;
let handler: Handler;
const fake={work:async(_name:string,_opts:unknown,work:Handler)=>{handler=work;}} as unknown as PgBoss;
const app=Fastify({logger:false});registerPrivateLog(app);
const token='processing-guard-test-token-0123456789abcdef';process.env.PRIVATE_LOG_API_TOKEN=token;
const headers={'x-filmtech-log-token':token,'x-filmtech-log-user':'admin',origin:new URL(config.siteUrl).origin,'sec-fetch-site':'same-origin'};
const ids:string[]=[];
before(async()=>{
  await sql`INSERT INTO sources(id,name,kind,participation_mode,config,next_fetch_at)
    VALUES(${source},'Guard tests','rss','editorial','{"bodyPolicy":"prefilter_first"}','2100-01-01')`;
  await registerContentJobs(fake,1);
});
after(async()=>{
  await app.close();await provider.close();await stopBoss();
  await sql`DELETE FROM pgboss.job WHERE name=${QUEUES.analyze} OR data->>'articleId'=ANY(${ids}::text[])`;
  await sql`DELETE FROM audit_log WHERE subject=ANY(${ids.map(id=>'content:'+id)}::text[])`;
  await sql`DELETE FROM articles WHERE source_id=${source}`;await sql`DELETE FROM sources WHERE id=${source}`;
  Object.assign(QUEUES,{analyze:originalQueue});delete process.env.PRIVATE_LOG_API_TOKEN;await closeDb();
});
async function article(){const r=await upsertMaterial({sourceId:source,url:'https://example.com/guard-'+tag(),title:'Technical film production demonstration',excerpt:'Public technical presentation.',via:'fetch'});ids.push(r.articleId);return r.articleId;}
async function pause(id:string){
  assert.equal((await processArticle(id)).state,'fetching-body');
  for(let n=0;n<MAX_STALLED_HANDOFFS;n++)assert.equal(await processingProgress(id,n%2?'extract':'analyze',true),true);
  assert.equal(await processingProgress(id,'analyze',true),false);
}

test('a no-progress handoff loop pauses once, reuses the prefilter and stays out of automatic processing',async()=>{
  const id=await article(),hits=provider.hits();await pause(id);
  const [a]=await sql`SELECT processing_state,processing_handoffs,processing_no_progress_handoffs,processing_retry_at FROM articles WHERE id=${id}`;
  assert.equal(a!.processing_state,'paused');assert.equal(a!.processing_no_progress_handoffs,7);assert.equal(a!.processing_handoffs,8);assert.equal(a!.processing_retry_at,null);
  assert.equal((await processArticle(id)).state,'paused');assert.equal(await queueProcessing(id),null);
  const [before]=await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'articleId'=${id}`;
  await sweepUnprocessed();
  const [after]=await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'articleId'=${id}`;
  assert.equal(after!.n,before!.n);assert.equal(provider.hits()-hits,1);
  const [audit]=await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='article.processing-paused' AND subject=${'content:'+id}`;assert.equal(audit!.n,1);
});

test('only a new successful receipt or completed extraction resets the no-progress window',async()=>{
  const id=await article();await processingProgress(id,'analyze');
  for(let n=0;n<4;n++)await processingProgress(id,n%2?'analyze':'extract',true);
  await sql`INSERT INTO receipts(logical_key,service,purpose,subject,status) VALUES(${tag()},'llm','prefilter_article',${'article:'+id+'@1'},'received')`;
  await processingProgress(id,'extract',true);
  assert.equal((await sql`SELECT processing_no_progress_handoffs AS n FROM articles WHERE id=${id}`)[0]!.n,0);
  await sql`UPDATE receipts SET status='completed' WHERE subject=${'article:'+id+'@1'}`;
  await processingProgress(id,'analyze',true);
  assert.equal((await sql`SELECT processing_no_progress_handoffs AS n FROM articles WHERE id=${id}`)[0]!.n,1,'completion of the same receipt is not a new success');
  await sql`UPDATE articles SET body_status='unconfirmed' WHERE id=${id}`;await processingProgress(id,'extract',true);
  assert.equal((await sql`SELECT processing_no_progress_handoffs AS n FROM articles WHERE id=${id}`)[0]!.n,0);
});

test('a real new content revision clears the old pause and starts its own observation window',async()=>{
  const id=await article();await pause(id);
  const [a]=await sql`SELECT url FROM articles WHERE id=${id}`;
  await upsertMaterial({sourceId:source,url:a!.url,title:'Technical film production demonstration',excerpt:'New specifications and a meaningful source update.',via:'fetch'});
  assert.equal(await processingProgress(id,'analyze'),true);
  const [fresh]=await sql`SELECT processing_state,processing_guard_revision,processing_handoffs,processing_paused_at FROM articles WHERE id=${id}`;
  assert.deepEqual(fresh,{processing_state:'new',processing_guard_revision:2,processing_handoffs:0,processing_paused_at:null});
});

test('repeated quota waits do not count as failed work or no-progress handoffs',async()=>{
  const id=await article(),hits=provider.hits();const [budget]=await sql`SELECT per_minute FROM budgets WHERE service='llm'`;
  try{
    await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
    for(let n=0;n<8;n++)assert.equal((await handler([{data:{articleId:id}}]))!.state,'waiting');
    const [a]=await sql`SELECT processing_state,processing_handoffs,processing_failure_count FROM articles WHERE id=${id}`;
    assert.deepEqual(a,{processing_state:'new',processing_handoffs:0,processing_failure_count:0});assert.equal(provider.hits(),hits);
  }finally{await sql`UPDATE budgets SET per_minute=${budget!.per_minute} WHERE service='llm'`;}
});

test('unknown model results remain governed by the existing receipt rule',async()=>{
  const id=await article(),original=process.env.LLM_BASE_URL;let hits=0;
  const broken=createServer((req,res)=>{hits++;req.resume();req.on('end',()=>{res.writeHead(502,{'x-provider-outcome':'unknown'});res.end('unknown');});});
  await new Promise<void>(r=>broken.listen(0,'127.0.0.1',r));
  process.env.LLM_BASE_URL='http://127.0.0.1:'+(broken.address() as {port:number}).port+'/v1';
  try{
    const outcome=await handler([{data:{articleId:id}}]);
    const [diagnostic]=await sql`SELECT processing_error FROM articles WHERE id=${id}`;
    assert.equal(outcome!.state,'unknown-receipt',JSON.stringify({hits,error:diagnostic!.processing_error}));
    assert.equal((await processArticle(id)).state,'unknown-receipt');assert.equal(hits,1);
    const [a]=await sql`SELECT processing_state,processing_failure_count,processing_handoffs FROM articles WHERE id=${id}`;
    assert.deepEqual(a,{processing_state:'failed',processing_failure_count:0,processing_handoffs:0});
  }finally{process.env.LLM_BASE_URL=original;await new Promise<void>(r=>broken.close(()=>r()));}
});

test('busy model slots do not count as failures or consume the loop allowance',async()=>{
  const id=await article(),started=gate(),finish=gate();
  const limit=config.llmMaxConcurrentCalls,reserve=config.llmReportConcurrentReserve;
  config.llmMaxConcurrentCalls=1;config.llmReportConcurrentReserve=0;
  const held=paidRequest({service:'llm',purpose:'report_hold_test',subject:'test:'+tag(),identity:{hold:tag()}},async()=>{
    started.open();await finish.promise;return {response:{ok:true}};
  });
  try{
    await started.promise;
    for(let n=0;n<8;n++)assert.equal((await handler([{data:{articleId:id}}]))!.state,'waiting');
    const [a]=await sql`SELECT processing_handoffs,processing_failure_count FROM articles WHERE id=${id}`;
    assert.deepEqual(a,{processing_handoffs:0,processing_failure_count:0});
  }finally{finish.open();await held;config.llmMaxConcurrentCalls=limit;config.llmReportConcurrentReserve=reserve;}
});

test('reader quota waits resume extraction directly and never consume the loop or failure allowance',async()=>{
  const id=await article();await processingProgress(id,'extract');
  await sql`UPDATE articles SET x_post='{"tweetId":"1800000000000000000"}' WHERE id=${id}`;
  let extract:Handler;await registerExtractionJobs({work:async(_name:string,_opts:unknown,fn:Handler)=>{extract=fn;}} as unknown as PgBoss);
  const [budget]=await sql`SELECT per_day FROM budgets WHERE service='socialdata'`;
  process.env.SOCIALDATA_API_KEY='test-key';
  try{
    await sql`UPDATE budgets SET per_day=0 WHERE service='socialdata'`;
    for(let n=0;n<8;n++){
      assert.equal((await extract!([{data:{articleId:id}}]))!.state,'waiting');
      await queueProcessing(id);
    }
    const [a]=await sql`SELECT processing_state,processing_no_progress_handoffs,processing_failure_count FROM articles WHERE id=${id}`;
    assert.deepEqual(a,{processing_state:'new',processing_no_progress_handoffs:0,processing_failure_count:0});
    const [jobs]=await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'articleId'=${id} AND name=${QUEUES.analyze}`;assert.equal(jobs!.n,0);
  }finally{await sql`UPDATE budgets SET per_day=${budget!.per_day} WHERE service='socialdata'`;delete process.env.SOCIALDATA_API_KEY;}
});

test('retry work yields to a fresh article even when it already owns successful results',async()=>{
  const retry=await article(),fresh=await article();await processingProgress(retry,'analyze');await processingFailure(retry);
  await sql`INSERT INTO receipts(logical_key,service,purpose,subject,status) VALUES(${tag()},'llm','prefilter_article',${'article:'+retry+'@1'},'received')`;
  const older=await queueProcessing(retry),newer=await queueProcessing(fresh);
  const rows=await sql`SELECT id,priority FROM pgboss.job WHERE id=ANY(${[older!,newer!]}::uuid[]) ORDER BY priority DESC`;
  assert.equal(rows[0]!.id,newer);assert.equal(rows[1]!.priority,-1);
});

test('private recovery requires authentication, same origin and an exact paused version, then reuses its receipt',async()=>{
  const id=await article();await pause(id);const [a]=await sql`SELECT processing_paused_at::text AS stamp FROM articles WHERE id=${id}`;
  const url='/api/private-log/processing/'+id+'/resume',payload={revision:1,pausedAt:a!.stamp};
  assert.equal((await app.inject({method:'PATCH',url,payload})).statusCode,403);
  assert.equal((await app.inject({method:'PATCH',url,headers:{...headers,origin:'https://elsewhere.invalid'},payload})).statusCode,403);
  assert.equal((await app.inject({method:'PATCH',url,headers,payload:{...payload,revision:2}})).statusCode,409);
  const resumed=await app.inject({method:'PATCH',url,headers,payload});assert.equal(resumed.statusCode,200);
  const [recovery]=await sql`SELECT priority FROM pgboss.job WHERE id=${resumed.json().jobId}`;
  assert.equal(recovery!.priority,-1,'a recovered loop article still yields to fresh news');
  assert.equal((await app.inject({method:'PATCH',url,headers,payload})).statusCode,409);
  const hits=provider.hits();assert.equal((await processArticle(id)).state,'fetching-body');assert.equal(provider.hits(),hits);
  assert.equal((await sql`SELECT processing_handoffs AS n FROM articles WHERE id=${id}`)[0]!.n,9);
});

test('failed recovery queue writes preserve the pause, guard counters and audit state',async()=>{
  const id=await article();await pause(id);const [a]=await sql`SELECT processing_paused_at::text AS stamp FROM articles WHERE id=${id}`;
  const boss=await getBoss(),send=boss.send;boss.send=async()=>{throw Error('queue write unavailable');};
  try{await assert.rejects(resumePausedArticle(id,1,a!.stamp,'test-admin'),/queue write unavailable/);}
  finally{boss.send=send;}
  const [state]=await sql`SELECT processing_state,processing_no_progress_handoffs AS n FROM articles WHERE id=${id}`;
  assert.deepEqual(state,{processing_state:'paused',n:7});
  const [audit]=await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='article.processing-resumed' AND subject=${'content:'+id}`;assert.equal(audit!.n,0);
});

test('a real serial worker skips the paused first job and completes the healthy following article without model requests',async()=>{
  await sql`DELETE FROM pgboss.job WHERE name=${QUEUES.analyze}`;
  const paused=await article(),healthy=await article();await pause(paused);
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,selected,title_zh,summary_zh)
    VALUES(${healthy},1,'rule','block',false,'正常完成的材料','已有完成的筛选结果。')`;
  const badJob=await enqueue(QUEUES.analyze,{articleId:paused},{priority:10}),goodJob=await queueProcessing(healthy);
  const hits=provider.hits();await registerContentJobs(await getBoss(),1);
  const until=Date.now()+15000;let finished=false;
  while(Date.now()<until){
    const rows=await sql`SELECT id,state,output,started_on,completed_on FROM pgboss.job WHERE id=ANY(${[badJob!,goodJob!]}::uuid[])`;
    if(rows.every(r=>r.state==='completed')){
      const bad=rows.find(r=>r.id===badJob)!,good=rows.find(r=>r.id===goodJob)!;
      assert.equal(bad.output.state,'paused');assert.equal(good.output.state,'block');assert.ok(good.started_on>=bad.completed_on);finished=true;break;
    }
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(finished,true);assert.equal(provider.hits(),hits);
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${healthy}`)[0]!.processing_state,'blocked');
});
