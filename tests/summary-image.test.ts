import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectLeadImage } from "@aihot/backend/content/images";

test("summary illustration prefers a body photograph over a small feed thumbnail", () => {
  const image = selectLeadImage('<p><img src="/body.jpg?a=1&amp;b=2" width="1280" height="720" alt="Camera &amp; workflow"></p>',
    [{ kind: "image", url: "https://example.org/thumb.jpg" }], "https://example.org/article");
  assert.equal(image?.url, "https://example.org/body.jpg?a=1&b=2");
  assert.equal(image?.alt, "Camera & workflow");
  assert.deepEqual([image?.width, image?.height], [1280, 720]);
});

test("logos, tracking pixels, adverts and extreme strips do not replace the article illustration", () => {
  const html = '<img src="/site-logo.png"><img src="/analytics.jpg" width="1" height="1"><img src="/ad.jpg" alt="advertisement"><img src="/strip.jpg" width="2000" height="120"><img src="/photo.jpg" width="1000" height="600">';
  assert.equal(selectLeadImage(html, [], "https://example.org/article")?.url, "https://example.org/photo.jpg");
});

test("no useful picture means no illustration; unsafe schemes and video records are rejected", () => {
  assert.equal(selectLeadImage('<p>Text only.</p>', [], "https://example.org/article"), null);
  for (const media of [[{ url: "javascript:alert(1)" }], [{ url: "data:image/png;base64,abc" }], [{ url: "https://user:password@example.org/photo.jpg" }], [{ kind: "video", url: "https://example.org/video.mp4" }]]) {
    assert.equal(selectLeadImage(null, media, "https://example.org/article"), null);
  }
});

test("unknown dimensions remain usable, media fallback decodes feed entities and stale proxy wrappers", () => {
  const image = selectLeadImage(null, [{ kind: "image", url: "https://example.org/photo.jpg?resize=1170%2C1560&#038;ssl=1" }], "https://example.org/article");
  assert.equal(image?.url, "https://example.org/photo.jpg?resize=1170%2C1560&ssl=1");
  assert.deepEqual([image?.width, image?.height], [null, null]);
  const body = '<img src="https://old.example/api/img-proxy?u=https%3A%2F%2Fexample.org%2Fphoto.jpg&amp;mode=full&amp;sig=old">';
  assert.equal(selectLeadImage(body, null, "https://example.org/article")?.url, "https://example.org/photo.jpg");
});
