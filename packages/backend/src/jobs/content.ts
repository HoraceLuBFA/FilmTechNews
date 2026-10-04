// Content processing: body extraction when the source needs it → analysis → publish → event grouping.
// Every article reaches the queues through queueProcessing, which records when it was queued, so the
// safety net only picks up articles nothing is working on and sends those still waiting for a body to
// extraction first. A provider outage makes an article wait and retry with backoff; only a permanent
// refusal or exhausted retries end in "failed", which the admin re-queues in bulk.
import type { PgBoss } from "pg-boss";
import { sql, type Db } from "../db.ts";
import { extractArticleBody, pageFetchable } from "../content/extract.ts";
import { analyzeArticle, AnalysisInterruptedError } from "../editorial/analyze.ts";
import { isHistorical } from "../content/materials.ts";
import { publishArticle } from "../publication/publish.ts";
import { BudgetExceededError, ProviderRejectedError, ReceiptBusyError, ReceiptUnknownError } from "../providers/receipts.ts";
import { ModelOutputError } from "../providers/llm.ts";
import { ensureQueue, enqueue, QUEUES, shutdownSignal } from "./queue.ts";
import { processingProgress, processingFailure, resetProcessingGuard, MAX_STALLED_HANDOFFS } from "./progress.ts";

/** Minutes to wait after the n-th failed attempt; one more failure after the last ends in "failed". */
const RETRY_MINUTES = [5, 10, 20, 40, 60, 120, 240, 360];
/** Unusable model output is retried less: each retry is a paid call. */
const MAX_OUTPUT_FAILURES = 3;
/** Extraction gives up after this many errors and the article is judged on what it has. */
const MAX_EXTRACT_FAILURES = 3;
/** A queued article whose job left no trace for this long is queued again. */
const QUEUED_STALE = "30 minutes";

type Step = "extract" | "analyze";

interface Route {
  step: Step;
  /** Not an editorial source: no analysis; the post goes straight to event grouping as discussion evidence. */
  signal: boolean;
  historical: boolean;
  continuing: boolean;
  retrying: boolean;
  paused: boolean;
}

/**
 * The article's next step: its body first while none is confirmed and the source asks for full text,
 * when there is only a title or a feed summary (the analysis judges the whole article), or when an
 * X post links an X Article (fetched before judging; for a discussion post only while it is news, as
 * history adds no heat).
 */
async function route(articleId: string, db: Db): Promise<Route | null> {
  const [row] = await db<{ body_status: string; participation_mode: string; kind: string; config: Record<string, unknown>; url: string; bare: boolean; backfill: boolean; published_at: Date | null; discovered_at: Date; continuing: boolean; retrying: boolean; paused: boolean; extracting: boolean }[]>`
    SELECT a.body_status, s.participation_mode, s.kind, s.config, a.url, (coalesce(a.body_text, '') = '' AND a.x_post IS NULL) AS bare,
           a.backfill, a.published_at, a.discovered_at,
           EXISTS (SELECT 1 FROM receipts r WHERE r.subject = 'article:' || a.id || '@' || a.revision
             AND r.status = 'received') AS continuing,
           (a.processing_attempts>0 OR (a.processing_guard_revision=a.revision AND
             (a.processing_failure_count>0 OR a.processing_no_progress_handoffs>0 OR a.processing_handoffs>${MAX_STALLED_HANDOFFS}))) AS retrying,
           (a.processing_state='paused' AND a.processing_guard_revision=a.revision) AS paused,
           (a.processing_stage='extract' AND a.processing_guard_revision=a.revision) AS extracting
    FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${articleId}`;
  if (!row) return null;
  const historical = isHistorical(row);
  const signal = row.participation_mode !== "editorial";
  const pending = row.body_status === "pending";
  const wantsBody = row.config.fetchPublicContent === true || !!row.config.detail || row.kind === "web_list";
  const needsPage = !row.config.bodyPolicy && !signal && (wantsBody || (row.bare && pageFetchable(row.url, row.kind)));
  const needsXArticle = row.kind === "x_search" && (!signal || (row.participation_mode === "hot_signal" && !historical));
  return { step: pending && (needsPage || needsXArticle || row.extracting) ? "extract" : "analyze", signal, historical, continuing: row.continuing, retrying: row.retrying, paused: row.paused };
}

/**
 * Queue order (pg-boss serves higher priority first): live work before history, so a new source's
 * first import or a backfill never holds up today's news; discussion evidence waits behind reports
 * in the serial grouping queue, history behind both.
 */
const PRIORITY = { continuing: 1, live: 0, retry: -1, liveSignal: -1, history: -2 } as const;

/**
 * The one way to hand an article to processing. `attemptTag` makes an explicit re-evaluation a new
 * (paid) request; the same tag reuses its receipt. With `db`, the job commits with the caller's write.
 * Posts of non-editorial sources skip the analysis queue: they only need recording and grouping.
 */
