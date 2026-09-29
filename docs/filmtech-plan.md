# FilmTechNews 改造与续接记录

## 目标与已确认决定

将 AIHOT 改为影视技术日报，先本地运行，再部署到用户腾讯云。用户已确认站名“影视技术日报 / FilmTechNews”和十个栏目：摄影现场、视效动画、虚拟制作、剪辑色彩、声音、媒体工程、影院与沉浸、AI 影视、标准研究、产业动态。模型先尝试 ChatGPT OAuth；腾讯云 SSH 别名 tencent-cloud，域名前缀 filmtech。用户已确认上线文本并授权公开访问。

早期因腾讯云模型调用返回地区不支持，曾按用户选择采用“本机生成、腾讯云展示”。2026-09-29 用户已修复主机 Codex 代理，并要求全部迁回服务器。当前已完成真实验证和单端切换，沿用主机既有代理配置。

## 默认模型（2026-09-29 用户指定）

影视日报生成任务默认使用 `gpt-5.6-sol`，推理强度 `high`。已替换初始试运行的 gpt-6-astra / low，适用于后续新任务；既有文章及调用回执保留原记录。适配器参数测试通过，并使用新配置完成一次实际结构化摘要调用，本地回执 32 返回成功；本地预览与现有云端 worker 均使用这一配置。

## 当前状态（2026-09-29）

