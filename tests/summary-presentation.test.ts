import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanReaderSummary } from "@aihot/backend/editorial/summary";

test("summary presentation removes acquisition notes and keeps reporting facts and technical limits", () => {
  const facts = "索尼报道称，设备支持 4K 120fps。测试受样本分辨率限制，作者无法确认结果是否适用于其他模式。";
  assert.equal(cleanReaderSummary(`综合产业媒体线索，仅依据公开 RSS 标题与摘要，未读取付费正文。\n\n${facts}\n\n现有正文在发言开头处截断，且可能仅为来源摘要，因此无法确认更多细节。`), facts);
  assert.equal(cleanReaderSummary("原文称，法案仍须通过立法程序；现有材料仅包含标题和简短导语，未提供更多细节。"), "原文称，法案仍须通过立法程序。");
  assert.equal(cleanReaderSummary("由于材料完整性未确认，以上仅依据现有来源摘要整理，未涵盖更多细节。\n\n" + facts), facts);
});