export async function queueProcessing(articleId: string, opts: { step?: Step; attemptTag?: string; db?: Db } = {}): Promise<string | null> {
  const db = opts.db ?? sql;
  const r = await route(articleId, db);
  if (!r || r.paused) return null;
  const step = opts.step ?? r.step;
  await db`UPDATE articles SET processing_queued_at = now() WHERE id = ${articleId}`;
  if (step === "extract") return enqueue(QUEUES.extractBody, { articleId }, { singletonKey: articleId, priority: r.historical ? PRIORITY.history : r.retrying ? PRIORITY.retry : PRIORITY.live }, opts.db);
  if (r.signal && !opts.attemptTag) {
    return enqueue(QUEUES.group, { articleId, signalOnly: true }, { singletonKey: articleId, priority: r.historical ? PRIORITY.history : PRIORITY.liveSignal }, opts.db);
  }
  const tagged = !!opts.attemptTag;
  return enqueue(QUEUES.analyze, tagged ? { articleId, attemptTag: opts.attemptTag } : { articleId },
    { singletonKey: tagged ? `manual:analyze:${articleId}:${opts.attemptTag}` : articleId,
      priority: r.historical ? PRIORITY.history : r.retrying ? PRIORITY.retry : !tagged && r.continuing ? PRIORITY.continuing : PRIORITY.live }, opts.db);
}

/**
 * A post of a non-editorial source: recorded (hot_signal material only feeds heat; isolated material
 * never reaches public surfaces). Returns whether it is discussion evidence to group.
 */
export async function settleNonEditorial(articleId: string): Promise<{ group: boolean }> {
  const [row] = await sql<{ participation_mode: string; backfill: boolean; published_at: Date | null; discovered_at: Date }[]>`
    UPDATE articles a SET processing_state = 'skipped', processing_attempts = 0, processing_retry_at = NULL, processing_queued_at = NULL
    FROM sources s WHERE s.id = a.source_id AND a.id = ${articleId} AND s.participation_mode <> 'editorial'
    RETURNING s.participation_mode, a.backfill, a.published_at, a.discovered_at`;
  if (!row) return { group: false };
  await publishArticle(articleId);
  return { group: row.participation_mode === "hot_signal" && !isHistorical(row) };
}

/** attemptTag makes an explicit re-evaluation a new (paid) request; the same tag reuses its receipt. */
export async function processArticle(articleId: string, opts: { attemptTag?: string } = {}): Promise<{ state: string }> {
  const startedAt = new Date();
  const [found] = await sql<{ participation_mode: string; processing_state: string; revision: number; backfill: boolean; published_at: Date | null; discovered_at: Date }[]>`
    SELECT s.participation_mode, a.processing_state, a.revision, a.backfill, a.published_at, a.discovered_at FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${articleId}`;
  if (!found) return { state: "missing" };
  if (!await processingProgress(articleId, "analyze")) return { state: "paused" };
  const row = { ...found, historical: isHistorical(found) };
  if (row.participation_mode !== "editorial") {
    // Normally queued straight for grouping (queueProcessing); an explicit re-evaluation lands here.
    const { group } = await settleNonEditorial(articleId);
    if (group) await enqueue(QUEUES.group, { articleId, signalOnly: true }, { singletonKey: articleId, priority: PRIORITY.liveSignal });
    return { state: "skipped" };
  }
  try {
    // Operator backfills may finish an article while its original queue job is
    // still waiting. Reuse that committed revision before opening another paid
    // prefilter request; an explicit attemptTag still requests re-evaluation.
    if (!opts.attemptTag) {
      const [completed] = await sql<{ relevance: string }[]>`
        UPDATE articles a SET processing_state = CASE WHEN x.relevance = 'block' THEN 'blocked' ELSE 'analyzed' END,
          processing_error = NULL, processing_attempts = 0, processing_retry_at = NULL, processing_queued_at = NULL
        FROM analyses x WHERE a.id = ${articleId} AND a.revision = ${row.revision}
          AND x.id = (SELECT id FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1)
          AND x.input_revision = a.revision
        RETURNING x.relevance`;
      if (completed) {
        await publishArticle(articleId);
        if (completed.relevance === "pass" && !row.historical) await enqueue(QUEUES.group, { articleId }, { singletonKey: articleId, priority: PRIORITY.live });
        return { state: completed.relevance };
      }
    }
    const result = await analyzeArticle(articleId, { attemptTag: opts.attemptTag });
    if (!result) return { state: "missing" };
    // Only a title or a feed summary: the article page first; extraction queues the analysis again.
    if (result.needsBody || !result.output) {
      if (!await processingProgress(articleId, "extract", true)) return { state: "paused" };
      await queueProcessing(articleId, { step: "extract" });
      return { state: "fetching-body" };
    }
    if (result.stale) return { state: "stale" }; // the newer revision has its own job
    await processingProgress(articleId, "analyze");
    await publishArticle(articleId);
    // History is archived but founds no event (isHistorical).
    if (result.output.relevance === "pass" && !row.historical) await enqueue(QUEUES.group, { articleId }, { singletonKey: articleId, priority: PRIORITY.live });
    return { state: result.output.relevance };
  } catch (error) {
    if (error instanceof AnalysisInterruptedError || shutdownSignal.signal.aborted) throw error;
    // The first lost response marks its receipt unknown but throws the original transport error.
    // Treat it like a reused unknown receipt immediately, without consuming ordinary retry counts.
    const [lost] = error instanceof ReceiptUnknownError ? [] : await sql<{ id: number }[]>`
      SELECT id FROM receipts WHERE subject=${'article:'+articleId+'@'+row.revision} AND service='llm'
        AND status='unknown' AND updated_at>=${startedAt} ORDER BY updated_at DESC LIMIT 1`;
    const unknownId = error instanceof ReceiptUnknownError ? error.receiptId : lost?.id;
    if (unknownId !== undefined) {
      // The provider may have billed this request: stop; ops.recover releases it once and requeues the article.
      await sql`UPDATE articles SET processing_state = 'failed', processing_error = ${`receipt ${unknownId} outcome unknown`} WHERE id = ${articleId} AND revision=${row.revision}`;
      return { state: "unknown-receipt" };
    }
    throw error;
  }
}