- GitHub fork：[HoraceLuBFA/FilmTechNews](https://github.com/HoraceLuBFA/FilmTechNews)，父仓库 KKKKhazix/AIHOT。本地目录即本仓库；origin 指向 fork，upstream 指向原仓库。初始基线为 f6c2952a9984d4840442558be114ac959b512b0c。
- 公开站点：<https://filmtech.lumenghe.com>；本地预览：<http://127.0.0.1:3310>。二者数据库独立，云端库是正式展示数据源。
- 行业包已完成站名、十分类、48 个主题、影视实体/术语、提示词、品牌图标和报头；关闭无关模型榜与 Codex 重置监控。使用规则与隐私页采用用户确认稿。
- 原清单 23 个固定站点与厂商集合已逐站评估，并补充 ASWF；14 个来源配置中 13 个启用、Deadline 关闭。详情见 filmtech-sources.md。不能把提取出 XML 等同于项目抓取器实际可用。
- 首批真实采集 38 篇，34 篇有可处理正文，4 篇正文未确认。前 6 篇完成模型全链路与发布，2 篇精选、4 篇全部动态；启动本机生成进程后又成功生成并写入云端新内容，后续数量动态增长。
- 影视筛选保留七类内容、五维权重、T1=60/T1_5=65/T2=76 和 understandFloor=50。未叠加原建议的站点乘数。15 个边界案例为规则说明，不是人工标注金标准。Backrooms 幕后样本得分 75 未达 T2=76，适合作后续人工校准讨论，不据此擅自降阈值。

## 运行结构与恢复入口

腾讯云 `/opt/filmtechnews` 用 Docker 运行 db/api/web/worker，Nginx 对外 HTTPS。Web 与 DB 仅绑定服务器本机 3310/55441。实际 Nginx 程序为 `/usr/local/nginx/sbin/nginx`，配置根在 `/usr/local/nginx/conf`；系统 PATH 中另有未被 systemd 使用的 Nginx，不能混用验收。

生成进程现位于腾讯云 Docker worker，经宿主机私有 Codex bridge 调用服务器自己的登录与既有代理。采集、预筛、评分、详细摘要、结构抽取、归组、综述、日报、周报、月报和补任务均由云端执行。本机原生产 LaunchAgent `com.horace.filmtechnews.worker` 已退出并禁用，预览库独立保留。分析并发 1，llm 预算 10 次/分钟、100 次/小时、300 次/天，推送关闭。管理命令、文件、时间表与单端回退步骤见 [腾讯云运行](filmtech-cloud.md)。

本地预览通过 `python3 scripts/local.py start|stop|status` 管理，DB 在 `.data/postgres-local`，55440，API 3311，web 3310，模型 bridge 3320。预览默认采集和模型阀门关闭，避免与云端生成重复消费配额。见 [本地运行](filmtech-local.md)。

敏感配置仅在忽略的 `.env`、`.data/tencent/`、`.data/cloud-worker/` 及服务器私有配置文件，不入 Git。后台登录说明在本机 `.data/tencent/access.txt`。最初数据库快照只用于空库引导，正式运行后不可重复覆盖。

## 验收与边界

类型检查、前端生产构建、16 项前端测试通过。后端 140 项与独立 Codex 适配器测试通过，适配器测试随后纳入 npm test，总计 141 项；使用隔离 *_test 库及本地桩，不访问真实模型。真实 OAuth 另外用实际文章验证，回执保留 token 用量，未虚构费用。最后整套测试曾因重复使用旧测试库导致日报边界用例互相影响，已改为新建 filmtech_acceptance_test 库重新迁移后验收；失败日志保留。

本地与公网 smoke 覆盖首页、全部动态、日报、主题、关于、正式条款、管理登录、RSS、公开 API、OpenAPI、图标及 MCP 初始化。公网最终全部通过；初次失败记录保留在 `.data/verification`，包括错误 Nginx 配置根、Docker 漏打包 reference 目录、重建切换期间的瞬时 502，均按具体原因修复后复测。

浏览器自动化接口多次超时，尚未完成真实浏览器逐页视觉验收。HTTP/SSR 和接口验收不等同于交互与版式验收，这一项明确保留。

云端 PostgreSQL Alpine 镜像在旧内核上初始化报写入 EPERM，改用同主版本 Debian bookworm 镜像后启动成功；没有关闭安全机制或修改其他项目。早期云端 Codex OAuth 的地区错误已由用户修复；本次迁移又修正了旧版 systemd 的只读状态目录问题，现已通过真实调用。

首次回填为历史资料，保留原始时间，不纳入今天新稿日报。定时生成日报窗口为北京时间前一天 08:00 到当天 08:00；启动时补出的空报表只是没有合格新稿，不是模型生成了完整新闻日报。需要实际新稿积累后再评估一期完整日报质量。

## 文件与后续工作

用户原始《抓取来源建议.md》未修改，SHA-256 为 `8d71d1fd2c7cbdb0b99c247f249070ef37ffe5eab98bc6f18378a25fa6eac365`，不随部署归档或提交到公共仓库。来源验证证据在 `.data/source-audit`，运行与测试日志在 `.data/verification`。

下一项最有价值的工作是由用户标注一组实际入选与落选样本，尤其是标准资料、技术幕后、固件更新和一般器材发布，再校准门槛。来源增补优先补全 SMPTE、ACES、DCI 与厂商公告的可稳定采集入口；未验证站点不应直接批量启用。这些属于后续改进，不影响当前站点运行。


## 2026-09-29 详细摘要与文案清理

用户进一步要求文章摘要足够详细，并清理“AI 圈”“AI 日报”等上游语境。已修改两条文章写作路径、移除文章摘要 190 字压缩、保留自然段并扩大正文输入。同步清理热榜、主题页、报纸页眉和归档、空状态、反馈示例、页脚、分享图与 OpenAPI 的领域表述；AI 评分、翻译等功能说明及内部兼容键保留。

历史公开文章通过 `scripts/rewrite-summaries.ts` 单独刷新摘要，保留选择判断和人工覆盖。首次尝试碰到现有每小时预算上限，未提交摘要变更。随后按原预算自动等待，已完成本批全部 17 篇刷新，进程退出码为 0，LaunchAgent 常规 worker 已自动恢复。每分钟 10、每小时 100、每天 300 次预算均未调整。维护及证据入口：`.data/verification/summary-maintenance.py`、`summary-rewrite-retry.log`。该临时维护进程已结束，不需要再次运行。

已通过空库上的全套后端与桥接测试 143 项、前端测试 16 项、类型检查与生产构建；本地及公网 smoke 均为 30 项通过。10 个公开页面或接口的上游领域文案检查无残留。浏览器工具不可用，未完成真实浏览器视觉复核；HTTP/SSR 验收不冒充视觉验收。


本批 17 篇摘要最终为 278–1,898 字符、3–6 段。逐篇核对公开 API 与数据库的摘要一致，原标题、评分、精选状态、分类和标签保持不变。代表样本：Backrooms 1,744 字符、StEM3-VP 882 字符、Molus X100 评测 1,674 字符。4 篇代表文章的 SSR 摘要段落与数据库逐段比对，元描述保持简短。

对照来源抽查后，通过带审计的编辑覆盖修正 Backrooms 的 up-res 与 found footage 术语，区分 Molus X100 的作者约数与表格实测值，为播客介绍及杂志介绍注明材料范围。这 4 篇覆盖由 `codex:summary-review` 写入，不代表用户逐条审定；旧模型结果仍保留。随后将术语与节目介绍边界补入共享提示词，供后续文章使用。本次批量使用的提示词版本保存在 `.data/verification/summary-batch-version.json`，与这次补充后的未来生成版本有区别，不能用新版本号误判本批回执。

最终证据：`.data/verification/summary-cloud-accepted.json`、`summary-cloud-ssr.json`、`summary-cloud-copy-audit.json` 和 `summary-cloud-final-smoke.log`。这些是本次验收快照，后续新稿会继续增加。用户原始来源笔记未修改、未提交；运行数据、回执和正文均不入 Git。

## 2026-09-29 生产生成迁移到腾讯云

按用户要求将全部生产 worker 迁移到腾讯云，保持 `gpt-5.6-sol` / `high`、原摘要质量规则与每分钟 10、每小时 100、每天 300 次预算。先用回执 183 验证服务器自己的 Codex，再排空本机 worker 并禁用其 LaunchAgent，最后于北京时间 23:45 启动云端 worker；切换时未同时运行两个生产消费者。云端已完成文章预筛、结构抽取、两次评分和摘要全链路，回执 184–188 均 completed，分析记录 42 保存 410 字中文摘要。

修复的部署差异包括 systemd 219 不识别原来的写入目录例外，以及两个来源在云端直连出口下无法得到 RSS。服务单元已更新到 `deploy/filmtech-codex.service`，使用兼容设置并依赖既有代理服务；worker 通过 host 网络复用只监听回环地址的主机代理，数据库与站内 URL 均显式改为宿主本地端口。代理全局配置和 Codex 登录凭据均未复制或修改。

本次类型检查通过；首次后端测试因验证命令强制关闭模型阀门，连本地测试桩也被拒绝而失败。随后按测试自身的隔离库与本地桩机制，在另一空库重新迁移运行，143 项后端和桥接测试、16 项前端测试及生产构建全部通过。公网 smoke 全部通过。首次失败记录和最终成功记录分别保存在 `.data/verification/cloud-migration-checks.log`、`cloud-migration-checks-retry.log`；运行证据见 `cloud-migration-status.json`、`cloud-migration-probe.log` 和 `cloud-migration-public-smoke.log`。

恢复入口为 [腾讯云运行](filmtech-cloud.md)，其管理及回退命令必须遵守单端消费顺序。systemd 和 Docker 重启策略已启用并核实，未为验收重启整台多业务服务器；下一期定时日报的内容质量仍需在实际到点产出后评估。

最终采集复测：13 个启用来源全部 `ok`，包括原先直连失败的 ASWF 和 postPerspective，最新 `last_error` 均为空。切换后分析记录 42–44 已进入公开层，分别为 410、661、837 字摘要；其中 After Effects AI Assistant 文章详情 API 和 SSR 均为 HTTP 200，公开摘要长度与数据库一致。云端 worker 最终使用 host 网络，桥接健康返回 `gpt-5.6-sol`、`high`；systemd 服务已 active/enabled，容器 restart=unless-stopped，restart count=0，本机生产 LaunchAgent 保持 disabled。

本地与公网 smoke 各 30 项通过。验收时近一小时调用数达到原有 100 次上限，采集继续运行，剩余模型处理按既有预算退避机制续跑；本次未提高额度。证据快照另见 `cloud-migration-final-sources.json` 和 `cloud-migration-public-article.json`，均留在私有验证目录，不提交正文或运行数据库。
