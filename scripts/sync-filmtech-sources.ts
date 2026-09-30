// Explicit, audited synchronization of the FilmTech source catalogue; seed.ts remains insert-only.
// Preview by default. Pause collection before applying a reviewed catalogue with --apply.
import { readFile } from "node:fs/promises";
import { sql, closeDb } from "@aihot/backend/db";
import { createSource, updateSource } from "@aihot/backend/admin/sources";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { stableJson } from "@aihot/backend/lib/ids";
import type { SourceRow } from "@aihot/backend/sources/types";

const actor = "codex:filmtech-source-sync";
const apply = process.argv.includes("--apply");
const { sources } = JSON.parse(await readFile(new URL("../industry/sources.json", import.meta.url), "utf8"));
try {
  for (const s of sources) {
    assertSupportedConfig(s.kind, s.config);
    let [before] = await sql`SELECT * FROM sources WHERE id=${s.id}`;
    if (before && before.kind !== s.kind) throw new Error(`Source kind changed for ${s.id}; review its existing history before conversion`);
    const patch = {
      config: { ...(before?.config ?? {}), ...s.config }, enabled: s.enabled,
      interval_minutes: s.interval_minutes,
    };
    if (before && stableJson(patch) === stableJson({ config: before.config, enabled: before.enabled, interval_minutes: before.interval_minutes })) continue;
    console.log(JSON.stringify({ id: s.id, action: before ? "update" : "create", apply, group: s.config.editorialGroup ?? "supplement", enabled: s.enabled }));
    if (!apply) continue;
    if (!before) {
      const result = await createSource({ id: s.id, name: s.name, kind: s.kind as SourceRow["kind"], config: s.config,
        tier: s.tier, participation_mode: s.participation_mode, interval_minutes: s.interval_minutes, first_party: s.first_party,
        tags: s.tags, site_fulltext: false, syndicate_fulltext: false }, actor);
      if (!result.created) throw new Error(`Duplicate source: ${s.id} conflicts with ${result.duplicate.id}`);
      before = result.source;
    }
    await updateSource(s.id, { patch, version: new Date(before!.updated_at).toISOString(), reason: "同步用户提供的 OpenClaw 30 源及分级抓取规则" }, actor);
  }
} finally { await stopBoss(); await closeDb(); }