/** Waits and retries for passing trouble; marks "failed" for refusals and exhausted retries. */
async function afterFailure(articleId: string, error: unknown): Promise<{ state: string; retryAt?: Date }> {
  // Let pg-boss retry this job after restart, reusing settled receipts. A deploy is not an article
  // failure and must neither consume processing_attempts nor turn an incomplete chain terminal.
  if (error instanceof AnalysisInterruptedError || shutdownSignal.signal.aborted) throw error;
  const message = String(error instanceof Error ? error.message : error).slice(0, 500);
  if (error instanceof ReceiptBusyError || error instanceof BudgetExceededError) {
    // Not the article's fault: the same request is in flight, or the budget window is full.
    const seconds = error instanceof BudgetExceededError ? error.retryAfterSeconds : 60;
    const retryAt = new Date(Date.now() + seconds * 1000);
    await sql`UPDATE articles SET processing_state = 'new', processing_error = ${message}, processing_retry_at = ${retryAt}, processing_queued_at = NULL WHERE id = ${articleId}`;
    return { state: "waiting", retryAt };
  }
  await processingFailure(articleId);
  const [a] = await sql<{ processing_attempts: number }[]>`SELECT processing_attempts FROM articles WHERE id = ${articleId}`;
  const attempts = (a?.processing_attempts ?? 0) + 1;
  const refused = error instanceof ProviderRejectedError && !error.retryable;
  const exhausted = attempts > RETRY_MINUTES.length || (error instanceof ModelOutputError && attempts >= MAX_OUTPUT_FAILURES);
  if (refused || exhausted) {
    await sql`UPDATE articles SET processing_state = 'failed', processing_error = ${message}, processing_attempts = ${attempts},
                processing_retry_at = NULL, processing_queued_at = NULL WHERE id = ${articleId}`;
    return { state: "failed" };
  }
  const retryAt = new Date(Date.now() + RETRY_MINUTES[attempts - 1]! * 60_000);
  await sql`UPDATE articles SET processing_state = 'new', processing_error = ${message}, processing_attempts = ${attempts},
              processing_retry_at = ${retryAt}, processing_queued_at = NULL WHERE id = ${articleId}`;
  return { state: "retrying", retryAt };
}

export async function registerContentJobs(boss: PgBoss, concurrency = Number(process.env.ANALYZE_CONCURRENCY || 6)) {
  await ensureQueue(QUEUES.analyze);
  await boss.work<{ articleId: string; attemptTag?: string }>(QUEUES.analyze, { localConcurrency: concurrency, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    const { articleId, attemptTag } = job.data;
    try {
      const result = await processArticle(articleId, { attemptTag });
      if (result.state !== "unknown-receipt" && result.state !== "fetching-body" && result.state !== "paused") {
        await sql`UPDATE articles SET processing_attempts = 0, processing_retry_at = NULL, processing_queued_at = NULL WHERE id = ${articleId}`;
      }
      return result;
    } catch (error) {
      return afterFailure(articleId, error);
    }
  });
}

/**
 * Body extraction before analysis. Failures are retried a few times; after that the article is judged
 * on the excerpt it has ("unconfirmed" body, never a wrong one).
 */
