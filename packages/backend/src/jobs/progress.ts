// A handoff is not progress. Only new material or a settled successful model step resets the loop guard.
import { sql, type Db } from "../db.ts";

export const MAX_STALLED_HANDOFFS = 6;
type Stage = "analyze" | "extract";

interface ProgressRow {
  id: string; revision: number; processing_state: string; processing_guard_revision: number;
  processing_stage: string | null; processing_progress_key: string; processing_handoffs: number;
  processing_no_progress_handoffs: number; progress_key: string;
}

async function observe(articleId: string, stage: Stage, handoff: boolean, tx: Db): Promise<boolean> {
  const [a] = await tx<ProgressRow[]>`
    SELECT a.id,a.revision,a.processing_state,a.processing_guard_revision,a.processing_stage,
      a.processing_progress_key,a.processing_handoffs,a.processing_no_progress_handoffs,
      concat(a.body_status, ':', (SELECT count(*) FROM receipts r
        WHERE r.subject = 'article:' || a.id || '@' || a.revision
          AND r.status IN ('received','completed'))) AS progress_key
    FROM articles a WHERE a.id=${articleId} FOR UPDATE`;
  if (!a) return false;
  const fresh = a.processing_guard_revision !== a.revision;
  if (!fresh && a.processing_state === "paused") return false;
  const advanced = fresh || a.progress_key !== a.processing_progress_key;
  const switched = handoff && !fresh && !!a.processing_stage && a.processing_stage !== stage;
  const total = (fresh ? 0 : a.processing_handoffs) + Number(switched);
  const stalled = advanced ? 0 : a.processing_no_progress_handoffs + Number(switched);
  if (stalled > MAX_STALLED_HANDOFFS) {
    const reason = `同一版本超过 ${MAX_STALLED_HANDOFFS} 次阶段交接，没有取得新正文或完成新的模型阶段`;
    await tx`UPDATE articles SET processing_state='paused',processing_paused_at=now(),processing_pause_reason=${reason},
      processing_error=${'paused: '+reason},processing_queued_at=NULL,processing_retry_at=NULL,
      processing_handoffs=${total},processing_no_progress_handoffs=${stalled} WHERE id=${articleId}`;
    await tx`INSERT INTO audit_log(actor,action,subject,reason,before,after)
      VALUES('worker','article.processing-paused',${'content:'+articleId},${reason},
        ${tx.json({revision:a.revision,stage:a.processing_stage} as never)},
        ${tx.json({revision:a.revision,handoffs:total,noProgressHandoffs:stalled} as never)})`;
    return false;
  }
  await tx`UPDATE articles SET processing_guard_revision=revision,processing_stage=${stage},
    processing_progress_key=${a.progress_key},processing_handoffs=${total},processing_no_progress_handoffs=${stalled},
    processing_progress_at=CASE WHEN ${advanced} THEN now() ELSE processing_progress_at END,
    processing_failure_count=CASE WHEN ${fresh} THEN 0 ELSE processing_failure_count END,
    processing_paused_at=NULL,processing_pause_reason=NULL WHERE id=${articleId}`;
  return true;
}

/** Called before work and at successful stage boundaries; it never cancels an in-flight paid request. */
export async function processingProgress(articleId: string, stage: Stage, handoff = false): Promise<boolean> {
  return sql.begin(tx => observe(articleId, stage, handoff, tx));
}

/** Busy receipts, quota waits and process shutdowns never enter this counter. */
export async function processingFailure(articleId: string) {
  await sql`UPDATE articles SET processing_failure_count=processing_failure_count+1
    WHERE id=${articleId} AND processing_guard_revision=revision AND processing_state='new'`;
}

/** Explicit operator recovery starts a new observation window, keeping settled receipts and total counts. */
export async function resetProcessingGuard(articleId: string, db: Db = sql) {
  await db`UPDATE articles a SET processing_guard_revision=revision,processing_no_progress_handoffs=0,
    processing_stage=NULL,processing_paused_at=NULL,processing_pause_reason=NULL,
    processing_progress_key=concat(body_status, ':', (SELECT count(*) FROM receipts r
      WHERE r.subject='article:' || a.id || '@' || a.revision AND r.status IN ('received','completed')))
    WHERE a.id=${articleId}`;
}
