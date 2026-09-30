import { SOURCE_DIRECTORY } from "@aihot/industry/source-directory";
import { sql } from "../db.ts";
import { listedCondition } from "./items.ts";
import { loadPool, POOL_PAGE_SIZE } from "./pool.ts";

/** Counts and source browsing use the same public, eligible set as the article pool. */
export async function listSourceCounts(now = new Date()) {
  const rows = await sql<{ source_id: string; total: number }[]>`
    SELECT p.source_id, count(*)::int AS total FROM publications p
    WHERE ${listedCondition(now)} AND p.eligible GROUP BY p.source_id`;
  const counts = new Map(rows.map((row) => [row.source_id, row.total]));
  return SOURCE_DIRECTORY.map((source) => ({ id: source.id, total: counts.get(source.id) ?? 0 }));
}

export async function loadSourcePage(id: string, page: number, now = new Date()) {
  const source = SOURCE_DIRECTORY.find((entry) => entry.id === id);
  if (!source || !Number.isInteger(page) || page < 1) return null;
  const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM publications p WHERE ${listedCondition(now)} AND p.eligible AND p.source_id = ${id}`;
  const maxPages = Math.max(1, Math.ceil(count!.total / POOL_PAGE_SIZE));
  if (page > maxPages) return null;
  const data = await loadPool({ channel: "all", category: null, tag: null, sourceId: id, page, maxPages, now });
  return { source, ...data };
}
