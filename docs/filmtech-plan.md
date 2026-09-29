# FilmTechNews 改造与续接记录

## 目标与已确认决定

将 AIHOT 改为影视技术日报，先本地运行，再部署到用户腾讯云。用户已确认站名“影视技术日报 / FilmTechNews”和十个栏目：摄影现场、视效动画、虚拟制作、剪辑色彩、声音、媒体工程、影院与沉浸、AI 影视、标准研究、产业动态。模型先尝试 ChatGPT OAuth；腾讯云 SSH 别名 tencent-cloud，域名前缀 filmtech。用户已确认上线文本并授权公开访问。

腾讯云模型调用实测返回地区不支持后，用户明确选择“先由本机生成，腾讯云展示”。当前不修改云端代理。后续如调整模型运行位置，应先验证实际调用，再迁移生成进程，防止两端同时消费队列。

## 当前状态（2026-09-29）

- GitHub fork：[HoraceLuBFA/FilmTechNews](https://github.com/HoraceLuBFA/FilmTechNews)，父仓库 KKKKhazix/AIHOT。本地目录即本仓库；origin 指向 fork，upstream 指向原仓库。初始基线为 f6c2952a9984d4840442558be114ac959b512b0c。
- 公开站点：<https://filmtech.lumenghe.com>；本地预览：<http://127.0.0.1:3310>。二者数据库独立，云端库是正式展示数据源。
- 行业包已完成站名、十分类、48 个主题、影视实体/术语、提示词、品牌图标和报头；关闭无关模型榜与 Codex 重置监控。使用规则与隐私页采用用户确认稿。
- 原清单 23 个固定站点与厂商集合已逐站评估，并补充 ASWF；14 个来源配置中 13 个启用、Deadline 关闭。详情见 filmtech-sources.md。不能把提取出 XML 等同于项目抓取器实际可用。
- 首批真实采集 38 篇，34 篇有可处理正文，4 篇正文未确认。前 6 篇完成模型全链路与发布，2 篇精选、4 篇全部动态；启动本机生成进程后又成功生成并写入云端新内容，后续数量动态增长。
- 影视筛选保留七类内容、五维权重、T1=60/T1_5=65/T2=76 和 understandFloor=50。未叠加原建议的站点乘数。15 个边界案例为规则说明，不是人工标注金标准。Backrooms 幕后样本得分 75 未达 T2=76，适合作后续人工校准讨论，不据此擅自降阈值。

## 运行结构与恢复入口

腾讯云 `/opt/filmtechnews` 用 Docker 运行 db/api/web，Nginx 对外 HTTPS。Web 与 DB 仅绑定服务器本机 3310/55441。实际 Nginx 程序为 `/usr/local/nginx/sbin/nginx`，配置根在 `/usr/local/nginx/conf`；系统 PATH 中另有未被 systemd 使用的 Nginx，不能混用验收。

生成进程在本机 LaunchAgent `com.horace.filmtechnews.worker`：SSH 隧道连接云端 DB，本机私有 Codex bridge 3322 调用既有 ChatGPT 登录，worker 负责采集、筛选、归组与日报。分析并发 1，llm 回执预算 10 次/分钟、100 次/小时、300 次/天；推送保持关闭。需要本机开机、登录且联网，睡眠或断网时云端仍展示已有内容。管理命令、文件与恢复步骤见 [腾讯云运行](filmtech-cloud.md)。

本地预览通过 `python3 scripts/local.py start|stop|status` 管理，DB 在 `.data/postgres-local`，55440，API 3311，web 3310，模型 bridge 3320。预览默认采集和模型阀门关闭，避免与云端生成重复消费配额。见 [本地运行](filmtech-local.md)。

敏感配置仅在忽略的 `.env`、`.data/tencent/`、`.data/cloud-worker/` 及服务器私有配置文件，不入 Git。后台登录说明在本机 `.data/tencent/access.txt`。最初数据库快照只用于空库引导，正式运行后不可重复覆盖。

## 验收与边界

类型检查、前端生产构建、16 项前端测试通过。后端 140 项与独立 Codex 适配器测试通过，适配器测试随后纳入 npm test，总计 141 项；使用隔离 *_test 库及本地桩，不访问真实模型。真实 OAuth 另外用实际文章验证，回执保留 token 用量，未虚构费用。最后整套测试曾因重复使用旧测试库导致日报边界用例互相影响，已改为新建 filmtech_acceptance_test 库重新迁移后验收；失败日志保留。

本地与公网 smoke 覆盖首页、全部动态、日报、主题、关于、正式条款、管理登录、RSS、公开 API、OpenAPI、图标及 MCP 初始化。公网最终全部通过；初次失败记录保留在 `.data/verification`，包括错误 Nginx 配置根、Docker 漏打包 reference 目录、重建切换期间的瞬时 502，均按具体原因修复后复测。

浏览器自动化接口多次超时，尚未完成真实浏览器逐页视觉验收。HTTP/SSR 和接口验收不等同于交互与版式验收，这一项明确保留。

云端 PostgreSQL Alpine 镜像在旧内核上初始化报写入 EPERM，改用同主版本 Debian bookworm 镜像后启动成功；没有关闭安全机制或修改其他项目。云端 Codex OAuth 返回 403 / unsupported_country_region_territory，云端模型服务已停止，当前架构按用户选择采用本机生成。

首次回填为历史资料，保留原始时间，不纳入今天新稿日报。定时生成日报窗口为北京时间前一天 08:00 到当天 08:00；启动时补出的空报表只是没有合格新稿，不是模型生成了完整新闻日报。需要实际新稿积累后再评估一期完整日报质量。

## 文件与后续工作

用户原始《抓取来源建议.md》未修改，SHA-256 为 `8d71d1fd2c7cbdb0b99c247f249070ef37ffe5eab98bc6f18378a25fa6eac365`，不随部署归档或提交到公共仓库。来源验证证据在 `.data/source-audit`，运行与测试日志在 `.data/verification`。

下一项最有价值的工作是由用户标注一组实际入选与落选样本，尤其是标准资料、技术幕后、固件更新和一般器材发布，再校准门槛。来源增补优先补全 SMPTE、ACES、DCI 与厂商公告的可稳定采集入口；未验证站点不应直接批量启用。这些属于后续改进，不影响当前站点运行。
