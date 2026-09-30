// Job queue on PostgreSQL (pg-boss). Business code enqueues by name; the worker process owns handlers.
import { PgBoss, type SendOptions } from "pg-boss";
import { config } from "../config.ts";
import { sql, type Db } from "../db.ts";

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export const QUEUES = {
  analyze: "content.analyze",
  translate: "content.translate",
  extractBody: "content.extract-body",
  group: "events.group",
  digest: "events.digest",
  fetchSource: "sources.fetch",
  fetchXShard: "sources.fetch-x",
  mpCheck: "sources.mp",

  notifySelected: "notify.selected",
  republishSource: "publication.republish-source",

  prepareMedia: "media.prepare",
} as const;

type QueueOptions = NonNullable<Parameters<PgBoss["createQueue"]>[1]>;

/** Queue definitions in one place; created on first use by any process. */
export const QUEUE_OPTIONS: Record<string, QueueOptions> = {
  [QUEUES.analyze]: { policy: "short", retryLimit: 4, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.translate]: { policy: "short", retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  [QUEUES.extractBody]: { policy: "short", retryLimit: 2, retryDelay: 120, expireInSeconds: 300 },
  [QUEUES.group]: { policy: "short", retryLimit: 4, retryDelay: 20, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.digest]: { policy: "short", retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  [QUEUES.fetchSource]: { policy: "short", retryLimit: 0, expireInSeconds: 600 },
  [QUEUES.fetchXShard]: { policy: "short", retryLimit: 0, expireInSeconds: 900 },
  [QUEUES.mpCheck]: { policy: "short", retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.notifySelected]: { policy: "short", retryLimit: 0, expireInSeconds: 300 },
  [QUEUES.republishSource]: { policy: "short", retryLimit: 2, retryDelay: 60, expireInSeconds: 3600 },

  [QUEUES.prepareMedia]: { policy: "short", retryLimit: 1, retryDelay: 120, expireInSeconds: 600 },
};

const ensured = new Set<string>();

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const b = new PgBoss({ connectionString: config.databaseUrl, max: 4, schema: "pgboss", application_name: "aihot-jobs" });
    b.on("error", (err) => console.error("[pg-boss]", err));
    await b.start();
    boss = b;
    return b;
  })();
  return starting;
}

/**
 * Aborted when the process starts shutting down: long loops stop between items, and a paid call
 * already in flight is allowed to finish, so a deploy does not leave "outcome unknown" receipts.
 */
export const shutdownSignal = new AbortController();
/** The longest single paid call (a translation batch, 180 s) plus margin; systemd waits longer. */
export const STOP_TIMEOUT_MS = Math.max(195_000, config.llmTimeoutMs + 15_000);

export async function stopBoss(): Promise<void> {
  shutdownSignal.abort();
  if (boss) await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  boss = null;
  starting = null;
}

export async function ensureQueue(name: string, options: QueueOptions = QUEUE_OPTIONS[name] ?? {}): Promise<void> {
  if (ensured.has(name)) return;
  const b = await getBoss();
  const existing = await b.getQueue(name);
  if (!existing) await b.createQueue(name, options);
  ensured.add(name);
}

/** Enqueues a job. With `tx`, the job commits atomically with the caller's business write. */
export async function enqueue(name: string, data: object, options: SendOptions = {}, tx?: Db): Promise<string | null> {
  await ensureQueue(name);
  const b = await getBoss();
  if (tx) {
    const db = { executeSql: async (text: string, values?: unknown[]) => ({ rows: await tx.unsafe(text, (values ?? []) as never[]) }) };
    return b.send(name, data, { ...options, db });
  }
  return b.send(name, data, options);
}

// ---------------------------------------------------------------------------
// Scheduled task bookkeeping: every run leaves a row, so operators see the latest result.
// ---------------------------------------------------------------------------

export async function recordRun<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const [row] = await sql<{ id: number }[]>`INSERT INTO job_runs (job) VALUES (${job}) RETURNING id`;
  try {
    const result = await fn();
    const detail = result && typeof result === "object" ? result : { result };
    await sql`UPDATE job_runs SET status = 'ok', finished_at = now(), detail = ${sql.json(detail as never)} WHERE id = ${row!.id}`;
    return result;
  } catch (error) {
    await sql`UPDATE job_runs SET status = 'failed', finished_at = now(), error = ${String(error).slice(0, 4000)} WHERE id = ${row!.id}`;
    throw error;
  }
}
