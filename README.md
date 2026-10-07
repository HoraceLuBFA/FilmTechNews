# 影视技术日报 / FilmTechNews

FilmTechNews 汇集影视制作、影像技术及媒体工程领域的公开资讯，通过技术相关性筛选、中文摘要和事件归并，帮助从业者、教师、学生与研究者了解行业进展。

**访问网站：[影视技术日报](https://filmtech.lumenghe.com)**

## 内容范围

内容覆盖摄影现场、视效动画、虚拟制作、剪辑色彩、声音、媒体工程、影院与沉浸、AI 影视、标准研究和产业动态，汇集 30 余个专业媒体、行业组织与技术网站的公开信息。

筛选重点是具体的技术变化、可复核参数、制作方法、工作流与标准更新。有实质技术关联的产业报道也会纳入；普通人事任免、经营财务、版权交易、影评影讯与娱乐宣传通常不在收录范围内。

## 如何阅读

| 栏目 | 内容与用途 |
| --- | --- |
| [精选](https://filmtech.lumenghe.com/) | 优先阅读具有较高技术价值的报道。 |
| [全部动态](https://filmtech.lumenghe.com/all) | 按时间浏览已收录资讯，按类别或 #标签筛选；标签结果可切换精选与全部摘要。 |
| [热点](https://filmtech.lumenghe.com/hot) | 按事件查看相关报道，了解不同来源的关注点。 |
| [日报](https://filmtech.lumenghe.com/daily)、[周报](https://filmtech.lumenghe.com/weekly)、[月报](https://filmtech.lumenghe.com/monthly) | 阅读不同时间跨度的技术进展汇编，并查阅历史期刊。 |
| [主题](https://filmtech.lumenghe.com/topics) | 按技术方向、内容形态、机构与产品阅读精选文章，或查看全部相关文章摘要及总条目数。 |
| [信息来源](https://filmtech.lumenghe.com/source-directory) | 查看各来源的特色、主站链接和已收录文章。 |
| [收藏](https://filmtech.lumenghe.com/starred) | 保存感兴趣的文章，便于后续查阅。 |

搜索框支持关键词与标签两种用法：输入 `#` 显示按全站已公开文章收录数排序的最多五个常用标签，继续输入可缩小候选范围，选择或直接提交 `#标签` 即按标签筛选。点击文章卡片上的标签也会进入同一筛选页，并在搜索框显示当前标签。标签结果可切换精选与全部摘要；主题保留按多个标签汇集内容或按机构主体归类的范围，可从主题页进入具体标签，也可从标签结果进入相关主题。

文章提供分段的中文摘要与原文链接，摘要尽量覆盖核心事实、技术方法、参数、结果和适用限制，长度随原文信息量调整。列表使用简短预览，详情页提供完整摘要；原文有合适配图时，在摘要开头展示一张并标注来源，没有则保留纯文字。网站不公开抓取全文。

内容持续更新，新稿数量随信源供稿和筛选结果变化。历史补录保留原始日期，避免将旧内容误作当日新进展。

## 订阅与接入

除网页阅读外，也可通过 [精选 RSS](https://filmtech.lumenghe.com/feed.xml) 与 [全部动态 RSS](https://filmtech.lumenghe.com/feed/all.xml) 订阅内容。项目提供公开 API 与 MCP 接口，相关说明见 [API 文档](https://filmtech.lumenghe.com/openapi-v1.json)和[智能体接入页面](https://filmtech.lumenghe.com/agent)。

## 开发与定制

项目采用 Node.js、PostgreSQL 和 React，采集处理、HTTP API 与网页界面分离。站名、分类、主题、信源和筛选规则集中在 `industry/`，便于调整行业范围与内容组织。

开发者可参考[架构说明](docs/architecture.md)、[行业定制指南](docs/customize.md)与[信源配置说明](docs/sources.md)。

## 项目说明

FilmTechNews 基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 改造，感谢原项目提供采集、筛选、事件归组与报刊生成框架。

本项目为 Horace 维护的个人实验项目，不代表任职机构立场。中文摘要由自动化工具辅助整理，重要结论、技术参数和引用请核对原始来源。使用说明见网站的[条款](https://filmtech.lumenghe.com/terms)与[隐私说明](https://filmtech.lumenghe.com/privacy)，问题或建议可通过[站内反馈](https://filmtech.lumenghe.com/feedback)提交。
