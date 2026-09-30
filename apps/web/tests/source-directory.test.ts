import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SOURCE_DIRECTORY, SOURCE_GROUPS } from "@aihot/industry/source-directory";
import { resolveRedirect } from "@aihot/contracts/http-policy";

test("the public directory does not collide with existing source admin bookmarks", () => {
  assert.equal(resolveRedirect("/source-directory", ""), null);
  assert.equal(resolveRedirect("/source-directory/", "")?.location, "/source-directory");
  assert.equal(resolveRedirect("/sources", "")?.location, "/admin/sources");
  assert.equal(resolveRedirect("/sources/cined", "")?.location, "/admin/sources/cined");
});

test("the reader directory covers every configured source exactly once, including paused sources", async () => {
  const configured = JSON.parse(await readFile(new URL("../../../industry/sources.json", import.meta.url), "utf8"));
  const ids = SOURCE_DIRECTORY.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), configured.sources.map((source: { id: string }) => source.id).sort());
  for (const group of SOURCE_GROUPS) assert.ok(SOURCE_DIRECTORY.some((source) => source.group === group.id));
  for (const source of SOURCE_DIRECTORY) {
    assert.ok(SOURCE_GROUPS.some((group) => group.id === source.group));
    assert.deepEqual(Object.keys(source).sort(), ["description", "group", "id", "logo", "name", "url"]);
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.pathname, "/", "visit links point to the main site, not the collection feed");
    assert.equal(url.search + url.hash + url.username + url.password, "");
    assert.match(source.logo, /^\/source-logos\/[a-z0-9-]+\.(png|ico|svg|jpg|webp)$/);
    const logo = await readFile(new URL(`../public${source.logo}`, import.meta.url));
    assert.ok(logo.length > 0, "every card has a locally served brand mark");
  }
});
