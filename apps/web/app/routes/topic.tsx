import { SITE } from "@aihot/industry/site";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/topic";
import type { FeedItemSummary } from "@aihot/contracts/site";
import { loadOr404 } from "../lib/api.server";
import { breadcrumbLd, pageMeta, titled } from "../lib/seo";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState, MoreLink } from "../components/ui/Page";
import { PillTabs } from "../components/ui/Tabs";
import { SearchField } from "../features/feed/Filters";

/** Topic articles: shared caches keep the page as long as its api answer (one minute). */
export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=60" };
}

interface TopicPageData {
  topic: { slug: string; name: string; group: string; definition: string; tags: string[]; total: number; summaryTotal: number; indexable: boolean; related: Array<{ slug: string; name: string }> };
  view: "selected" | "all";
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const view = new URL(request.url).searchParams.get("view") === "all" ? "all" : "selected";
  const page = params.page ? Number(params.page) : 1;
  if (params.page !== undefined && (!/^\d+$/.test(params.page) || page < 1)) throw new Response("Not found", { status: 404 });
  // Page 1 lives at the topic's own address (308).
  if (params.page === "1") throw redirect(`/topics/${params.slug}${view === "all" ? "?view=all" : ""}`, 308);
  const data = await loadOr404<TopicPageData>(`/api/site/topics/${encodeURIComponent(params.slug)}?page=${page}${view === "all" ? "&view=all" : ""}`, { signal: request.signal });
  return { data };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("主题不存在") }, { name: "robots", content: "noindex" }];
  const { topic, page, view } = loaderData.data;
  const all = view === "all";
  const path = (page > 1 ? `/topics/${topic.slug}/page/${page}` : `/topics/${topic.slug}`) + (all ? "?view=all" : "");
  const title = all ? `${topic.name} · 全部摘要` : topic.name;
  return pageMeta({
    title: page > 1 ? `${title} · 第 ${page} 页` : title,
    description: all ? `${topic.definition} 按时间浏览全部已公开的相关文章摘要，包含精选与非精选内容。` : topic.definition,
    path,
    image: `/og/topics/${topic.slug}.png`,
    noindex: all || !topic.indexable,
    jsonLd: breadcrumbLd([{ name: SITE.name, path: "/" }, { name: "主题", path: "/topics" }, { name: title, path: `/topics/${topic.slug}${all ? "?view=all" : ""}` }]),
  });
}

export default function TopicPage() {
  const { data } = useLoaderData<typeof loader>();
  const { topic, items, page, pageCount } = data;
  const all = data.view === "all";
  const summaryTotal = topic.summaryTotal ?? topic.total;
  const total = all ? summaryTotal : topic.total;
  const viewQuery = all ? "?view=all" : "";
  const href = (p: number) => (p <= 1 ? `/topics/${topic.slug}` : `/topics/${topic.slug}/page/${p}`) + viewQuery;
  const first = (page - 1) * 20 + 1;
  const last = first + items.length - 1;
  return (
    <div className="pb-6">
      <header className="pb-4 pt-5 lg:pt-1">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[22px] font-bold leading-[1.35] text-ink">{topic.name}</h1>
          <span className="hidden pt-2 lg:block">
            <MoreLink to="/topics">全部主题</MoreLink>
          </span>
        </div>
        <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-ink-3">{topic.definition}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-4">精选优先呈现值得关注的文章；全部摘要包含该主题下已公开的精选与非精选内容，按时间排列。</p>
        {topic.tags?.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span className="text-ink-4">{topic.group === "company" ? "相关标签" : "按标签细分"}</span>
            {topic.tags.map((tag) => <Link key={tag} to={`/all?tag=${encodeURIComponent(tag)}${all ? "" : "&view=selected"}`} className="text-ink-3 hover:text-accent">#{tag}</Link>)}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="text-[12.5px] text-ink-4">
            <span className="num mr-1 text-[20px] font-bold text-ink">{total.toLocaleString("zh-CN")}</span>{all ? "条摘要" : "条精选"}
          </span>
          {topic.related.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-ink-4">相关主题</span>
              {topic.related.map((r) => (
                <Link key={r.slug} to={`/topics/${r.slug}${viewQuery}`} className="chip">
                  {r.name}
                </Link>
              ))}
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PillTabs
          size="sm"
          layoutId="topic-view"
          label="主题文章范围"
          active={all ? "all" : "selected"}
          items={[
            { key: "selected", label: "精选", count: topic.total, to: `/topics/${topic.slug}` },
            { key: "all", label: "全部摘要", count: summaryTotal, to: `/topics/${topic.slug}?view=all` },
          ]}
        />
        <div className="w-full sm:w-60"><SearchField /></div>
      </div>
      <div className="mb-1 mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[18px] font-bold text-ink">{all ? "最新摘要" : "最新精选"}</h2>
        {items.length > 0 && (
          <span className="num text-[12px] text-ink-4">
            第 {first}–{last} 条 · 共 {total.toLocaleString("zh-CN")} 条
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="lg:card">
          <EmptyState
            title={all ? "这个主题暂时还没有相关文章摘要" : "这个主题暂时还没有精选内容"}
            action={!all && summaryTotal > 0 ? <MoreLink to={`/topics/${topic.slug}?view=all`}>查看全部 {summaryTotal} 条摘要</MoreLink> : undefined}
          />
        </div>
      ) : (
        <DayList items={items} />
      )}
      <Pagination page={page} pageCount={pageCount} href={href} />
    </div>
  );
}
