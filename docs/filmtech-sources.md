# FilmTechNews 信源与处理规则

## 2026-09-30 OpenClaw 来源同步

依据用户提供的《20260930 OpenClaw影视技术日报来源与URL抓取筛选规则.md》，同步其中全部 30 个来源配置，另保留 ASWF、Cinema Technology，共 32 个。腾讯云现有代理出口上使用项目实际 RSS/网页读取器验证：31 个启用来源可解析出条目；CineMontage 两个公开 feed 入口均返回 403，保留配置但暂停。这里只证明所列入口与样本的读取结果，低频或陈旧 feed 不等于持续有新稿。

A/B/C 为来源用途，不替代 T1/T2 身份评级。A 10 个、B 11 个、C 9 个；A 来源也可能实际只提供摘要，因此按每篇正文长度判断，不能把分组当作全文保证。所有来源均关闭站内全文及全文 RSS。完整路径以 industry/sources.json 为准。

| 来源 | 用途 | 读取条目数 | 返回的最新日期（UTC） | 状态或特例 |
| --- | --- | ---: | --- | --- |
| CineD | A | 20 | 2026-09-29 | 启用 |
| Y.M.Cinema | A | 10 | 2026-09-29 | 需官方或独立专业来源交叉印证 |
| ProVideo Coalition | A | 10 | 2026-09-29 | 启用 |
| befores & afters | A | 10 | 2026-09-29 | 启用 |
| RedShark News | A | 10 | 2026-09-29 | 启用 |
| VFX Voice | A | 10 | 2026-09-29 | 启用 |
| CineMontage | A | 0 | 无 | 暂停：HTTP 403 |
| Production Expert | A | 20 | 2026-09-29 | 启用 |
| Mix Online | A | 20 | 2026-09-29 | 启用 |
| Film and Digital Times | A | 10 | 2026-09-08 | 近期低频，保留原日期 |
| Newsshooter | B | 5 | 2026-09-30 | 启用 |
| The Art of VFX | B | 20 | 2026-09-29 | 启用 |
| postPerspective | B | 10 | 2026-09-29 | 启用 |
| fxguide | B | 15 | 2026-09-09 | 近期低频，保留原日期 |
| British Cinematographer | B | 100 | 2026-09-28 | 启用 |
| CG Channel | B | 19 | 2026-09-29 | 网页新闻列表；旧 RSS 停在 2024 年，弃用 |
| TV Tech | B | 50 | 2026-09-29 | 启用 |
| Filmmaker Magazine | B | 20 | 2026-07-29 | RSS 陈旧，保留低频观察，不冒充当日新闻 |
| Animation Magazine | B | 20 | 2026-09-29 | 启用 |
| Motionographer | B | 10 | 2026-09-29 | 启用 |
| Digital Cinema Report | B | 10 | 2026-09-29 | 直连详情 Readability 样本 3354 字符 |
| TheWrap | C | 10 | 2026-09-30 | 启用 |
| Deadline | C | 12 | 2026-09-29 | 启用 |
| Variety | C | 10 | 2026-09-30 | 只读标题与公开摘要；需交叉印证 |
| IndieWire | C | 12 | 2026-09-29 | 启用 |
| Cartoon Brew | C | 20 | 2026-09-29 | 启用 |
| Stephen Follows | C | 20 | 2026-09-28 | 首次连接失败，复测成功；规范入口 /feed |
| THR Business | C | 10 | 2026-09-29 | 启用 |
| C21Media | C | 22 | 2026-09-29 | 只读标题与公开摘要；需交叉印证 |
| Advanced Television | C | 10 | 2026-09-29 | 启用 |
| Cinema Technology | 补充 | 20 | 2026-08-04 | 近期低频，保留原日期 |
| Academy Software Foundation | 补充 | 10 | 2026-09-15 | 启用 |

### 已落实的机制

