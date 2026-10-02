// One suitable picture from already collected article content; no fetch or model request at read time.
import * as cheerio from "cheerio";
import type { MediaItem } from "./materials.ts";
import { unwrapProxyUrl } from "./sanitize.ts";

const CHROME_IMAGE = /(?:^|[\s/_.-])(?:logo|avatar|favicon|icon|sprite|spacer|pixel|tracking|tracker|advert|advertisement|ads|banner|newsletter)(?:[\s/_.-]|$)/i;

function dimension(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function image(raw: Partial<MediaItem>, base: string): MediaItem | null {
  if (raw.kind && raw.kind !== "image" || typeof raw.url !== "string" || !raw.url) return null;
  try {
    const decoded = raw.url.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&");
    const url = new URL(unwrapProxyUrl(decoded), base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const width = dimension(raw.width), height = dimension(raw.height);
    // Small marks and extreme strips are generally page furniture, not useful summary illustrations.
    if (width !== null && width < 200 || height !== null && height < 100) return null;
    if (width && height && (width / height > 5 || height / width > 4)) return null;
    const alt = typeof raw.alt === "string" ? raw.alt.replace(/\s+/g, " ").trim().slice(0, 300) : null;
    if (CHROME_IMAGE.test(decodeURIComponent(url.pathname) + " " + (alt ?? ""))) return null;
    return { kind: "image", url: url.href, width, height, alt: alt || null };
  } catch { return null; }
}

/** Prefer a useful body image over a feed's often-small thumbnail; retain article order. */
export function selectLeadImage(bodyHtml: string | null, media: unknown, articleUrl: string): MediaItem | null {
  if (bodyHtml && /<img\b/i.test(bodyHtml)) {
    const $ = cheerio.load(bodyHtml, null, false);
    for (const el of $("img").toArray()) {
      const img = $(el);
      const found = image({ kind: "image", url: img.attr("src"), width: dimension(img.attr("width")), height: dimension(img.attr("height")), alt: img.attr("alt") }, articleUrl);
      if (found) return found;
    }
  }
  for (const raw of Array.isArray(media) ? media : []) {
    if (!raw || typeof raw !== "object") continue;
    const found = image(raw, articleUrl);
    if (found) return found;
  }
  return null;
}
