import type { FeedItemSummary } from "@aihot/contracts/site";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.ts";
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { ITEM_COLUMNS, ITEM_FROM, listedCondition, selectedCondition, toFeedItemSummary, type ItemRow } from "./items.ts";
import { displayTags } from "./rules.ts";

export interface TopicRow {
  slug: string;
  name: string;
  grp: "company" | "field" | "genre";
  entity_id: string | null;
  tags: string[];
  definition: string;
  related: string[];
  position: number;
}

type TopicCount = { slug: string; total: number; summaryTotal: number; recent: number; pages: number; indexable: boolean; latest: Date | null };
const topicsCache = cached(
  () => sql<TopicRow[]>`SELECT slug, name, grp, entity_id, tags, definition, related, position FROM topics ORDER BY position`,
  { freshMs: 60_000, maxStaleMs: 10 * 60_000 },
);
// Counts may lag by about a minute, like the public directory cache; item reads always check visibility.
const countsCache = cached(queryTopicCounts, { freshMs: 60_000, maxStaleMs: 10 * 60_000 });

/**
 * The topics (stable slugs, names, definitions, related topics) come from the industry pack
 * (industry/topics.json); every environment seeds them from there. Re-runnable.
 */
export async function seedTopics(): Promise<number> {
  const data = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/topics.json"), "utf8")) as {
    topics: Array<{ slug: string; name: string; group: string; entityId?: string | null; tags: string[]; definition: string; related?: string[] }>;
  };
  let position = 0;
  for (const t of data.topics) {
    await sql`
      INSERT INTO topics (slug, name, grp, entity_id, tags, definition, related, position)
      VALUES (${t.slug}, ${t.name}, ${t.group}, ${t.entityId ?? null}, ${t.tags}, ${t.definition}, ${t.related ?? []}, ${position++})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, grp = EXCLUDED.grp, entity_id = EXCLUDED.entity_id,
        tags = EXCLUDED.tags, definition = EXCLUDED.definition, related = EXCLUDED.related, position = EXCLUDED.position`;
  }
  topicsCache.clear();
  countsCache.clear();
  return data.topics.length;
}

export function listTopics(): Promise<TopicRow[]> {
  return topicsCache.get();
}

export async function loadTopic(slug: string): Promise<TopicRow | null> {
  return (await listTopics()).find((t) => t.slug === slug) ?? null;
}

/**
 * Tags that put an article in a topic. A company topic takes only articles actually about the company
 * (its entity subject tag), never mere mentions; field and genre topics match their tags.
 */
export function topicMatchTags(t: Pick<TopicRow, "entity_id" | "tags">): string[] {
  return t.entity_id ? [`entity:${t.entity_id}`] : t.tags;
}

export async function loadTopicTags(slug: string): Promise<string[] | null> {
  const t = await loadTopic(slug);
  return t ? topicMatchTags(t) : null;
}

export const TOPIC_PAGE_SIZE = 20;

/** Topic pages exist for every topic; only topics with enough content are listed and indexed. */
export function topicPageCounts(): Promise<TopicCount[]> {
  return countsCache.get();
}

/**
 * One pass over the public, eligible set instead of one scan per topic. Selected counts retain
 * their indexing meaning; summaryTotal also includes related articles outside the selected set.
 */
async function queryTopicCounts(): Promise<TopicCount[]> {
  const [topics, items] = await Promise.all([
    sql<Array<Pick<TopicRow, "slug" | "entity_id" | "tags">>>`SELECT slug, entity_id, tags FROM topics ORDER BY position`,
    sql<{ tags: string[]; timeline_at: Date; selected: boolean }[]>`SELECT p.tags, p.timeline_at, p.selected FROM publications p WHERE ${listedCondition(new Date())} AND p.eligible`,
  ]);
  const recentFrom = Date.now() - 30 * 86400_000;
  return topics.map((t) => {
    const match = new Set(topicMatchTags(t));
    let total = 0;
    let summaryTotal = 0;
    let recent = 0;
    let latest: Date | null = null;
    for (const it of items) {
      if (!it.tags.some((tag) => match.has(tag))) continue;
      summaryTotal += 1;
      if (!it.selected) continue;
      total += 1;
      if (it.timeline_at.getTime() > recentFrom) recent += 1;
      if (!latest || it.timeline_at > latest) latest = it.timeline_at;
    }
    return { slug: t.slug, total, summaryTotal, recent, latest, pages: Math.max(1, Math.ceil(total / TOPIC_PAGE_SIZE)), indexable: total >= 50 || (total >= 20 && recent > 0) };
  });
}

export interface TopicSummary {
  slug: string;
  name: string;
  group: "company" | "field" | "genre";
  definition: string;
  total: number;
  tags: string[];
  summaryTotal: number;
  recent: number;
  indexable: boolean;
  latestAt: string | null;
}

export async function listTopicSummaries(): Promise<TopicSummary[]> {
  const topics = await listTopics();
  const counts = new Map((await topicPageCounts()).map((c) => [c.slug, c]));
  return topics.map((t) => {
    const c = counts.get(t.slug);
    const entity = t.entity_id ? ENTITIES[t.entity_id] : null;
    const tags = t.grp === "company" ? [entity?.displayTag ?? entity?.name ?? t.name] : [...new Set(displayTags(t.tags))];
    return { slug: t.slug, name: t.name, group: t.grp, definition: t.definition, tags, total: c?.total ?? 0, summaryTotal: c?.summaryTotal ?? 0, recent: c?.recent ?? 0, indexable: c?.indexable ?? false, latestAt: c?.latest?.toISOString() ?? null };
  });
}

export interface TopicPage {
  topic: TopicSummary & { related: Array<{ slug: string; name: string }> };
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
  view: TopicView;
}

export type TopicView = "selected" | "all";

export async function loadTopicPage(slug: string, page: number, now = new Date(), view: TopicView = "selected"): Promise<TopicPage | null> {
  const row = await loadTopic(slug);
  if (!row || !Number.isInteger(page) || page < 1) return null;
  const topics = await listTopicSummaries();
  const topic = topics.find((t) => t.slug === slug);
  if (!topic) return null;
  const pageCount = Math.max(1, Math.ceil((view === "all" ? topic.summaryTotal : topic.total) / TOPIC_PAGE_SIZE));
  if (page < 1 || page > pageCount) return null;
  // Page ids from the requested public set first, then the joins for those rows only.
  const rows = await sql<ItemRow[]>`
    WITH page AS (
      SELECT p.article_id FROM publications p
      WHERE ${view === "all" ? listedCondition(now) : selectedCondition(now)} AND p.eligible AND p.tags && ${topicMatchTags(row)}::text[]
      ORDER BY p.timeline_at DESC, p.article_id DESC
      LIMIT ${TOPIC_PAGE_SIZE} OFFSET ${(page - 1) * TOPIC_PAGE_SIZE})
    SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE p.article_id IN (SELECT article_id FROM page)
    ORDER BY p.timeline_at DESC, p.article_id DESC`;
  const related = row.related.map((r) => topics.find((t) => t.slug === r)).filter((t): t is TopicSummary => !!t).map((t) => ({ slug: t.slug, name: t.name }));
  return { topic: { ...topic, related }, items: rows.map(toFeedItemSummary), page, pageCount, view };
}
