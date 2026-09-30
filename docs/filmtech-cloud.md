# 腾讯云独立采集与生成

用户已确认采用 Horace 个人实验项目的使用规则和隐私说明，并授权公开上线。域名为 `https://filmtech.lumenghe.com`，DNSPod 管理，Nginx 复用现有通配符证书。服务器仅通过 SSH 别名 `tencent-cloud` 引用，不在项目记录中保存服务器地址。

## 当前架构

腾讯云 `/opt/filmtechnews` 运行 Docker Compose 的 PostgreSQL、API、web 和 worker。worker 接管采集、正文提取、预筛、双次评分、详细中文摘要、结构抽取、事件归组与综述，以及日报、周报、月报和补任务。Web 主机端口绑定 `127.0.0.1:3310`，数据库绑定 `127.0.0.1:55441`，公网只有现有 Nginx 的 HTTP/HTTPS。生产更新不再依赖 Mac 开机、登录或 SSH 隧道。

宿主机 `filmtech-codex.service` 运行私有桥接，监听 Docker 网桥上的 3320 端口。它调用服务器自己的 `/usr/local/bin/codex`，由既有入口加载服务器管理员维护的代理配置，使用服务器自己的 Codex 登录；认证令牌没有复制到容器。本项目不维护或修改主机代理规则。模型固定为 `gpt-5.6-sol`，推理强度 `medium`；各能力当前均指向该默认模型。

采集同样沿用主机现有的 HTTP 代理。因代理只监听宿主机回环地址，worker 使用 host 网络，并将数据库和站内请求指向宿主机的本地端口；worker 自身没有 HTTP 监听器。`EGRESS_PROXY_URL` 指向现有回环代理，沿用项目的出站路由及 SSRF 检查，无需为代理新增公网或 Docker 网桥监听。API、web、数据库仍使用原 Compose 网络。验收曾发现 ASWF 直连返回 HTML、postPerspective 直连超时，两站经现有代理返回 RSS 后才进行该配置调整。

云端 `.env` 保持 `MODEL_CALLS_ENABLED=false` 和 `COLLECT_ENABLED=false`，仅 `deploy/tencent.compose.yml` 的 worker 覆盖为 true，分析并发为 1。API 与 web 不开启模型调用。私有 `.codex-bridge.env` 提供桥接令牌、监听地址与模型，令牌须与 `.env` 的 `LLM_API_KEY` 一致；两个文件权限均为 0600，不进入 Git。

```bash
cd /opt/filmtechnews
# 首次安装或更新本项目服务单元后执行；现有代理服务由主机管理员维护。
install -m 644 deploy/filmtech-codex.service /etc/systemd/system/filmtech-codex.service
systemctl daemon-reload
systemctl enable --now filmtech-codex
# 若服务单元有变更，先停止并等待 worker 排空，再 restart bridge，最后启动 worker。
docker compose -f docker-compose.yml -f deploy/tencent.compose.yml up -d api web worker
```

桥接依赖 Docker 网络与既有 mihomo 服务启动，systemd 设置失败自动重启；worker 使用 Docker 的 `unless-stopped` 重启策略。日报每天北京时间 08:00，周报每周一 10:00，月报每月 1 日 10:30，补报任务每小时第 15 分钟执行；来源每分钟检查到期任务，待处理文章每 5 分钟补扫。主机整体重启尚未作为本次验收操作，启动顺序和重启策略已检查；主机网络、代理、登录有效性和账户额度仍是运行依赖。

2026-09-29 迁移时，首次实际请求发现旧版 systemd 219 不支持原单元的 `ProtectSystem=strict` 和 `ReadWritePaths`，导致 Codex 状态目录只读。现使用兼容的 `ProtectSystem=full`、`ProtectHome=read-only` 和 `ReadWriteDirectories`，仅为 Codex 状态和项目私有数据目录保留写入例外。已在服务挂载环境内验证状态目录可写，并通过实际模型回执 183 验证；失败回执 175 保留为未知结果，不伪造成功记录。

## 管理与回退

```bash
cd /opt/filmtechnews
systemctl status filmtech-codex
journalctl -u filmtech-codex --since '30 minutes ago'
docker compose -f docker-compose.yml -f deploy/tencent.compose.yml ps
docker compose -f docker-compose.yml -f deploy/tencent.compose.yml logs --tail 80 worker
# 先等待队列任务和在途模型请求排空，再停止模型桥接。
docker compose -f docker-compose.yml -f deploy/tencent.compose.yml stop worker
systemctl stop filmtech-codex
```

