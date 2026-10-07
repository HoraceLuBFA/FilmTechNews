// 站点身份和读者看得到的文案。换成你的行业时，先改这个文件。
// 网页和后端都读它；改完重新构建（docker compose up --build）即可生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置。

export const SITE = {
  /** 站名：导航、页面标题、分享图、RSS、MCP、后台都用它。 */
  name: "影视技术日报",
  /**
   * 行业词：拼进默认说法里，比如“影视技术日报”“影视技术动态”。
   * 改成“法律”“HR”“黄金”之类，页面上就会变成“法律日报”“法律动态”。
   */
  subject: "影视技术",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "影视技术日报 | FilmTechNews",
  /** 一句话介绍：搜索引擎、分享卡片、RSS、llms.txt 会用。 */
  description: "汇集影视制作、影像工程与沉浸式呈现资讯，保留原始来源，精选技术变化与制作经验。",
  /** 首页左上角和侧边栏下面的一行小字。 */
  tagline: "从制作方法到影像呈现",
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用。 */
  defaultUrl: "http://localhost:3000",
  /**
   * MCP 工具名的前缀（小写字母、数字、下划线），工具会叫 myhot_get_latest、myhot_search……
   * 已经有人接入后就不要再改。
   */
  mcpPrefix: "filmtechnews",
  /** 对外联系邮箱（选填）：使用规则、llms.txt、响应头里会写。 */
  contactEmail: null as string | null,
  /** 页脚的版权署名。 */
  footerNote: "© Menghe (Horace) Lu",
  /** 维护者的个人主页，显示在辅助导航中。 */
  homepage: { url: "https://www.lumenghe.com/", label: "鲁梦河的个人主页" },
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在页脚并链接到工信部备案系统。 */
  icp: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "影视技术日报",
    /** 创始人（选填）：{ name, url, description }。 */
    founder: null as null | { name: string; url?: string; description?: string },
  },
  /** 抓取信源时报上的名字（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "FilmTechNewsBot",
} as const;

/** 关于页的文案。数字（信源数、收录数、精选数、日报期数）来自站内实时统计，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["看见影视技术的变化，", "理解制作背后的方法。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实时的信源数。 */
  lead: `${SITE.name} 汇集 {sources} 个信源，按技术价值筛选、归并与整理。摘要与推荐理由由模型辅助生成，重要信息请核对原文。`,
  /** 信源河动画下面的四个环节。 */
  steps: {
    collect: "从专业媒体、厂商、制作公司及技术组织的公开来源发现资讯，优先使用订阅源。",
    store: "将同一事件的报道归并，保留发布者、原文链接与时间，区分原始发布和后续报道。",
    select: "结合技术变化、证据、制作方法与专业相关性筛选，重视幕后经验、独立测试和标准更新。",
    publish: "按北京时间每日 08:00 编排日报，另提供周报、月报及原文阅读入口。",
  },
  /**
   * 作者块（选填），null 就不显示。
   * avatarSourceId：一个 X 账号信源的 id，头像取它的（选填）。
   * 二维码在后台“设置”里上传，或者放进 industry/brand/contact/；没有二维码就不显示那张卡片。
   */
  maker: null as null | {
    name: string;
    greeting: string[];
    avatarSourceId?: string | null;
    wechat?: { title: string; note: string };
    feishu?: { title: string; note: string };
  },
  /** 页面底部的版权与下架说明（结尾会接“反馈页”的链接）。 */
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。如果你是来源方，希望更正、下架或调整展示方式，可以通过`,
} as const;

/** “影视技术日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}
