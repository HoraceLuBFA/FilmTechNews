import "./setup.ts";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql, closeDb } from "@aihot/backend/db";

after(closeDb);
test("temporary update room preserves real receipts and automatically restores the original budget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "filmtech-grace-"));
  const [original] = await sql`SELECT * FROM budgets WHERE service='llm'`;
  const usageBefore = await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
  const run = async (mode: string) => JSON.parse((await promisify(execFile)(process.execPath, ["scripts/filmtech-budget-grace.ts", mode], { env: { ...process.env, AIHOT_DATA_DIR: directory, MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false" } })).stdout);
  try {
    await mkdir(path.join(directory, "history-completion-20260930"));
    await writeFile(path.join(directory, "history-completion-20260930", "budget-before.json"), JSON.stringify(original));
    const opened = await run("--begin");
    assert.equal(opened.status, "temporary-room");
    assert.ok(opened.limits.perDay >= original!.per_day);
    const stateFile = path.join(directory, "filmtech-budget-grace-20260930", "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    // Simulate an expired baseline without editing any request or origin in the database.
    await writeFile(stateFile, JSON.stringify({ ...state, baselineMaxId: 0, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const restored = await run("--tick");
    assert.equal(restored.status, "restored");
    const [budget] = await sql`SELECT * FROM budgets WHERE service='llm'`;
    assert.equal(budget!.per_minute, original!.per_minute);
    assert.equal(budget!.per_hour, original!.per_hour);
    assert.equal(budget!.per_day, original!.per_day);
    assert.equal(budget!.note, original!.note);
    assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipt_attempts`, usageBefore);
  } finally {
    await sql`UPDATE budgets SET per_minute=${original!.per_minute},per_hour=${original!.per_hour},per_day=${original!.per_day},note=${original!.note} WHERE service='llm'`;
    await rm(directory, { recursive: true });
  }
});
