import { Link, useLoaderData } from "react-router";
import type { PoolResponse } from "@aihot/contracts/site";
import type { Route } from "./+types/source-articles";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState } from "../components/ui/Page";
import { IconArrowUpRight } from "../components/icons";

type SourcePage = PoolResponse & { source: { id: string; name: string; description: string; url: string; logo: string } };

export async function loader({ params, request }: Route.LoaderArgs) {
  const page = new URL(request.url).searchParams.get("page") ?? "1";
  return loadOr404<SourcePage>(`/api/site/source-directory/${encodeURIComponent(params.id)}?page=${encodeURIComponent(page)}`, { signal: request.signal });
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return pageMeta({ title: "来源不存在", path: "/source-directory", noindex: true });
  return pageMeta({ title: `${loaderData.source.name} · 全部文章`, description: loaderData.source.description, path: `/source-directory/${loaderData.source.id}${loaderData.page > 1 ? `?page=${loaderData.page}` : ""}` });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=60" };
}

export default function SourceArticlesPage() {
  const { source, items, total, page, pageCount } = useLoaderData<typeof loader>();
  return (
    <div className="pb-8">
      <header className="pb-4 pt-5 lg:pt-1">
        <Link to="/source-directory" className="text-[12px] text-ink-4 hover:text-accent">返回信息来源</Link>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-tile border border-line bg-white p-1.5"><img src={source.logo} alt="" width={36} height={36} className="size-9 object-contain" /></div>
          <h1 className="min-w-0 break-words text-[24px] font-semibold leading-[1.4] text-ink">{source.name}</h1>
        </div>
        <p className="mt-3 max-w-[720px] text-[13px] leading-[1.8] text-ink-3">{source.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <span className="text-ink-4">本站收录 <span className="num font-semibold text-ink">{total.toLocaleString("zh-CN")}</span> 篇文章</span>
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent">访问网站<IconArrowUpRight size={14} /></a>
        </div>
        <p className="mt-2 break-all text-[11.5px] text-ink-4">{source.url}</p>
      </header>
      {items.length ? <DayList items={items} /> : <EmptyState title="该来源暂时没有收录文章" />}
      <Pagination page={page} pageCount={pageCount} href={(n) => `/source-directory/${source.id}${n > 1 ? `?page=${n}` : ""}`} />
    </div>
  );
}
