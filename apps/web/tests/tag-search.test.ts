import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSearchInput, searchSubmitParams, tagSuggestions } from "../app/lib/tag-search.ts";

test("hash input selects literal tags without changing spaces, slashes or ordinary keywords", () => {
  assert.deepEqual(parseSearchInput(" # "), { kind: "tag", tag: "" });
  assert.deepEqual(parseSearchInput(" ＃摄影 / HDR "), { kind: "tag", tag: "摄影 / HDR" });
  assert.deepEqual(parseSearchInput("＃##摄影"), { kind: "tag", tag: "摄影" });
  assert.deepEqual(parseSearchInput("##＃ "), { kind: "tag", tag: "" });
  assert.deepEqual(parseSearchInput("#AC/DC workflow"), { kind: "tag", tag: "AC/DC workflow" });
  assert.deepEqual(parseSearchInput("new #camera"), { kind: "query", query: "new #camera" });
  assert.deepEqual(parseSearchInput("摄影"), { kind: "query", query: "摄影" });
});

test("tag submissions preserve filter scope and encode exact tags, including unknown ones", () => {
  const keep = { channel: "firstParty", category: "camera-lighting", view: "selected", q: "old", tag: "old-tag", topic: "old-topic", page: "2", cursor: "old-cursor" };
  const params = searchSubmitParams("＃摄影 / HDR", keep)!;
  const url = new URL(`/all?${params}`, "https://example.com");
  assert.equal(url.searchParams.get("tag"), "摄影 / HDR");
  assert.equal(url.searchParams.get("view"), "selected");
  assert.equal(url.searchParams.get("channel"), "firstParty");
  assert.equal(url.searchParams.get("category"), "camera-lighting");
  for (const key of ["q", "topic", "page", "cursor"]) assert.equal(url.searchParams.has(key), false);
  assert.equal(searchSubmitParams("#tag-not-in-directory")!.get("tag"), "tag-not-in-directory");
  assert.equal(searchSubmitParams("#", keep), null);
  assert.equal(searchSubmitParams("＃ ", keep), null);
});

test("keyword and cleared searches discard previous tag, topic, view and pagination", () => {
  const keep = { channel: "news", category: "sound", tag: "音频", topic: "sound", view: "selected", cursor: "old", page: "3", search: "1" };
  assert.deepEqual([...searchSubmitParams("  studio audio  ", keep)!], [["channel", "news"], ["category", "sound"], ["q", "studio audio"]]);
  assert.deepEqual([...searchSubmitParams("", keep)!], [["channel", "news"], ["category", "sound"]]);
});

test("suggestions rank the whole directory before limiting, retain tie order and filter without case", () => {
  const tags = [
    { tag: "HDR output", total: 2, selectedTotal: 1 },
    { tag: "camera", total: 100, selectedTotal: 10 },
    { tag: "HDR input", total: 20, selectedTotal: 0 },
    { tag: "摄影", total: 50, selectedTotal: 2 },
    { tag: "hdr grading", total: 20, selectedTotal: 3 },
    { tag: "lighting", total: 30, selectedTotal: 1 },
    { tag: "HDR display", total: 10, selectedTotal: 2 },
    { tag: "HDR monitor", total: 9, selectedTotal: 2 },
    { tag: "HDR capture", total: 8, selectedTotal: 2 },
  ];
  const original = structuredClone(tags);
  assert.deepEqual(tagSuggestions(tags, "").map((entry) => entry.tag), ["camera", "摄影", "lighting", "HDR input", "hdr grading"]);
  assert.deepEqual(tagSuggestions(tags, "HdR").map((entry) => entry.tag), ["HDR input", "hdr grading", "HDR display", "HDR monitor", "HDR capture"]);
  assert.deepEqual(tagSuggestions(tags, "output").map((entry) => entry.tag), ["HDR output"]);
  assert.deepEqual(tagSuggestions(tags, "missing"), []);
  assert.deepEqual(tags, original, "suggestion ranking does not reorder the cached directory");
});
