import { useEffect, useRef, useState } from "react";
import type { MediaView } from "@aihot/contracts/site";
import { Lightbox } from "../../components/ui/Lightbox";

/** A source illustration above the summary; failed pictures leave no frame or placeholder. */
export function LeadImage({ image, sourceName, originalUrl }: { image: MediaView; sourceName: string; originalUrl: string }) {
  const [open, setOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const picture = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A fast failure can precede hydration, before React attaches the error handler.
    if (picture.current?.complete && picture.current.naturalWidth === 0) setFailedUrl(image.url);
  }, [image.url]);
  if (failedUrl === image.url) return null;
  return (
    <figure className="mb-5">
      <button type="button" onClick={() => setOpen(true)} aria-label="查看原文配图大图" className="block w-full cursor-zoom-in overflow-hidden rounded-tile border border-line-soft bg-bg-sunk focus-visible:outline-2 focus-visible:outline-accent">
        <img
          ref={picture}
          src={image.url}
          srcSet={image.srcSet}
          sizes="(min-width: 1536px) 760px, (min-width: 1024px) calc(100vw - 524px), (min-width: 640px) 608px, calc(100vw - 32px)"
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          alt={image.alt ?? "原文配图"}
          decoding="async"
          onError={() => { setFailedUrl(image.url); setOpen(false); }}
          className="block h-auto max-h-[420px] w-full object-contain sm:max-h-[520px]"
        />
      </button>
      <figcaption className="mt-2 text-[12px] leading-relaxed text-ink-4">
        图片来源：<a href={originalUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{sourceName}</a>
      </figcaption>
      <Lightbox images={[{ src: image.fullUrl ?? image.url, alt: image.alt }]} index={open ? 0 : null} onIndex={() => {}} onClose={() => setOpen(false)} />
    </figure>
  );
}
