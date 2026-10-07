import type { TagSummary } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { listedCondition } from "./items.ts";

/** Reader-visible labels, counted once per public eligible article regardless of duplicate tags. */
export async function listTagSummaries(now = new Date()): Promise<TagSummary[]> {
  const rows = await sql<Array<{ tag: string; total: number; selected_total: number }>>`
    SELECT tags.tag, count(*)::int AS total, (count(*) FILTER (WHERE p.selected))::int AS selected_total
    FROM publications p CROSS JOIN LATERAL (
      SELECT DISTINCT tag FROM unnest(p.tags) AS value(tag)
      WHERE btrim(tag) <> '' AND tag NOT LIKE 'entity:%'
    ) tags
    WHERE ${listedCondition(now)} AND p.eligible
    GROUP BY tags.tag ORDER BY total DESC, tags.tag COLLATE "C"`;
  return rows.map((row) => ({ tag: row.tag, total: row.total, selectedTotal: row.selected_total }));
}

/** Preserve unknown labels as exact filters; only existing public labels supply canonical casing. */
export async function normalizePublicTag(value: string | null | undefined): Promise<string | null> {
  const tag = value?.trim().replace(/^[#＃]+/, "").trim().slice(0, 60) || null;
  if (!tag) return null;
  const tags = await listTagSummaries();
  return tags.find((entry) => entry.tag === tag)?.tag
    ?? tags.find((entry) => entry.tag.toLowerCase() === tag.toLowerCase())?.tag
    ?? tag;
}
