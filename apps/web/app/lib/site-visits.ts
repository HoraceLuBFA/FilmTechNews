import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { SiteVisits } from "@aihot/contracts/site";

export const SITE_VISITS_EVENT = "filmtech:site-visits";

/** Browser page views only; prefetches, hash scrolling and private pages are not counted. */
export function useSiteVisits() {
  const { pathname, search } = useLocation();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (/^\/(?:admin|log|api)(?:\/|$)/i.test(pathname)) {
      last.current = null;
      return;
    }
    const page = pathname + search;
    const count = () => {
      if (document.visibilityState !== "visible" || last.current === page) return;
      last.current = page;
      // No URL, referrer, cookie, browser identifier or local-storage entry is sent or created.
      void fetch("/api/site/visits", { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
        .then(async (response) => {
          if (!response.ok || response.status === 204) return;
          const visits = await response.json() as SiteVisits;
          window.dispatchEvent(new CustomEvent(SITE_VISITS_EVENT, { detail: visits }));
        }).catch(() => {});
    };
    count();
    document.addEventListener("visibilitychange", count);
    return () => document.removeEventListener("visibilitychange", count);
  }, [pathname, search]);
}