export async function registerExtractionJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.extractBody);
  await boss.work<{ articleId: string }>(QUEUES.extractBody, { localConcurrency: 4, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    const { articleId } = job.data;
    if (!await processingProgress(articleId, "extract")) return { state: "paused" };
    try {
      const state = await extractArticleBody(articleId);
      await sql`UPDATE articles SET processing_attempts = 0, processing_retry_at = NULL, processing_error = NULL
                WHERE id = ${articleId} AND processing_state = 'new'
                  AND (processing_error IS NULL OR processing_error LIKE 'extract:%')`;
      if (!await processingProgress(articleId, "analyze", true)) return { state: "paused" };
      await queueProcessing(articleId, { step: "analyze" });
      return { state };
    } catch (error) {
      if (error instanceof BudgetExceededError || error instanceof ReceiptBusyError) return afterFailure(articleId, error);
      if (shutdownSignal.signal.aborted) throw error;
      await processingFailure(articleId);
      const message = String(error instanceof Error ? error.message : error).slice(0, 500);
      const [a] = await sql<{ processing_attempts: number }[]>`
        UPDATE articles SET processing_attempts = processing_attempts + 1, processing_error = ${`extract: ${message}`},
          processing_queued_at = NULL, processing_retry_at = now() + interval '10 minutes'
        WHERE id = ${articleId} RETURNING processing_attempts`;
      if ((a?.processing_attempts ?? MAX_EXTRACT_FAILURES) < MAX_EXTRACT_FAILURES) return { state: "retrying" };
      await sql`UPDATE articles SET body_status = 'unconfirmed', processing_attempts = 0, processing_retry_at = NULL, processing_error = NULL
                WHERE id = ${articleId} AND body_status = 'pending'`;
      if (!await processingProgress(articleId, "analyze", true)) return { state: "paused" };
      await queueProcessing(articleId, { step: "analyze" });
      return { state: "unconfirmed" };
    }
  });
}

/**
 * Safety net: articles waiting for processing that no queue holds (crash between write and enqueue,
 * a lost job, a retry that came due). Articles already queued or running are left alone.
 */
export async function sweepUnprocessed(): Promise<{ enqueued: number }> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM articles
    WHERE processing_state = 'new' AND created_at < now() - interval '3 minutes'
      AND (processing_retry_at IS NULL OR processing_retry_at <= now())
      AND (processing_queued_at IS NULL OR processing_queued_at < now() - ${QUEUED_STALE}::interval)
    ORDER BY discovered_at DESC LIMIT 500`;
  for (const r of rows) await queueProcessing(r.id);
  return { enqueued: rows.length };
}

/** How the runs page groups failures: the message with ids and numbers masked. */
export const failureGroupSql = (column = "processing_error") =>
  sql.unsafe(`regexp_replace(left(coalesce(${column}, '(no message)'), 120), '[0-9a-f]{8,}|[0-9]{4,}', '…', 'g')`);

/**
 * Admin: failed articles of the last 30 days back into processing, all or one failure group. The
 * first ones are queued now; the safety net picks up the rest within minutes.
 */
export async function requeueFailed(group: string | null): Promise<{ requeued: number }> {
  const rows = await sql<{ id: string }[]>`
    UPDATE articles SET processing_state = 'new', processing_attempts = 0, processing_retry_at = NULL, processing_error = NULL
    WHERE processing_state = 'failed' AND discovered_at > now() - interval '30 days'
      AND (${group}::text IS NULL OR ${failureGroupSql()} = ${group})
    RETURNING id`;
  for (const r of rows.slice(0, 500)) await queueProcessing(r.id);
  return { requeued: rows.length };
}

/** Private-log recovery: optimistic version check, queue and audit are one transaction. No new paid tag. */
export async function resumePausedArticle(articleId: string, revision: number, pausedAt: string, actor: string): Promise<string | null> {
  return sql.begin(async tx => {
    const [a] = await tx`SELECT id,revision,processing_handoffs FROM articles WHERE id=${articleId}
      AND revision=${revision} AND processing_state='paused' AND processing_paused_at=${pausedAt}::text::timestamptz FOR UPDATE`;
    if (!a) return null;
    await resetProcessingGuard(articleId, tx);
    await tx`UPDATE articles SET processing_state='new',processing_error=NULL,processing_attempts=0,
      processing_retry_at=NULL,processing_queued_at=NULL WHERE id=${articleId}`;
    const jobId = await queueProcessing(articleId, { db: tx });
    if (!jobId) throw new Error("paused article recovery did not enqueue");
    await tx`INSERT INTO audit_log(actor,action,subject,reason,before,after)
      VALUES(${actor},'article.processing-resumed',${'content:'+articleId},'人工核查后恢复处理',
        ${tx.json({revision,pausedAt,handoffs:a.processing_handoffs} as never)},${tx.json({jobId} as never)})`;
    return jobId;
  });
}