- RSS 优先使用公开正文；启用 fullTextMinChars=1500，短正文保留为摘要用于预筛，不能静默丢弃。RSS/Atom 日期、链接、HTML 清理沿用现有解析器，并补充 RSS 内 Atom 链接回退。带浏览器兼容 UA，同时保留 FilmTechNews 爬虫身份。
- bodyPolicy=prefilter_first：先判断领域相关性，再对 PASS/UNKNOWN 的正文不足条目补抓；明确无关只消耗预筛步骤。bodyPolicy=feed_only：解析器只接纳标题和 description/summary，提取入口禁止补正文。后者用于 Variety 与 C21Media。
- requiresCorroboration=true：Y.M.Cinema、Variety、C21Media 保留为有归因的线索，不能自动通过高分成为精选。现阶段由编辑取得独立证据后走带审计的发布覆盖确认，没有宣称实现自动交叉核验。
- C 级使用严格领域关联规则，THR 只用 /business/feed/；RedShark、TV Tech、Digital Cinema Report 使用文档指定的正确 feed。CG Channel 改用 /category/news/ 的文章卡片，从列表提取标题、真实详情链接、日期与摘要，不再消费过期 FeedBurner。
- Newsshooter、Deadline、Variety、THR Business、IndieWire、Advanced Television 每 20 分钟采集，其余每 60 分钟。完整读取返回的 feed 条目，沿用项目每轮上限，未照搬“只取前 15 条”，以减少高频源漏稿。首次仍只回填 3 条、最多 3 个月。
- 保留数据库 URL 去重、正文修订、事件归组、历史回填隔离、单源故障退避和抓取日志；不引入另一套 seen_urls.json。正文仍优先直连 Readability，已有 Jina 回退受原预算管理。没有安装 Scrapling、挑战解算或新增第三方转换服务，不能将其描述为已实现。

同步工具 `scripts/sync-filmtech-sources.ts` 默认只读预览，`--apply` 显式通过后台管理函数新增/修改并记审计。与只插入新来源的 seed.ts 区分；现有文章、来源 ID、评分、授权、人工设置和历史游标保留。运行前暂停 worker，核对差异并备份，更新完成后恢复。此工具覆盖目录中的抓取配置、启用状态和周期，执行前须审阅目录与数据库的差异。

模型保持 gpt-5.6-sol / medium，预算仍为 10/100/300；此次未临时或永久提额。采集成功与模型分析完成分别验收，新增来源可能进入预算等待。证据在私有 `.data/verification/source-expansion/`，包括 feed-probe.json、alternatives.jsonl、reader-cloud.json 及后续上线验收记录。

---

## 2026-09-29 首批信源验证记录（历史快照）

核查日期：2026-09-29。按用户清单前 23 个固定站点的顺序核查，并补充 ASWF。Python 探测可解析 RSS 不代表项目采集器可用，下面以项目实际读取器结果为准。首轮每个启用来源最多回填 3 条、回溯 3 个月，公开全文与全文 RSS 均关闭。

