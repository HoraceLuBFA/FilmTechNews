// User-authorized temporary room for normal updates after the historical maintenance run.
// Existing requests keep their receipts and live usage; the temporary addition expires with them.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { updateBudget } from "@aihot/backend/admin/settings";

const directory = path.join(config.dataDir, "filmtech-budget-grace-20260930");
const file = path.join(directory, "state.json");
const actor = "codex:user-authorized-budget-grace";
type State = { baselineMaxId: number; expiresAt: string; original: { per_minute: number; per_hour: number; per_day: number; note: string | null }; extra?: { perDay: number; expiresAt: string }; restored?: boolean; limits?: { perMinute: number; perHour: number; perDay: number }; updatedAt?: string };

try {
  let state: State;
  if (process.argv.includes("--begin")) {
    try { await readFile(file); throw Error("A grace state already exists; use --tick"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const original = JSON.parse(await readFile(path.join(config.dataDir, "history-completion-20260930", "budget-before.json"), "utf8"));
    const [current] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
    if (current!.per_minute !== original.per_minute || current!.per_hour !== original.per_hour || current!.per_day !== original.per_day) throw Error("Restore the maintenance budget before opening normal-update room");
    const [baseline] = await sql<{ id: number | null; last: Date | null }[]>`SELECT max(id)::int AS id,max(started_at) AS last FROM receipt_attempts WHERE service='llm' AND origin='live' AND started_at>now()-interval '1 day'`;
    state = { baselineMaxId: baseline!.id ?? 0, expiresAt: new Date((baseline!.last?.getTime() ?? Date.now()) + 86400_000).toISOString(), original };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  } else if (process.argv.includes("--tick")) {
    state = JSON.parse(await readFile(file, "utf8"));
  } else {
    throw Error("Choose --begin or --tick; neither starts model requests");
  }
  if (!state.restored) {
    await sql`INSERT INTO settings (key,value,updated_by) VALUES ('llm_budget_grace',
      ${sql.json({ baselineMaxId: state.baselineMaxId, original: state.original, extra: state.extra ?? null })}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    const [remaining] = await sql<{ minute: number; hour: number; day: number }[]>`
      SELECT count(*) FILTER(WHERE started_at>now()-interval '1 minute')::int AS minute,
        count(*) FILTER(WHERE started_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day
      FROM receipt_attempts WHERE service='llm' AND origin='live' AND id<=${state.baselineMaxId} AND started_at>now()-interval '1 day'`;
    const extra = state.extra && Date.parse(state.extra.expiresAt) > Date.now() ? state.extra.perDay : 0;
    const limits = { perMinute: state.original.per_minute + remaining!.minute, perHour: state.original.per_hour + remaining!.hour, perDay: state.original.per_day + remaining!.day + extra };
    const [current] = await sql`SELECT per_minute,per_hour,per_day,note FROM budgets WHERE service='llm'`;
    const restored = Date.now() >= Date.parse(state.expiresAt) && remaining!.day === 0 && extra === 0;
    const reason = restored ? "补跑请求已满24小时，恢复原预算" : "用户授权补跑后临时更新余量；历史请求仍真实计数，余量随滚动窗口到期自动下降";
    if (current!.per_minute !== limits.perMinute || current!.per_hour !== limits.perHour || current!.per_day !== limits.perDay || restored && current!.note !== state.original.note) {
      await updateBudget("llm", { ...limits, reason }, actor);
      if (restored) await sql`UPDATE budgets SET note=${state.original.note} WHERE service='llm'`;
    }
    state = { ...state, limits, restored, updatedAt: new Date().toISOString() };
    const temp = file + ".tmp";
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    const { rename } = await import("node:fs/promises");
    await rename(temp, file);
  }
  if (state.restored) await sql`DELETE FROM settings WHERE key='llm_budget_grace' AND (value->>'baselineMaxId')::bigint=${state.baselineMaxId}`;
  console.log(JSON.stringify({ status: state.restored ? "restored" : "temporary-room", expiresAt: state.extra ? new Date(Math.max(Date.parse(state.expiresAt), Date.parse(state.extra.expiresAt))).toISOString() : state.expiresAt, limits: state.limits }));
} finally { await closeDb(); }