Mac 原生产 LaunchAgent `com.horace.filmtechnews.worker` 已 bootout 并 disable，worker、3322 桥接和生产数据库 SSH 隧道均已退出。原 `scripts/cloud-worker.py`、LaunchAgent plist 与 `.data/cloud-worker/worker.env` 保留作回退，禁止与云端 worker 同时启用。仅在确认云端 worker 已停止后，才可在 Mac 执行：

```bash
launchctl enable gui/$(id -u)/com.horace.filmtechnews.worker
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.horace.filmtechnews.worker.plist
```

正常运行不执行上述回退命令。本机 `scripts/local.py` 仍只负责独立预览库，不参与生产新闻生成。迁移前服务单元与 Compose 文件备份在服务器 `.data/migration-20260929/`；迁移没有恢复数据库快照或搬运登录凭据。

## 配额与内容边界

来源目录已扩展为 OpenClaw 的 30 个来源及 2 个原有补充来源；CineMontage 因 403 暂停，CG Channel 改用当前网页列表。每站首次回填最多 3 条、最多 3 个月，Deadline 按 C 级严格相关性规则启用。模型分析并发 1；`llm` 回执预算每分钟 10 次、每小时 100 次、每天 300 次，以数据库 budgets 为准。实际消耗的是 ChatGPT 账户额度，回执记录 token 用量，费用未知。所有外部推送关闭。

历史回填保留原始时间，进入归档，不混入新一期日报。日报窗口为北京时间前一天 08:00 至当天 08:00，首次上线可能尚无完整一期；不能为了填满日报更改文章时间。首次 6 篇生成样本和全文抓取记录在本机 `.data/verification`、`.data/source-audit`，不入 Git。

## 部署与恢复注意

服务器旧内核上 `postgres:17-alpine` 初始化报文件写入 EPERM；改用 `postgres:17-bookworm` 后数据库成功启动。仅改本项目 Compose override，未改 Docker 安全策略或其他服务。数据库主版本仍为 17。

初次数据库引导使用本地 `pg_dump --no-owner --no-acl --exclude-schema=pgboss`，只允许导入空库。正式运行后禁止反复恢复该快照覆盖云端反馈、文章或设置。升级前备份数据库并停止、排空 worker，再构建指定 web 镜像并启动 api/web/worker。当前部署归档与数据库快照位于服务器项目 `.data`，不得置于公开 web 目录。

Nginx 专用配置为 `/usr/local/nginx/conf/vhost/filmtech.lumenghe.com.conf`，加载前必须 `/usr/local/nginx/sbin/nginx -t -c /usr/local/nginx/conf/nginx.conf`，然后 reload。证书沿用现有续期链路，需随主机正常维护。专用访问日志关闭，应用容器日志每份最大 10 MB，最多保留 3 份；无访客统计。后台密码在本机 `.data/tencent/access.txt` 与服务器 `.env`，不在聊天或 Git 输出。

服务器同时存在 RPM Nginx 和 /usr/local 安装版。实际 systemd nginx 使用后者；不得仅用 PATH 中 nginx 检查另一套配置。首次发布已发现并纠正此差异，错误落在未使用目录的本任务配置已移走备份。


## 2026-09-30 全源历史补跑进行中

用户授权本次临时提高项目模型预算，补齐 9 月 23 日至 9 月 30 日日报对应的来源信息。范围冻结为 2026-09-22T00:00:00Z 至 2026-09-30T03:05:00Z，前一天材料用于 23 日的固定 08:00 日报窗口。30 日 08:00 后发布的材料进入公开列表及下一期，不改变日报窗口或原始发布时间。公开全文仍关闭，模型仍为腾讯云自己的 Codex gpt-5.6-sol / medium，原入选门槛保持不变。

历史发现累计 2,288 条候选材料，32 个来源中 31 个完成公开列表的日期回溯，CineMontage 的 403 单独记录，不绕过限制。除常规 RSS 页码外，本次临时适配 CG Channel 新闻归档页、Production Expert RSS offset、C21Media 公开 REST 标题和摘要、RedShark 19 个导航分类 RSS。适配仅用于本次维护，不覆盖来源目录；列表回溯完成不代表每篇正文都可访问。

私有恢复入口为服务器 `.data/full-backfill-20260930/` 和共享数据卷 `/data/all-source-history-20260930/`，原始材料、文章 URL 清单、数据库备份、预算前值和日志不提交。维护由 `filmtech-full-backfill-20260930.service` 脱离 SSH 运行，容器 `filmtech-full-backfill-20260930`；操作前必须核对这两个句柄的实际状态，不能因观察超时重复启动。正常 worker 暂停并排空后再备份数据库；维护退出时尝试恢复原预算并重新启动 worker，最终仍须现场确认恢复成功。

