import type { TagSummary } from "@aihot/contracts/site";
export type { TagSummary } from "@aihot/contracts/site";

export type SearchInput = { kind: "tag"; tag: string } | { kind: "query"; query: string };

/** Only a leading hash changes search scope; spaces and slashes inside a tag stay literal. */
export function parseSearchInput(value: string): SearchInput {
  const text = value.trim();
  return /^[#＃]/.test(text) ? { kind: "tag", tag: text.replace(/^[#＃]+/, "").trim() } : { kind: "query", query: text };
}

/** Keep API order for equal totals, so filtering does not move tied suggestions around. */
export function tagSuggestions(tags: readonly TagSummary[], fragment: string, limit = 5): TagSummary[] {
  const query = fragment.toLowerCase();
  return tags.filter((entry) => entry.tag.toLowerCase().includes(query))
    .sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Shared by JavaScript submission and the native GET form's hidden fields. */
export function searchKeepParams(keep: Record<string, string | null>, tagMode: boolean): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(keep)) {
    if (!value || ["q", "tag", "topic", "page", "cursor", "search"].includes(key) || (key === "view" && !tagMode)) continue;
    params.set(key, value);
  }
  return params;
}

/** A bare hash opens suggestions without navigating to an empty tag filter. */
export function searchSubmitParams(value: string, keep: Record<string, string | null> = {}): URLSearchParams | null {
  const input = parseSearchInput(value);
  if (input.kind === "tag" && !input.tag) return null;
  const params = searchKeepParams(keep, input.kind === "tag");
  if (input.kind === "tag") params.set("tag", input.tag);
  else if (input.query) params.set("q", input.query);
  return params;
}
