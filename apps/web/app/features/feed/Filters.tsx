// Feed filters: the channel and category row, and search.
import { useEffect, useId, useRef, useState } from "react";
import { Form, Link, useLocation, useNavigation, useSearchParams, useSubmit } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS, CHANNEL_LABELS, type CategoryKey, type ChannelKey } from "@aihot/contracts/taxonomy";
import { IconClose, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";
import { parseSearchInput, searchKeepParams, searchSubmitParams, tagSuggestions, type TagSummary } from "../../lib/tag-search";

/** Same page with some query parameters changed (paging state dropped). */
export function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * The feed's one filter row (精选 and 全部动态 alike): 全部, 一手, then the categories. One choice at a
 * time: picking 一手 clears the category and picking a category clears 一手. Older 资讯 / X links
 * still filter; the row then shows 全部.
 */
export function CategoryTabs({ base, category, channel = "all", layoutId, size = "md", className = "" }: { base: string; category: CategoryKey | null; channel?: ChannelKey; layoutId: string; size?: "md" | "sm"; className?: string }) {
  const [params] = useSearchParams();
  const items = [
    { key: "all", label: "全部", to: hrefWith(base, params, { category: null, channel: null }) },
    { key: "firstParty", label: CHANNEL_LABELS.firstParty, to: hrefWith(base, params, { category: null, channel: "firstParty" }) },
    ...CATEGORY_KEYS.map((k) => ({ key: k, label: CATEGORY_LABELS[k], to: hrefWith(base, params, { category: k, channel: null }) })),
  ];
  const active = channel === "firstParty" ? "firstParty" : (category ?? "all");
  return <PillTabs items={items} active={active} layoutId={layoutId} label="筛选" size={size} compact className={className} />;
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = ref.current;
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || !input?.getClientRects().length) return;
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        input.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

// Both responsive fields share the successful directory read; only a focused field starts it.
let tagDirectory: { tags: TagSummary[]; at: number } | null = null;

/**
 * Search field (GET /all?q=… or tag=…). Desktop ("track"): at the end of the filter row as the same grey track,
 * at the height of md tabs, with a "/" hint. Phones ("bar"): full width with a separate 搜索 button.
 */
export function SearchField({ action = "/all", defaultValue = "", keep = {}, variant = "track", autoFocus = false }: { action?: string; defaultValue?: string; keep?: Record<string, string | null>; variant?: "track" | "bar"; autoFocus?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const [tagState, setTagState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const navigation = useNavigation();
  const location = useLocation();
  const submit = useSubmit();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const uniqueId = useId();
  const inputId = `site-search-${uniqueId}`;
  const listId = `${inputId}-tags`;
  const input = parseSearchInput(value);
  const tagMode = input.kind === "tag";
  const suggestions = tagMode && tagState === "ready" && tags ? tagSuggestions(tags, input.tag) : [];
  const open = focused && tagMode && !dismissed;
  useEffect(() => { setValue(defaultValue); setActive(-1); setDismissed(true); }, [defaultValue, location.key]);
  useSlashFocus(inputRef);
  useEffect(() => {
    if (autoFocus && inputRef.current?.getClientRects().length) inputRef.current.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!focused || !tagMode) return;
    if (tagDirectory && Date.now() - tagDirectory.at < 60_000) { setTags(tagDirectory.tags); setTagState("ready"); return; }
    const controller = new AbortController();
    setTagState("loading");
    void fetch("/api/site/tags", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("tag directory unavailable");
        const data = await response.json() as { tags?: TagSummary[] };
        if (!Array.isArray(data.tags) || !data.tags.every((entry) => entry && typeof entry.tag === "string" && Number.isInteger(entry.total) && entry.total >= 0 && Number.isInteger(entry.selectedTotal) && entry.selectedTotal >= 0)) throw new Error("invalid tag directory");
        if (controller.signal.aborted) return;
        tagDirectory = { tags: data.tags, at: Date.now() };
        setTags(data.tags);
        setTagState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setTagState("error"); });
    return () => controller.abort();
  }, [focused, tagMode]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (formRef.current?.contains(event.target as Node)) return;
      setFocused(false);
      setActive(-1);
      inputRef.current?.blur();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const destination = navigation.location ? new URLSearchParams(navigation.location.search) : null;
  const searching = navigation.state === "loading" && navigation.location?.pathname === action && !!(destination?.get("q") || destination?.get("tag"));
  const hidden = [...searchKeepParams(keep, tagMode)].map(([key, v]) => <input key={key} type="hidden" name={key} value={v} />);
  const chooseTag = (tag: string) => {
    setValue(`#${tag}`);
    setDismissed(true);
    setActive(-1);
    void submit(searchSubmitParams(`#${tag}`, keep)!, { method: "get", action });
  };
  const formProps = {
    ref: formRef,
    method: "get" as const,
    action,
    role: "search",
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (composing.current) return;
      const params = searchSubmitParams(value, keep);
      if (!params) { setDismissed(false); return; }
      setDismissed(true);
      void submit(params, { method: "get", action });
    },
    onBlur: (event: React.FocusEvent<HTMLFormElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocused(false); setActive(-1); }
    },
  };
  const inputProps = {
    ref: inputRef,
    id: inputId,
    name: "q",
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setValue(event.target.value); setActive(-1); setDismissed(false); },
    onFocus: () => { setFocused(true); setDismissed(false); },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) {
        if (event.key === "Enter") event.preventDefault();
        return;
      }
      if (!tagMode) return;
      if (event.key === "Escape") { event.preventDefault(); setDismissed(true); setActive(-1); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setDismissed(false);
        if (suggestions.length) setActive((previous) => event.key === "ArrowDown" ? (previous + 1) % suggestions.length : (previous < 0 ? suggestions.length - 1 : (previous - 1 + suggestions.length) % suggestions.length));
      }
      if (event.key === "Enter" && open && active >= 0 && suggestions[active]) { event.preventDefault(); chooseTag(suggestions[active].tag); }
    },
    role: "combobox" as const,
    "aria-autocomplete": tagMode ? "list" as const : "none" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open && active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined,
    "aria-haspopup": "listbox" as const,
    placeholder: "搜索标题、摘要或 #标签…",
    maxLength: 200,
    autoComplete: "off",
    enterKeyHint: "search" as const,
  };
  const popup = open ? (
    <div id={listId} role="listbox" aria-label="标签建议" className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-card border border-line bg-surface p-1 shadow-[var(--shadow-soft)]">
      {tagState === "ready" && suggestions.length ? suggestions.map((entry, index) => (
        <button key={entry.tag} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index}
          onPointerDown={(event) => event.preventDefault()} onClick={() => chooseTag(entry.tag)} onPointerMove={() => setActive(index)}
          className={`flex w-full items-center justify-between gap-3 rounded-control px-3 py-2.5 text-left text-[13px] transition-colors ${active === index ? "bg-bg-sunk text-ink" : "text-ink-2 hover:bg-bg-sunk"}`}>
          <span className="min-w-0 break-words">#{entry.tag}</span><span className="num shrink-0 text-[11.5px] text-ink-4">{entry.total.toLocaleString("zh-CN")} 条摘要</span>
        </button>
      )) : <p role="status" className="px-3 py-2.5 text-[12.5px] text-ink-4">{tagState === "error" ? "标签暂时无法加载，请重新聚焦重试" : tagState === "ready" ? "没有匹配的标签，可直接搜索" : "正在加载标签…"}</p>}
    </div>
  ) : null;

  if (variant === "bar") {
    return (
      <Form {...formProps} className="relative flex gap-2">
        {hidden}
        <label htmlFor={inputId} className="sr-only">搜索标题、摘要与正文，输入井号筛选标签</label>
        <div className="relative flex-1">
          <IconSearch size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            {...inputProps}
            className="h-11 w-full rounded-full border border-line-strong bg-surface pl-10 pr-9 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-4 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          {value && (
            <button type="button" aria-label="清空" onClick={() => { setValue(""); inputRef.current?.focus(); }} className="absolute right-2.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-4">
              <IconClose size={15} />
            </button>
          )}
        </div>
        <button type="submit" className={`h-11 shrink-0 rounded-full bg-accent px-5 text-[14.5px] font-semibold text-accent-contrast transition-[background-color,transform] active:scale-[0.98] ${searching ? "opacity-60" : ""}`}>
          搜索
        </button>
        {popup}
      </Form>
    );
  }

  return (
    <Form {...formProps} className="group relative w-full shrink-0 lg:w-60">
      {hidden}
      <label htmlFor={inputId} className="sr-only">
        搜索标题、摘要与正文，输入井号筛选标签
      </label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        {...inputProps}
        className="h-[42px] w-full rounded-full bg-bg-sunk pl-10 pr-10 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
      {popup}
    </Form>
  );
}

/** Mobile home: the search icon at the end of the category row opens search on 全部动态. */
export function SearchIconLink({ to = "/all?search=1" }: { to?: string }) {
  return (
    <Link to={to} aria-label="搜索" className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink">
      <IconSearch size={19} />
    </Link>
  );
}
