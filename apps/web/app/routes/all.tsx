import { SITE } from "@aihot/industry/site";
import { Link, redirect, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/all";
import type { PoolResponse } from "@aihot/contracts/site";
import { isCategoryKey, isChannelKey } from "@aihot/contracts/taxonomy";
import { apiGet, loadOr404, queryString } from "../lib/api.server";
import { listPath, pageMeta } from "../lib/seo";
import { CategoryTabs, SearchField, hrefWith } from "../features/feed/Filters";
import { PillTabs } from "../components/ui/Tabs";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState } from "../components/ui/Page";
import { RingMark } from "../components/Logo";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const channel = isChannelKey(channelParam) ? channelParam : "all";
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const tag = url.searchParams.get("tag")?.trim() || null;
  const q = url.searchParams.get("q")?.trim().slice(0, 200) || null;
  const tab = url.searchParams.get("tab") === "relevance" ? "relevance" : null;
  const view = url.searchParams.get("view") === "selected" ? "selected" : "all";
  const hashQuery = !!q && /^[#＃]/u.test(q);
  // Legacy deep-paging parameters (deep, anchorAt) still open a normal page.
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 50);
  const data = await loadOr404<PoolResponse>(
    `/api/site/pool${queryString({ channel: channel === "all" ? null : channel, category, tag, q, tab, view: view === "selected" ? view : null, page: hashQuery ? null : page > 1 ? page : null })}`,
    { signal: request.signal, busyRedirect: "/all/search-busy" },
  );
  if (hashQuery || tag !== data.filters.tag) {
    const canonical = new URLSearchParams(url.searchParams);
    canonical.delete("tag");
    if (data.filters.tag) canonical.set("tag", data.filters.tag);
    if (hashQuery) {
      for (const key of ["q", "tab", "page", "cursor", "deep", "anchorAt"]) canonical.delete(key);
    }
    throw redirect(`/all${canonical.size ? `?${canonical}` : ""}`);
  }
  const relatedTopics = data.filters.tag ? (await apiGet<{ topics: Array<{ slug: string; name: string; tags?: string[] }> }>("/api/site/topics", { signal: request.signal })).topics
    .filter((topic) => topic.tags?.some((entry) => entry.toLocaleLowerCase() === data.filters.tag!.toLocaleLowerCase()))
    .map(({ slug, name }) => ({ slug, name })) : [];
  return { data, relatedTopics };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.data.filters;
  const q = f?.q;
  const page = loaderData?.data.page ?? 1;
  return pageMeta({
    title: q ? `搜索：${q}` : f?.tag ? `#${f.tag} · ${f.view === "selected" ? "精选" : "全部摘要"}` : "全部动态",
    description: f?.tag ? `按 #${f.tag} 标签浏览${SITE.subject}相关文章，可切换精选与全部已公开摘要。` : `${SITE.name} 收录的全部动态，可按类别筛选、输入 #标签检索，或搜索中英文关键词。`,
    path: listPath("/all", { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, tag: f?.tag, q, tab: f?.tab === "relevance" ? "relevance" : null, view: f?.view === "selected" ? "selected" : null, page: page > 1 ? page : null }),
    noindex: !!q,
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" };
}

function pageHref(params: URLSearchParams, page: number) {
  const sp = new URLSearchParams(params);
  sp.delete("deep");
  sp.delete("anchorAt");
  sp.delete("search");
  if (page <= 1) sp.delete("page");
  else sp.set("page", String(page));
  const s = sp.toString();
  return s ? `/all?${s}` : "/all";
}

export default function AllPage() {
  const { data, relatedTopics } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const f = data.filters;
  const busy = navigation.state === "loading" && navigation.location?.pathname === "/all";
  const keep = { channel: f.channel === "all" ? null : f.channel, category: f.category };
  const searchValue = f.q ?? (f.tag ? `#${f.tag}` : "");
  const searchKeep = { ...keep, view: f.view === "selected" ? "selected" : null };
  const tagBrowsing = !!f.tag && !f.q;
  const searchTabHref = (tab: "time" | "relevance") => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    if (tab === "relevance") sp.set("tab", "relevance");
    else sp.delete("tab");
    return `/all?${sp}`;
  };
  const title = f.q ? `搜索“${f.q}”` : f.tag ? `#${f.tag}` : null;
  const updated = new Date(data.freshness).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });

  return (
    <div className="pb-6">
      {/* Desktop, as on 精选: the title, then one filter row with the search field aligned on the right. */}
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title ?? "全部动态"}</h1>
        <div className="mb-5 mt-4 flex items-center justify-between gap-4">
          <CategoryTabs base="/all" category={f.category} channel={f.channel} layoutId="all-cat-desk" className="min-w-0" />
          <SearchField variant="track" defaultValue={searchValue} keep={searchKeep} />
        </div>
      </div>

      {/* Phones: title with today's count, the search bar, then the same filter row as 精选. */}
      <div className="lg:hidden">
        <div className="flex items-baseline justify-between pb-3 pt-5">
          <h1 className="text-[22px] font-bold text-ink">{title ?? "全部动态"}</h1>
          {!f.q && (
            <span className="text-[12.5px] text-ink-4">
              今日 <span className="num">{data.todayCount}</span> 条
            </span>
          )}
        </div>
        <SearchField variant="bar" defaultValue={searchValue} keep={searchKeep} autoFocus={params.get("search") === "1"} />
        <div className="-mx-4 mt-3 border-b border-line-soft px-4 pb-3">
          <CategoryTabs base="/all" category={f.category} channel={f.channel} layoutId="all-cat-mobile" size="sm" className="min-w-0" />
        </div>
      </div>

      {tagBrowsing && (
        <div className="mb-4 mt-4 space-y-2.5 lg:mt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PillTabs
              size="sm"
              layoutId="tag-view"
              label="标签文章范围"
              active={f.view}
              items={[
                { key: "selected", label: "精选", count: data.tagCounts?.selected, to: hrefWith("/all", params, { view: "selected" }) },
                { key: "all", label: "全部摘要", count: data.tagCounts?.total, to: hrefWith("/all", params, { view: null }) },
              ]}
            />
            <span className="text-[12px] text-ink-4">当前 <span className="num">{data.total >= 2000 ? "2000+" : data.total}</span> 条{f.view === "selected" ? "精选" : "摘要"}</span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-4">按 #{f.tag} 标签筛选相关文章，全部摘要包含已公开的精选与非精选内容。</p>
          {relatedTopics.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-ink-4">相关主题</span>
              {relatedTopics.map((topic) => (
                <Link key={topic.slug} to={`/topics/${topic.slug}${f.view === "selected" ? "" : "?view=all"}`} className="chip">{topic.name}</Link>
              ))}
            </div>
          )}
        </div>
      )}

      {f.q && (
        <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-2 lg:mt-0">
          <PillTabs
            size="xs"
            layoutId="all-search-sort"
            label="搜索排序"
            active={f.tab}
            items={(["time", "relevance"] as const).map((t) => ({ key: t, label: t === "time" ? "最新（标题与摘要）" : "全文相关", to: searchTabHref(t) }))}
          />
          <span className="text-[12px] text-ink-4">
            找到 <span className="num">{data.total >= 2000 ? "2000+" : data.total}</span> 条 · 更新于 <span className="num">{updated}</span>
          </span>
        </div>
      )}

      <div className={`transition-opacity duration-200 ${busy ? "opacity-50" : ""}`}>
        {data.items.length === 0 ? (
          <div className="mt-2 lg:card">
            <EmptyState
              title="没有找到相关内容"
              action={
                tagBrowsing && f.view === "selected" && (data.tagCounts?.total ?? 0) > 0 ? (
                  <Link to={hrefWith("/all", params, { view: null })} className="text-[13px] font-medium text-accent hover:underline">查看全部 {data.tagCounts!.total} 条摘要</Link>
                ) : f.q && f.tab === "time" ? (
                  <Link to={searchTabHref("relevance")} className="text-[13px] font-medium text-accent hover:underline">
                    试试“全文相关”，连正文一起搜
                  </Link>
                ) : undefined
              }
            >
              {f.q ? "换个说法，或者去掉筛选再试。" : tagBrowsing ? f.view === "selected" ? "这个标签下暂时没有精选内容，可以切换到全部摘要。" : "这个标签下暂时没有相关文章，可输入 # 查看常用标签。" : "这个筛选下暂时没有内容。"}
            </EmptyState>
          </div>
        ) : (
          <DayList items={data.items} todayCount={f.q ? null : data.todayCount} showTags />
        )}
      </div>
      <Pagination page={data.page} pageCount={data.pageCount} href={(p) => pageHref(params, p)} />
      {data.page >= 50 && <p className="mt-4 text-center text-[12px] text-ink-4">最多提供 50 页，更早的内容请使用搜索或主题页。</p>}
    </div>
  );
}

export function SearchBusy() {
  return (
    <div className="mx-auto max-w-sm py-24 text-center">
      <RingMark className="mx-auto mb-5 size-10 text-accent" spinning />
      <h1 className="text-[20px] font-bold text-ink">搜索有点忙</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-3">现在搜索的人比较多，请稍等几秒再试。列表浏览不受影响。</p>
      <div className="mt-6 flex justify-center gap-2.5">
        <Link to="/all" className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-contrast hover:bg-accent-ink">浏览全部动态</Link>
        <Link to="/" className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-[13.5px] text-ink-2 hover:border-ink-4">回到精选</Link>
      </div>
    </div>
  );
}
