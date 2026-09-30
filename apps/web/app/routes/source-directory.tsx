import { SOURCE_DIRECTORY, SOURCE_GROUPS } from "@aihot/industry/source-directory";
import { Link, useLoaderData } from "react-router";
import { apiGet } from "../lib/api.server";
import { IconArrowUpRight } from "../components/icons";
import { pageMeta } from "../lib/seo";

export function meta() {
  return pageMeta({ title: "信息来源", description: "了解影视技术日报关注的信息来源，按摄影、视效动画、后期声音、媒体工程及影视产业浏览网站介绍与主站链接。", path: "/source-directory" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=60" };
}

export async function loader({ request }: { request: Request }) {
  return apiGet<{ sources: Array<{ id: string; total: number }> }>("/api/site/source-directory", { signal: request.signal });
}

export default function SourcesPage() {
  const { sources: counts } = useLoaderData<typeof loader>();
  const totals = new Map(counts.map((source) => [source.id, source.total]));
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-10">
      <header className="pb-2 pt-5 lg:pt-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">信息来源</h1>
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11.5px] font-medium text-accent dark:bg-accent-soft">
            <span className="num">{SOURCE_DIRECTORY.length}</span> 个来源
          </span>
        </div>
        <p className="mt-2 max-w-[680px] text-[13px] leading-[1.8] text-ink-3">
          从摄影器材与片场实践，到视效、后期、声音和媒体工程，了解本站持续关注的网站及其内容特色，也可以直接访问主站，探索更多原始报道。
        </p>
        <nav aria-label="来源分类" className="mt-4 flex flex-wrap gap-2">
          {SOURCE_GROUPS.map((group) => (
            <a key={group.id} href={`#sources-${group.id}`} className="rounded-control border border-line px-3 py-2 text-[12px] text-ink-3 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent">
              {group.name}
            </a>
          ))}
        </nav>
      </header>
      {SOURCE_GROUPS.map((group) => {
        const sources = SOURCE_DIRECTORY.filter((source) => source.group === group.id);
        return (
          <section key={group.id} id={`sources-${group.id}`} aria-labelledby={`heading-${group.id}`} className="scroll-mt-6 pt-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`heading-${group.id}`} className="text-[15px] font-bold text-ink">
                {group.name}<span className="num ml-2 text-[12px] font-normal text-ink-4">{sources.length}</span>
              </h2>
              <p className="text-[12px] text-ink-4">{group.description}</p>
            </div>
            <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {sources.map((source) => (
                <li key={source.id} className="min-w-0">
                  <article className="card card-hover flex h-full flex-col p-5" data-source-id={source.id}>
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-tile border border-line bg-white p-1.5">
                        <img src={source.logo} alt="" width={36} height={36} loading="lazy" className="size-9 object-contain" />
                      </div>
                      <h3 className="min-w-0 break-words text-[15px] font-semibold leading-[1.5] text-ink">{source.name}</h3>
                    </div>
                    <p className="mb-4 mt-3.5 flex-1 text-[12.5px] leading-[1.8] text-ink-3">{source.description}</p>
                    <p className="break-all text-[11.5px] leading-[1.7] text-ink-4">{source.url}</p>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`访问 ${source.name} 主站（新窗口）`} className="mt-3 inline-flex min-h-10 items-center justify-between gap-2 rounded-control border border-line px-3 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent">
                      <span>访问网站<span className="num ml-2 text-[11px] font-normal text-ink-4">本站收录 {totals.get(source.id) ?? 0} 篇</span></span><IconArrowUpRight size={15} />
                    </a>
                    <Link to={`/source-directory/${source.id}`} prefetch="intent" className="mt-2 inline-flex min-h-10 items-center justify-between gap-2 rounded-control bg-accent/5 px-3 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10">
                      查看该来源全部文章<IconArrowUpRight size={15} />
                    </Link>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
