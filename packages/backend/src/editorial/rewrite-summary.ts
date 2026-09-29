// Refresh the writing only. Keep the previous judgement and all its evidence intact.
import { sql } from "../db.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { publishArticle } from "../publication/publish.ts";
import { loadAnalyzeInput, PROMPT_VERSIONS, runSummarize } from "./analyze.ts";

export async function rewriteSummary(articleId: string) {
  const input = await loadAnalyzeInput(articleId);
  if (!input || input.xPost || input.source.kind === "x_search") return { status: "skipped" };
  const [base] = await sql<{ id: number; input_revision: number; output: Record<string, any> | null; manual: boolean }[]>`
    SELECT j.id, j.input_revision, j.output, COALESCE(o.fields ? 'summary', false) AS manual
    FROM analyses j LEFT JOIN editorial_overrides o ON o.article_id = j.article_id
    WHERE j.article_id = ${articleId} ORDER BY j.input_revision DESC, j.id DESC LIMIT 1`;
  if (!base || base.manual || base.input_revision !== input.revision) return { status: "skipped" };
  if (base.output?.summaryRewrite?.promptVersion === PROMPT_VERSIONS.summarize) {
    await publishArticle(articleId); // Also completes publication if an earlier run stopped after commit.
    return { status: "current" };
  }
  const writing = await runSummarize(input, {});
  const committed = await sql.begin(async (tx) => {
    const [article] = await tx`SELECT revision FROM articles WHERE id = ${articleId} FOR UPDATE`;
    const [latest] = await tx`SELECT id FROM analyses WHERE article_id = ${articleId} ORDER BY input_revision DESC, id DESC LIMIT 1`;
    const [override] = await tx`SELECT fields FROM editorial_overrides WHERE article_id = ${articleId}`;
    for (const id of writing.receiptIds) await completeReceipt(tx, id);
    if (article?.revision !== input.revision || latest?.id !== base.id || override?.fields?.summary !== undefined) return "stale";
    if (!writing.summaryZh?.trim()) return "empty"; // A failed guard never erases a usable summary.
    const metadata = { ...(base.output ?? {}), summaryRewrite: { promptVersion: PROMPT_VERSIONS.summarize, model: writing.model, receiptIds: writing.receiptIds, previousAnalysisId: base.id } };
    await tx`
      INSERT INTO analyses (article_id, input_revision, origin, model, prompt_version, receipt_ids, relevance, category, tags,
        subjects, title_zh, summary_zh, reason_zh, score, selected, output)
      SELECT article_id, input_revision, 'model', model, prompt_version, receipt_ids || ${writing.receiptIds}::bigint[], relevance, category, tags,
        subjects, title_zh, ${writing.summaryZh}, reason_zh, score, selected, ${tx.json(metadata as never)}
      FROM analyses WHERE id = ${base.id}`;
    return "updated";
  });
  if (committed === "updated") await publishArticle(articleId);
  return { status: committed, chars: writing.summaryZh?.length ?? 0 };
}