| 来源 | RSS 探测 | 项目读取器 | 初始启用 | 说明 |
|---|---|---|---|---|
| [CineD](https://www.cined.com) | 可解析 | ok | 是 | 解析 20 条；首条时间 2026-09-29T12:46:43.000Z |
| [Newsshooter](https://www.newsshooter.com) | 可解析 | ok | 是 | 解析 5 条；首条时间 2026-09-29T13:52:14.000Z |
| [Film and Digital Times](https://www.fdtimes.com) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-08T18:40:44.000Z |
| [British Cinematographer](https://britishcinematographer.co.uk) | 可解析 | ok | 是 | 解析 100 条；首条时间 2026-09-28T07:28:37.000Z |
| [Cinematography World](https://www.cinematography.world) | 可解析 | failed | 否 | Error: HTTP 403 |
| [American Cinematographer](https://theasc.com) | 可解析 | failed | 否 | Error: HTTP 403；探测到的通用 feed 标题缺失且偏旧，不能替代摄影杂志入口 |
| [Definition](https://definitionmagazine.com) | 未定位 | 未运行 | 否 | 需定位网页或接口适配 |
| [befores & afters](https://beforesandafters.com) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-29T12:08:38.000Z |
| [fxguide](https://www.fxguide.com) | 可解析 | ok | 是 | 解析 15 条；首条时间 2026-09-09T16:54:21.000Z |
| [The Art of VFX](https://www.artofvfx.com) | 可解析 | ok | 是 | 解析 20 条；首条时间 2026-09-29T12:00:00.000Z |
| [VFX Voice](https://www.vfxvoice.com) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-22T16:00:02.000Z |
| [AWN](https://www.awn.com) | 可解析 | failed | 否 | Error: HTTP 403 |
| [CG Channel](https://www.cgchannel.com) | 可解析 | ok | 否 | FeedBurner 返回 2024 年旧条目，未导入；需寻找当前入口 |
| [postPerspective](https://postperspective.com) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-28T18:39:48.000Z |
| [ProVideo Coalition](https://www.provideocoalition.com) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-29T12:00:46.000Z |
| [CineMontage](https://cinemontage.org) | 可解析 | failed | 否 | Error: HTTP 403 |
| [Production Expert](https://www.production-expert.com) | 未定位 | 未运行 | 否 | 需定位网页或接口适配 |
| [The Broadcast Bridge](https://www.thebroadcastbridge.com) | 未定位 | 未运行 | 否 | 需定位网页或接口适配 |
| [RedShark News](https://www.redsharknews.com) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-29T10:13:31.000Z |
| [IBC](https://www.ibc.org) | 未定位 | 未运行 | 否 | 需定位网页或接口适配 |
| [Cinema Technology](https://www.cinema-technology.com) | 可解析 | ok | 是 | 解析 20 条；首条时间 2026-08-04T07:43:15.000Z |
| [Deadline](https://deadline.com) | 可解析 | ok | 否 | 解析 12 条；首条时间 2026-09-29T14:00:00.000Z；综合娱乐信息多，保留配置但默认停用 |
| [Blackmagic Design](https://www.blackmagicdesign.com) | 未定位 | 未运行 | 否 | 需定位网页或接口适配 |
| [Academy Software Foundation](https://www.aswf.io) | 可解析 | ok | 是 | 解析 10 条；首条时间 2026-09-15T19:00:00.000Z |

robots.txt 探测结果、RSS 原始响应和项目读取器样本保存在本地 `.data/source-audit/`，不公开转载正文。不绕过 403；四个在 Python 探测成功但项目读取失败的来源暂缓接入。未检查站点的所有文章，首条样本不代表整站内容质量或全文可用率。

本轮已写入 14 个通过项目读取器的来源配置，其中 13 个启用。低频来源保留原始时间，不把旧文章伪装成当日新闻。


## 2026-09-30 读者信息来源目录

新增公开页面 `/source-directory`，桌面主导航位于“收藏”下方，手机从“更多”进入。页面覆盖抓取目录中的 32 个来源，按摄影与现场制作、视效动画与创意、剪辑色彩与声音、媒体工程与影院、产业与制作研究五组展示。这里呈现本站关注的来源范围，包括暂时无法采集的 CineMontage，不将目录数量表述为正在正常采集的数量。卡片只包含网站标识、名称、内容特色、完整主站 URL 和外部访问按钮，不传递 A/B/C 用途、T1/T2 身份、评分、抓取策略或运行状态。

读者文案与主站地址维护于 `industry/source-directory.ts`，行业抓取配置继续由 `industry/sources.json` 管理。前端测试核对两份目录的来源 ID 一一对应，并检查主站 HTTPS 地址及每个本地标识文件存在；新增或删除订阅来源时必须同步维护公开目录。页面沿用站点字体、卡片、圆角、配色及内联线性 SVG 图标，手机单列、平板两列、桌面三至四列，保持名称和 URL 完整换行。

标识打包在 `apps/web/public/source-logos/`，32 个文件合计约 244 KiB，读者浏览时均由本站提供，不依赖第三方图标服务。29 个从各站公开声明的图标地址取得，Animation Magazine 从服务器读取其官方 favicon，Mix Online 提取主站页眉原有 SVG。British Cinematographer 的官方 RSS 指向 `cropped-BC2-32x32.png`，直取返回 403，本次在开发阶段从公开图标缓存取得 128 像素标识并保存本地；这不是读者页面的外部请求。以下记录取得地址，便于后续更换或追溯。

| 来源 | 标识取得地址 |
| --- | --- |
| CineD | https://www.cined.com/content/themes/cinemad/assets/images/favicons/apple-icon-180x180.png?v=1.2 |
| Newsshooter | https://www.newsshooter.com/wp-content/uploads/2015/11/cropped-newsshooter-sitelogo.png |
| Film and Digital Times | https://www.fdtimes.com/favicon.ico |
| British Cinematographer | https://www.google.com/s2/favicons?domain=britishcinematographer.co.uk&sz=128 |
| Y.M.Cinema | https://ymcinema.com/wp-content/uploads/2018/07/cropped-Company-Logo-180x180.png |
| The Art of VFX | https://www.artofvfx.com/wp-content/uploads/2026/01/cropped-ArtofVFX_512_favicon-180x180.jpg |
| befores & afters | https://i0.wp.com/beforesandafters.com/wp-content/uploads/2019/03/logo2.jpg?fit=180%2C167&ssl=1 |
| fxguide | https://www.fxguide.com/wp-content/uploads/2026/08/cropped-fx-icon-180x180.png |
| VFX Voice | https://vfxvoice.com/wp-content/uploads/2023/04/favicon.png |
| CG Channel | https://www.cgchannel.com/wp-content/themes/bebop3/favicon.ico |
| Animation Magazine | https://www.animationmagazine.net/favicon.ico |
| Motionographer | https://s35726.pcdn.co/wp-content/themes/motionographer6.3/library/images/apple-icon-touch.png |
| Cartoon Brew | https://www.cartoonbrew.com/wp-content/uploads/2018/03/cropped-cropped-favicon-3-180x180.png |
| Academy Software Foundation | https://www.aswf.io/wp-content/uploads/sites/60/2018/08/cropped-favicon-180x180.png |
| ProVideo Coalition | https://www.provideocoalition.com/wp-content/uploads/cropped-PVC_Logo_2020-180x180.jpg |
| postPerspective | https://postperspective.com/wp-content/uploads/2023/07/favicon.png |
| CineMontage | https://cinemontage.org/wp-content/uploads/2025/12/IA700Bug1.jpg |
| Production Expert | https://static1.squarespace.com/static/54d696e5e4b05ca7b54cff5c/t/56d20907e32140b8a0bcb361/1456605447577/Pro+Tools+Expert+iOS+.png |
| Mix Online | https://www.mixonline.com/ |
| RedShark News | https://www.redsharknews.com/hubfs/rs-favicon.png |
| TV Tech | https://cdn.mos.cms.futurecdn.net/flexiimages/2wcrzcjofb1613146505.png |
| Digital Cinema Report | https://www.digitalcinemareport.com/wp-content/uploads/2025/02/cropped-DCR-CinemaCon-2-180x180.png |
| Cinema Technology | https://static.wixstatic.com/media/8bda3b_b1668fa87d464d66bbc73f720edcbea1%7Emv2.png/v1/fill/w_180%2Ch_180%2Clg_1%2Cusm_0.66_1.00_0.01/8bda3b_b1668fa87d464d66bbc73f720edcbea1%7Emv2.png |
| Advanced Television | https://www.advanced-television.com/wp-content/uploads/2020/07/cropped-favicon-180x180.png |
| Filmmaker Magazine | https://filmmakermagazine.com/wp-content/themes/filmmaker/images/icons/apple-touch-icon-precomposed.png |
| TheWrap | https://www.thewrap.com/wp-content/uploads/2024/05/the_wrap_symbol_black_bkg.png?width=300&height=300&fit=bounds |
| Deadline | https://deadline.com/wp-content/themes/pmc-deadline-2019/assets/app/icons/apple-touch-icon.png |
| Variety | https://variety.com/wp-content/themes/pmc-variety-2020/assets/app/icons/apple-touch-icon.png |
| IndieWire | https://www.indiewire.com/wp-content/uploads/2018/04/cropped-iw_favicon.png?w=180 |
| Stephen Follows | https://substackcdn.com/image/fetch/$s_!tNI5!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F89b1a4ef-5b42-4f80-a9d0-1814209276c2%2Fapple-touch-icon-180x180.png |
| The Hollywood Reporter | https://www.hollywoodreporter.com/wp-content/uploads/2026/05/thr-site-icon.png?w=180 |
| C21Media | https://cdn.c21media.net/wp-content/uploads/2017/11/cropped-transc21medialogo-180x180.png |

本地验收：类型检查、生产构建及 18 项前端测试通过；浏览器实际渲染在 360/390 像素手机、768 像素平板及 1440 像素桌面深浅色下，32 个标识均加载，无横向溢出、标识与名称重叠，URL 显示与访问链接一致，桌面入口在收藏之后，手机“更多”正确选中。旧 `/sources` 继续作为后台来源管理书签跳转，公开目录使用独立 `/source-directory`，避免路由冲突。

腾讯云上线验收完成：公网页面返回 200，32 个来源 ID 与配置对应，32 个本地标识均返回非空图片，手机更多入口与网站地图均包含公开目录。公网浏览器在 360/390/768/1440/1728 像素下检查，无横向溢出或标识与标题重叠，图片延迟加载完成后全部可见，深浅色主题正常；30 项站点烟雾检查通过。后端在新建空 `_test` 库通过 148 项测试，前端 18 项测试通过。
