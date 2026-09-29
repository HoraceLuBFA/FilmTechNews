// Uses the configured model, budget and receipts. Run with the generator's private env file.
import { sql, closeDb } from "@aihot/backend/db";
import { rewriteSummary } from "@aihot/backend/editorial/rewrite-summary";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";
import { setTimeout as delay } from "node:timers/promises";
import { stopBoss } from "@aihot/backend/jobs/queue";

try {
  const ids = process.argv.slice(2);
  const rows = ids.length ? ids.map((article_id) => ({ article_id })) : await sql<{ article_id: string }[]>`
    SELECT article_id FROM publications WHERE eligible AND visibility <> 'withdrawn' AND channel = 'news' ORDER BY article_id`;
  console.log(JSON.stringify({ candidates: rows.length }));
  let failures = 0;
  for (const { article_id } of rows) {
    for (;;) {
      try { console.log(JSON.stringify({ articleId: article_id, ...await rewriteSummary(article_id) })); break; }
      catch (error) {
        if (error instanceof BudgetExceededError && !error.message.includes("(stopped)")) {
          console.log(JSON.stringify({ articleId: article_id, status: "waiting-budget", retryAfterSeconds: error.retryAfterSeconds }));
          await delay(error.retryAfterSeconds * 1000);
          continue;
        }
        failures++;
        console.error(JSON.stringify({ articleId: article_id, status: "failed", error: error instanceof Error ? error.message : "unknown" }));
        break;
      }
    }
  }
  if (failures) process.exitCode = 1;
} finally { await stopBoss(); await closeDb(); }
