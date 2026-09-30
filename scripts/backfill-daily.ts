// Operator-only historical editions. Preview first; pause the regular worker before --apply.
// Uses the existing article pipeline and paid receipts; never changes selection thresholds.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { publishArticle } from "@aihot/backend/publication/publish";
import { composeDaily } from "@aihot/backend/reports/compose";
import { updateBudget } from "@aihot/backend/admin/settings";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { addDays, beijingDate } from "@aihot/contracts/time";

const actor = "codex:historical-daily";
const marker = "用户授权历史日报补刊临时额度";
const backup = path.join(config.dataDir, "historical-daily-budget.json");
const log = (data: unknown) => console.log(JSON.stringify({ at: new Date().toISOString(), data }));

async function restoreBudget() {
  const original = JSON.parse(await readFile(backup, "utf8"));
  const [current] = await sql`SELECT note FROM budgets WHERE service = 'llm'`;
  if (current?.note !== marker) return;
  await updateBudget("llm", { perMinute: original.per_minute, perHour: original.per_hour,
    perDay: original.per_day, reason: "历史日报补刊结束，恢复原预算" }, actor);
  await sql`UPDATE budgets SET note = ${original.note} WHERE service = 'llm'`;
  log({ restored: true, perMinute: original.per_minute, perHour: original.per_hour, perDay: original.per_day });
}

try {
  if (process.argv.includes("--restore-budget")) {
    await restoreBudget();
  } else {
    const [from, through] = process.argv.slice(2);
    if (!from || !through || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through)
      || new Date(from).toISOString().slice(0, 10) !== from || new Date(through).toISOString().slice(0, 10) !== through
      || from > through || through >= beijingDate(new Date()) || (Date.parse(through) - Date.parse(from)) / 86400000 > 30) {
      throw new Error("Usage: backfill-daily.ts YYYY-MM-DD YYYY-MM-DD [--apply --temporarily-raise-budget]; past dates only, at most 31 issues");
    }
    const start = new Date(`${addDays(from, -1)}T00:00:00Z`);
    const end = new Date(`${through}T00:00:00Z`);
    const articles = await sql<{ id: string; title: string; processing_state: string; body_status: string }[]>`
      SELECT a.id, a.title, a.processing_state, a.body_status FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.published_at >= ${start} AND a.published_at < ${end} AND s.participation_mode = 'editorial'
      ORDER BY a.published_at, a.id`;
    const pending = articles.filter((a) => !["analyzed", "blocked", "skipped"].includes(a.processing_state));
    log({ from, through, sourceWindowStart: start, sourceWindowEnd: end, articles: articles.length, pending: pending.length });
    if (process.argv.includes("--apply")) {
      let raised = false;
      try {
        if (process.argv.includes("--temporarily-raise-budget")) {
          const [original] = await sql`SELECT * FROM budgets WHERE service = 'llm'`;
          if (!original || original.note === marker) throw new Error("Restore the earlier maintenance budget before starting another run");
          await mkdir(config.dataDir, { recursive: true });
          await writeFile(backup, JSON.stringify(original), { mode: 0o600 });
          const [usage] = await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE service='llm' AND origin='live' AND started_at > now()-interval '1 day'`;
          const allowance = pending.length * 10 + 100;
          await updateBudget("llm", { perMinute: Math.max(original.per_minute, 30), perHour: Math.max(original.per_hour, usage!.n + allowance),
            perDay: Math.max(original.per_day, usage!.n + allowance), reason: marker }, actor);
          raised = true;
        }
        // The old editions are also retained by composeDaily in report_revisions.
        const before = await sql`SELECT * FROM reports WHERE kind='daily' AND key >= ${from} AND key <= ${through}`;
        await writeFile(path.join(config.dataDir, `historical-daily-before-${Date.now()}.json`), JSON.stringify(before), { mode: 0o600 });
        const failures: string[] = [];
        for (const a of pending) {
          log({ articleId: a.id, title: a.title, status: "processing" });
          try {
            let result = await analyzeArticle(a.id);
            if (result?.needsBody) {
              await extractArticleBody(a.id, false);
              result = await analyzeArticle(a.id);
            }
            if (!result?.output || result.stale) throw new Error("Article not ready for publication");
            await publishArticle(a.id);
            log({ articleId: a.id, relevance: result.output.relevance, selected: result.output.selected, receiptIds: result.receiptIds });
          } catch (error) {
            failures.push(a.id);
            log({ articleId: a.id, status: "failed", error: String(error) });
          }
        }
        if (failures.length) throw new Error(`Unfinished articles: ${failures.join(",")}; rerun to reuse settled receipts`);
        for (let date = from; date <= through; date = addDays(date, 1)) {
          const [existing] = await sql`SELECT content FROM reports WHERE kind='daily' AND key=${date}`;
          if (existing?.content?.generator?.mode === "historical") { log({ key: date, status: "already-completed" }); continue; }
          log(await composeDaily(date, "user-authorized historical backfill", { historical: true }));
        }
        log({ status: "completed", from, through });
      } finally { if (raised) await restoreBudget(); }
    }
  }
} finally { await stopBoss(); await closeDb(); }
