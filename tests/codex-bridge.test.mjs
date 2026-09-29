import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexCompletion } from '../scripts/lib/codex-client.mjs';

test('CLI adapter preserves model usage and only the final message; disables host tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filmtech-adapter-test-'));
  const binary = join(dir, 'fake-codex');
  try {
    await writeFile(binary, `#!/usr/bin/env node\nconst a=process.argv.slice(2); if(!a.includes('--ignore-user-config')||!a.includes('features.shell_tool=false')||!a.includes('model_reasoning_effort=\"high\"')||!a.includes('test-model')||process.env.FILMTECH_TEST_SECRET)process.exit(3); process.stdin.resume(); process.stdin.on('end',()=>{ console.log(JSON.stringify({type:'error',message:'transient reconnect'})); console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'non-fatal config warning'}})); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"ok":true}'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:5,output_tokens:3}}));});`, { mode: 0o700 });
    process.env.FILMTECH_TEST_SECRET='must-not-be-forwarded';
    const out=await codexCompletion([{role:'system',content:'Output JSON'},{role:'user',content:'test'}],{model:'test-model',binary});
    assert.equal(out.content,'{"ok":true}');
    assert.deepEqual(out.usage,{input_tokens:5,output_tokens:3});
    await writeFile(binary, `#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution'}}));console.log(JSON.stringify({type:'turn.completed'}));});`, {mode:0o700});
    await assert.rejects(codexCompletion([{role:'user',content:'test'}],{model:'test-model',binary}),/unknown/);
    await writeFile(binary,'#!/usr/bin/env node\nsetInterval(()=>{},1000);',{mode:0o700});
    await assert.rejects(codexCompletion([{role:'user',content:'test'}],{model:'test-model',binary,timeoutMs:100}),/timeout/);
  } finally {delete process.env.FILMTECH_TEST_SECRET;await rm(dir,{recursive:true,force:true});}
});