`scripts/discover-filmtech-history.ts` 只发现和保存清单；`scripts/backfill-filmtech-all.ts` 默认只预览，明确 `--apply` 才导入并分析。所有导入通过共享材料入口保留身份和修订。每批最多 8 篇仅进行相关性预筛，逐篇继续正常双评分、详细摘要和发布，批量回执必须与文章 ID 和当前修订匹配，正文补齐后重新判断新修订。全部通过现有付费回执和临时预算，不绕开真实账户限额。历史日报保留旧修订，依据原始发布时间重建，并通过实际模型回执做严格同事件去重。若文章分析失败，任务记录文章 ID 后停止在最终日报重建之前，先查回执和日志解决失败，不伪称完成。

本地验证已通过 148 项后端与桥接测试、16 项前端测试、类型检查和前端构建；服务器新镜像构建和只读清单预览通过，数据库已备份。实际全量文章分析、最终日报重建、预算与 worker 恢复、公开页面验收尚在进行。

导入核对已将 C21Media 81 个相对 URL 规范为同域绝对地址，文章 ID 不变、尚未分析，修复前记录保存在私有数据卷。2,288 个清单 URL 均已在数据库找到对应身份，无导入缺项。

构建核对发现旧本地镜像包含项目私有的 `.codex-bridge.env` 与 `.preview.htpasswd`，已补齐 `.dockerignore` 的明确排除规则，后续构建必须实际核验这两个文件及 `.data` 均不在镜像中。本次没有向外部镜像仓库推送；该修正不更改服务器登录、代理或运行时凭据。CineMontage 的公开 REST 补查返回 202 HTML，未提供文章 JSON，来源缺口仍保留。

私有文件排除后的镜像构建已通过，实际容器文件检查确认两个私有配置和 `.data` 均不存在，公开路径检查均为 404。初次扫描开始时间早于冻结截止时间，因此在模型处理期间以 `--refresh` 再核对可访问来源的公开归档，已确认的 CineMontage 403 不原样重复请求。新增或发生修订的材料仍须通过共享材料入口处理，并完成对应修订的真实分析；不能只凭首轮的已处理计数宣布全量完成。

最终公开归档核对已结束：未发现额外的时间范围缺口，出现 Variety 一条标题更新和 Advanced Television 一条首次扫描未取得的材料。TheWrap 18 条及 Advanced Television 1 条旧条目从实时列表消失，已保留首次取得的材料并合并清单，共 2,289 个 URL 身份，未删除既有数据库内容；Variety 在产业来源处理前以共享入口更新修订，主任务的预筛每批重新加载当前修订；Advanced Television 新增材料独立补充处理，沿用同一模型、思考档位、回执和现有临时预算，不与主任务的文章 ID 重复。对应私有入口 `filmtech-confirmed-materials-20260930-r3` 和 `confirmed-materials-r3.log`，必须核对真实完成结果。

读者信息来源页已在 https://filmtech.lumenghe.com/source-directory 上线，桌面位于收藏下方，手机从更多进入。32 个来源卡片与 32 个本地标识均验收通过，五类粗分与主站链接公开，不公开后台来源评级或评分机制。api/web 使用已排除私有配置的新镜像，维护容器继续使用原运行镜像，正常 worker 保持暂停，避免发布界面时中断在途模型请求。页面改动已提交并推送 `76c43ed`，类型检查、前端构建、18 项前端测试、148 项空库后端测试与 30 项公网烟雾检查通过；公网浏览器实际检查 360/390/768/1440/1728 像素及深浅色。全源补跑尚未结束，最终日报、预算和 worker 的恢复仍需单独验收。

补充材料已真实完成：Variety 保持原文章 ID、修订更新为 2，尚待主任务按当前修订处理；Advanced Television 新建 1 篇，经 gpt-5.6-sol 实际预筛回执 1484 判为 block，未入选。补充单元退出码 0；前两次私有辅助入口在 SQL/模块载入阶段失败，未执行模型调用，改为项目目录中的明确文件入口并预览后完成，原失败日志保留。

自动收尾核对入口为 `filmtech-full-backfill-final-audit-20260930`，私有日志 `.data/full-backfill-20260930/final-audit.log`。它等待主任务退出且退出码为 0 后，修正 C21Media 历史公开摘要中不准确的“RSS”限定词，通过共享发布入口刷新；不改模型生成正文、不新增模型调用。随后保存 `final-cloud.json` 与 `final-verification.json`，核对八期日报、待处理材料、公开释放时间、真实模型回执、原预算和 worker 恢复，任一检查不通过即保留失败状态，不宣称全量完成。若 api 容器在收尾前被重新创建，需从同一私有目录恢复其 `/app/scripts/filmtech-finalize-private.mjs` 与 `/app/scripts/filmtech-final-audit-private.mjs` 后再执行收尾。最终公开网页与移动端日报验收仍是后续恢复步骤。
