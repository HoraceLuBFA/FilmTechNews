import { sql } from "../db.ts";

/** Atomic increment; concurrent readers never overwrite each other's visits. */
export async function recordSiteVisit(): Promise<void> {
  await sql`UPDATE site_visits SET total = total + 1 WHERE singleton = true`;
}
