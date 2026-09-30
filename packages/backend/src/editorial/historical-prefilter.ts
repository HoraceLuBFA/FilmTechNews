// Explicit maintenance batches reduce CLI startup overhead for high-volume industry feeds.
// They only judge relevance; normal article scoring, writing and publication remain unchanged.
import { z } from "zod";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { sql } from "../db.ts";
import { modelFor } from "./models.ts";
import { loadAnalyzeInput } from "./input.ts";
import { prefilterUser, PREFILTER_SYSTEM } from "./writing.ts";
import { promptVersion } from "./prompts.ts";
import { sha256 } from "../lib/ids.ts";
import type { AnalysisRun } from "./analyze.ts";

export async function prefilterHistoricalBatch(ids: string[]) {
  if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length) throw Error("Historical prefilter batches require 1–8 unique articles");
  const inputs=await Promise.all(ids.map(loadAnalyzeInput));
  if(inputs.some(x=>!x))throw Error("Historical prefilter article missing");
  const rows=inputs.map(a=>({articleId:a!.id,revision:a!.revision,material:prefilterUser(a!)}));
  const schema=z.object({items:z.array(z.object({articleId:z.enum(ids as [string,...string[]]),label:z.enum(["PASS","BLOCK","UNKNOWN"]),reason:z.string().max(120)})).length(ids.length)}).refine(x=>new Set(x.items.map(i=>i.articleId)).size===ids.length,"Every article must have exactly one judgement");
  const response=await chatJson({model:await modelFor("prefilter"),purpose:"historical_prefilter_batch",subject:"history-prefilter:"+sha256(JSON.stringify(rows)).slice(0,24),
    promptVersion:promptVersion("prefilter")+":historical-batch-v1",
    system:PREFILTER_SYSTEM+"\n本次包含多篇独立材料，逐篇按同一标准判定，禁止把一篇的事实借给另一篇。输出 {items:[{articleId,label,reason}]}，每个输入ID恰好一次。正文缺失或仅标题不足以确定无关时返回UNKNOWN。",
    user:JSON.stringify(rows),schema,temperature:0,maxTokens:2000});
  // The validated batch result is the business result of this receipt; per-article analyses cite it.
  await completeReceipt(sql,response.receiptId);
  return new Map(response.data.items.map(item=>{
    const a=inputs.find(a=>a!.id===item.articleId)!;
    const result:AnalysisRun["prefilter"]={label:item.label,reason:item.reason,model:response.model,receiptId:response.receiptId,reused:response.reused};
    return [item.articleId,{articleId:item.articleId,revision:a!.revision,result}] as const;
  }));
}
