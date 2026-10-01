import type { SiteVisits } from "@aihot/contracts/site";
import { one, sql } from "../db.ts";

/** The only public visit data is an aggregate and its start date. */
export async function loadSiteVisits(): Promise<SiteVisits> {
  const row = one(await sql<{ total: number; started_at: Date }[]>`
    SELECT total, started_at FROM site_visits WHERE singleton = true`);
  return { total: row.total, startedAt: row.started_at.toISOString() };
}
