// Paid requests (models, SocialData, Jina, Dajiala) go through here.
//
// 1. A logical request has a stable key bound to task, input revision, provider, model, prompt and config.
// 2. Before calling, a placeholder row and an attempt row are persisted; budgets count attempts.
// 3. The raw response is saved before any business write; recovery reuses a received response.
// 4. A request whose outcome is unknown (timeout after sending, crash mid-flight) is not re-sent by the
//    caller. ops.recover releases it once after 30 minutes (admin/runs.ts), so a lost answer costs at
//    most one repeat; after that it waits for the admin.
import { sql, type Db } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { config } from "../config.ts";

export class BudgetExceededError extends Error {
  readonly service: string;
  readonly retryAfterSeconds: number;
  constructor(service: string, window: string, retryAfterSeconds: number) {
    super(`Budget for ${service} exhausted (${window})`);
    this.service = service;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ReceiptBusyError extends Error {}

export class ReceiptUnknownError extends Error {
  readonly receiptId: number;
  constructor(receiptId: number, message: string) {
    super(message);
    this.receiptId = receiptId;
  }
}

/** Raised by a call when the provider clearly did not accept (and will not bill) the request. */
export class ProviderRejectedError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export interface CallOutcome {
  response: unknown;
  requestId?: string | null;
  usage?: Record<string, unknown> | null;
  cost?: { amount: number; currency: string; basis: "actual" | "estimated" } | null;
}

export interface ReceiptRequest {
  service: string;
  model?: string | null;
  purpose: string;
  subject?: string | null;
  /** Everything that determines the output. Hashed into the logical key; only a redacted summary is stored. */
  identity: unknown;
  /** Stored for diagnosis; must not contain secrets. */
  requestSummary?: Record<string, unknown>;
  /** Distinguishes an explicit re-run (e.g. admin "re-evaluate") from recovery of the same request. */
  attemptTag?: string;
}

export interface ReceiptResult {
  receiptId: number;
  response: unknown;
  reused: boolean;
}

const PENDING_STALE_MS = 10 * 60 * 1000;

export function logicalKeyFor(req: ReceiptRequest): string {
  const identity = sha256(stableJson(req.identity));
  return [req.service, req.purpose, req.model ?? "-", identity, req.attemptTag ?? "0"].join(":");
}

interface ReceiptRow {
  id: number;
  status: string;
  response: unknown;
  created_at: Date;
  updated_at: Date;
}

async function checkBudget(tx: Db, req: ReceiptRequest): Promise<void> {
  const { service } = req;
  const [budget] = await tx<{ per_minute: number; per_hour: number; per_day: number }[]>`
    SELECT per_minute, per_hour, per_day FROM budgets WHERE service = ${service}`;
  if (!budget) return; // default rows come with the migrations; a service an operator removed is unlimited
  // Every request sent counts, retries of the same logical request included.
  // The maintenance allowance is reconciled once a minute. Enforce its exact live
  // boundary here as well, so aging maintenance calls cannot briefly grant extra normal calls.
  const [graceRow] = service === "llm" ? await tx<{ value: { baselineMaxId: number; original: { per_minute: number; per_hour: number; per_day: number }; extra?: { perDay: number; expiresAt: string } } }[]>`
    SELECT value FROM settings WHERE key = 'llm_budget_grace'` : [];
  const grace = graceRow?.value;
  const [counts] = await tx<{ minute: number; hour: number; day: number; old_minute: number; old_hour: number; old_day: number }[]>`
    SELECT
      count(*) FILTER (WHERE started_at > now() - interval '1 minute') AS minute,
      count(*) FILTER (WHERE started_at > now() - interval '1 hour') AS hour,
      count(*) AS day,
      count(*) FILTER (WHERE id <= ${grace?.baselineMaxId ?? 0} AND started_at > now() - interval '1 minute') AS old_minute,
      count(*) FILTER (WHERE id <= ${grace?.baselineMaxId ?? 0} AND started_at > now() - interval '1 hour') AS old_hour,
      count(*) FILTER (WHERE id <= ${grace?.baselineMaxId ?? 0}) AS old_day
    FROM receipt_attempts
    WHERE service = ${service} AND origin = 'live' AND started_at > now() - interval '1 day'`;
  const c = counts!;
  if (budget.per_minute <= 0 || budget.per_hour <= 0 || budget.per_day <= 0) {
    throw new BudgetExceededError(service, "stopped", 3600);
  }
  const minuteLimit = grace ? Math.min(budget.per_minute, grace.original.per_minute + Number(c.old_minute)) : budget.per_minute;
  const hourLimit = grace ? Math.min(budget.per_hour, grace.original.per_hour + Number(c.old_hour)) : budget.per_hour;
  const extra = grace?.extra && Date.parse(grace.extra.expiresAt) > Date.now() ? grace.extra.perDay : 0;
  const dayLimit = grace ? Math.min(budget.per_day, grace.original.per_day + Number(c.old_day) + extra) : budget.per_day;
  if (c.minute >= minuteLimit) throw new BudgetExceededError(service, "minute", 60);
  if (c.hour >= hourLimit) throw new BudgetExceededError(service, "hour", 600);
  if (c.day >= dayLimit) throw new BudgetExceededError(service, "day", 3600);

  if (service === "llm" && config.llmHourlyCallLimit > 0) {
    const limit = config.llmHourlyCallLimit;
    const reserve = Math.max(0, Math.min(limit, config.llmReportHourlyReserve));
    const report = req.purpose.startsWith("report_");
    const [used] = await tx<{ total: number; editorial: number; total_release: Date | null; editorial_release: Date | null }[]>`
      WITH recent AS (
        SELECT a.started_at, left(r.purpose, 7) = 'report_' AS report
        FROM receipt_attempts a JOIN receipts r ON r.id = a.receipt_id
        -- A clear provider rejection bought no model work. Keep it in the original
        -- attempt budgets, but do not spend an hourly work slot on a bridge-busy response.
        WHERE a.service = ${service} AND a.origin = 'live' AND a.status <> 'failed' AND a.started_at > now() - interval '1 hour'
      )
      SELECT count(*) AS total, count(*) FILTER (WHERE NOT report) AS editorial,
        min(started_at) + interval '1 hour' AS total_release,
        min(started_at) FILTER (WHERE NOT report) + interval '1 hour' AS editorial_release FROM recent`;
    const totalFull = Number(used!.total) >= limit;
    const editorialFull = !report && Number(used!.editorial) >= limit - reserve;
    if (totalFull || editorialFull) {
      const release = totalFull ? used!.total_release : used!.editorial_release;
      const seconds = release ? Math.max(1, Math.ceil((release.getTime() - Date.now()) / 1000)) : 3600;
      throw new BudgetExceededError(service, "hourly pacing", seconds);
    }
  }
  if (service === "llm" && config.llmMaxConcurrentCalls > 0) {
    const limit = config.llmMaxConcurrentCalls;
    const reserve = Math.max(0, Math.min(limit, config.llmReportConcurrentReserve));
    const [pending] = await tx<{ total: number; editorial: number }[]>`
      SELECT count(*) AS total, count(*) FILTER (WHERE left(purpose,7) <> 'report_') AS editorial
      FROM receipts WHERE service=${service} AND origin='live' AND status='pending'`;
    if (Number(pending!.total) >= limit || !req.purpose.startsWith("report_") && Number(pending!.editorial) >= limit - reserve) {
      throw new ReceiptBusyError("Default model concurrency is full; retry without sending");
    }
  }
}

/**
 * Runs a paid request at most once per logical key and returns its raw response.
 * The caller parses the response and commits business results, then calls completeReceipt.
 */
export async function paidRequest(req: ReceiptRequest, call: () => Promise<CallOutcome>): Promise<ReceiptResult> {
  const logicalKey = logicalKeyFor(req);

  const claimed = await sql.begin(async (tx) => {
    // Serialise budget checks per service so concurrent workers cannot overshoot.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"budget:" + req.service}))`;
    const [existing] = await tx<ReceiptRow[]>`
      SELECT id, status, response, created_at, updated_at FROM receipts WHERE logical_key = ${logicalKey} FOR UPDATE`;
    if (existing) {
      if (existing.status === "received" || existing.status === "completed") return { kind: "reuse" as const, row: existing };
      if (existing.status === "pending") {
        if (Date.now() - existing.updated_at.getTime() < PENDING_STALE_MS) return { kind: "busy" as const, row: existing };
        await markUnknown(tx, existing.id, "placeholder went stale without a recorded result");
        return { kind: "unknown" as const, row: existing };
      }
      if (existing.status === "unknown") return { kind: "unknown" as const, row: existing };
      // failed: the provider did not take the request, or its answer was unusable; a new attempt is allowed.
      await checkBudget(tx, req);
      const [r] = await tx<{ attempts: number }[]>`
        UPDATE receipts SET status = 'pending', attempts = attempts + 1, error = NULL, updated_at = now() WHERE id = ${existing.id} RETURNING attempts`;
      const attemptId = await startAttempt(tx, existing.id, r!.attempts, req);
      return { kind: "call" as const, id: existing.id, attemptId };
    }
    await checkBudget(tx, req);
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO receipts (logical_key, service, model, purpose, subject, status, request, attempts)
      VALUES (${logicalKey}, ${req.service}, ${req.model ?? null}, ${req.purpose}, ${req.subject ?? null}, 'pending',
              ${tx.json((req.requestSummary ?? {}) as never)}, 1)
      RETURNING id`;
    const attemptId = await startAttempt(tx, row!.id, 1, req);
    return { kind: "call" as const, id: row!.id, attemptId };
  });

  if (claimed.kind === "reuse") return { receiptId: claimed.row.id, response: claimed.row.response, reused: true };
  if (claimed.kind === "busy") throw new ReceiptBusyError(`Receipt ${claimed.row.id} is in flight`);
  if (claimed.kind === "unknown") {
    throw new ReceiptUnknownError(claimed.row.id, `Receipt ${claimed.row.id} has an unknown outcome; it is released once automatically, then from the admin`);
  }

  const { id: receiptId, attemptId } = claimed;
  const started = Date.now();
  let outcome: CallOutcome;
  try {
    outcome = await call();
  } catch (error) {
    const status = error instanceof ProviderRejectedError ? "failed" : "unknown";
    // "unknown": the request may have reached the provider (timeout, reset): do not re-send automatically.
    const message = (error instanceof ProviderRejectedError ? error.message : String(error)).slice(0, 2000);
    await sql.begin(async (tx) => {
      await tx`UPDATE receipts SET status = ${status}, error = ${message}, updated_at = now() WHERE id = ${receiptId}`;
      await tx`UPDATE receipt_attempts SET status = ${status}, error = ${message}, latency_ms = ${Date.now() - started}, finished_at = now() WHERE id = ${attemptId}`;
    });
    throw error;
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE receipts SET
        status = 'received',
        response = ${tx.json((outcome.response ?? null) as never)},
        request_id = ${outcome.requestId ?? null},
        usage = ${outcome.usage ? tx.json(outcome.usage as never) : null},
        cost = ${outcome.cost?.amount ?? null},
        currency = ${outcome.cost?.currency ?? null},
        cost_basis = ${outcome.cost?.basis ?? null},
        received_at = now(),
        updated_at = now()
      WHERE id = ${receiptId}`;
    await tx`
      UPDATE receipt_attempts SET
        status = 'received', request_id = ${outcome.requestId ?? null}, usage = ${outcome.usage ? tx.json(outcome.usage as never) : null},
        cost = ${outcome.cost?.amount ?? null}, currency = ${outcome.cost?.currency ?? null}, cost_basis = ${outcome.cost?.basis ?? null},
        latency_ms = ${Date.now() - started}, finished_at = now()
      WHERE id = ${attemptId}`;
  });
  return { receiptId, response: outcome.response, reused: false };
}

async function startAttempt(tx: Db, receiptId: number, attempt: number, req: ReceiptRequest): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO receipt_attempts (receipt_id, attempt, service, model, status) VALUES (${receiptId}, ${attempt}, ${req.service}, ${req.model ?? null}, 'pending')
    RETURNING id`;
  return row!.id;
}

async function markUnknown(tx: Db, receiptId: number, reason: string) {
  await tx`UPDATE receipts SET status = 'unknown', error = ${reason}, updated_at = now() WHERE id = ${receiptId}`;
  await tx`UPDATE receipt_attempts SET status = 'unknown', error = ${reason}, finished_at = now() WHERE receipt_id = ${receiptId} AND status = 'pending'`;
}

/**
 * Placeholders left behind by a process that stopped mid-request (crash, kill) become "unknown", so
 * they are released like any other unknown outcome even when nothing retries them.
 */
export async function markStalePendingReceipts(): Promise<number> {
  const stale = await sql<{ id: number }[]>`SELECT id FROM receipts WHERE status = 'pending' AND updated_at < ${new Date(Date.now() - PENDING_STALE_MS)}`;
  for (const r of stale) await sql.begin((tx) => markUnknown(tx, r.id, "placeholder went stale without a recorded result"));
  return stale.length;
}

export async function completeReceipt(db: Db, receiptId: number): Promise<void> {
  await db`UPDATE receipts SET status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now() WHERE id = ${receiptId}`;
}

/** Marks a received response that could not be used (e.g. unparsable) so a fresh attempt can be made. */
export async function rejectReceivedResponse(receiptId: number, reason: string): Promise<void> {
  await sql`UPDATE receipts SET status = 'failed', error = ${reason.slice(0, 2000)}, updated_at = now() WHERE id = ${receiptId}`;
}
