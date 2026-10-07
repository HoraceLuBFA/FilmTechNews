import { SITE } from "@aihot/industry/site";
import { Link, useLoaderData } from "react-router";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

interface TopicSummary {
  slug: string;
  name: string;
  group: "company" | "field" | "genre";
  definition: string;
  total: number;
  summaryTotal: number;
  recent: number;
  indexable: boolean;
  latestAt: string | null;
}

export async function loader({ request }: { request: Request }) {
  return apiGet<{ topics: TopicSummary[] }>("/api/site/topics", { signal: request.signal });
}

export function meta() {
  return pageMeta({ title: "主题", description: `按技术方向、内容形态、机构与产品浏览${SITE.subject}资讯，可查看各主题的精选文章及全部相关文章摘要，包含已公开的精选与非精选内容。`, path: "/topics", image: "/og/pages/topics.png" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}

const GROUPS = [
  { key: "field", name: "技术方向", blurb: "按技术领域阅读：摄影、视效、虚拟制作、色彩、声音……" },
  { key: "genre", name: "内容形态", blurb: "按内容类型浏览：论文、教程、观点、政策……" },
  { key: "company", name: "机构与产品", blurb: "追踪设备与软件厂商、制作机构及技术组织的进展" },
] as const;

export default function TopicsPage() {
  const { topics } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <header className="pb-2 pt-5 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">按主题看{SITE.subject}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          按技术方向、内容形态、机构与产品浏览 <span className="num">{topics.length}</span> 个主题。可阅读精选文章，或查看全部相关文章摘要，包含已公开的精选与非精选内容。
        </p>
      </header>
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`topics-${g.key}`} className="pt-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id={`topics-${g.key}`} className="text-[15px] font-bold text-ink">
              {g.name}
            </h2>
            <p className="text-[12px] text-ink-4">{g.blurb}</p>
          </div>
          <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {topics
              .filter((t) => t.group === g.key)
              .map((t) => (
                <li key={t.slug}>
                  <div className="card card-hover group flex h-full flex-col px-4 py-[18px]">
                    <Link to={`/topics/${t.slug}`} prefetch="intent" aria-label={`查看${t.name}相关精选文章`} className="flex flex-1 flex-col">
                      <span className="text-[15px] font-bold text-ink transition-colors group-hover:text-accent">{t.name}</span>
                      <span className="mt-1.5 line-clamp-2 text-[12.5px] leading-[1.7] text-ink-3">{t.definition}</span>
                    </Link>
                    <div className="mono mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11.5px]">
                      <Link to={`/topics/${t.slug}`} prefetch="intent" className="inline-flex h-7 items-center whitespace-nowrap text-accent hover:underline" aria-label={`查看${t.name}的 ${t.total} 条精选文章`}>
                        查看 {t.total} 条精选
                      </Link>
                      <Link to={`/topics/${t.slug}?view=all`} prefetch="intent" className="inline-flex h-7 items-center whitespace-nowrap rounded-full border border-line-strong px-2 text-ink-3 transition-colors hover:border-accent hover:text-accent" aria-label={`查看${t.name}的全部 ${t.summaryTotal ?? t.total} 条相关文章摘要`}>
                        查看 {t.summaryTotal ?? t.total} 条摘要
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
