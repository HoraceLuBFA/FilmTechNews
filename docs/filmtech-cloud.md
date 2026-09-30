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

## 2026-09-30 本地会话关闭前的服务器交接

现场检查发现首轮补跑已于北京时间 15:16 退出：最后完成计数为 379，下一批预筛回执 1573 的结果未知，八期日报尚未重建。退出处理已恢复原预算 10/100/300 和常规 worker，旧日志、首次数据库备份及退出码 1 均保留，原收尾检查按设计报失败。此状态替代上文首轮“进行中”的运行描述，不代表已完成全量任务。

该回执超过 30 分钟后，使用现有 `autoReleaseUnknownReceipts` 自动放行一次，保留实际请求记录，不伪造计费或成功结果。已启动独立腾讯云服务 `filmtech-full-backfill-resume-20260930.service`，复用 2,289 个来源 URL 身份及已完成文章，导入核对新增、修订均为 0，剩余 1,812 篇进入当前修订分析；模型仍为 gpt-5.6-sol / medium。续跑前另存 `database-before-resume.dump`，数据卷另存 `checkpoint-before-resume.tar`，不覆盖第一次备份；运行时暂时提高项目预算，退出时恢复原预算并启动常规 worker。

续跑与 `filmtech-full-backfill-resume-final-audit-20260930.service` 均由服务器 systemd 托管，无需本机 SSH 或当前聊天会话保持连接。本机关闭应用、休眠或断网不终止这两个单元；当前单元是 `/run/systemd/system` 下的临时服务，不承诺服务器重启后自动续跑。再次出现未知回执或分析失败时保留失败，不无限重试。成功退出后收尾检查才核对八期日报、回执、发布状态、原预算和 worker，最终网页验收仍需恢复会话后完成。

恢复时先读取本节，再通过 `ssh tencent-cloud` 检查以下状态；不得只凭旧聊天描述重复启动任务。私有目录为 `/opt/filmtechnews/.data/full-backfill-20260930/`，入口为 `run-resume-cloud.sh` 与 `run-resume-final-audit.sh`，日志为 `resume.log`、`resume-restore.log`、`resume-final-audit.log`，终态为 `resume-exit-code`、`final-cloud.json`、`final-verification.json`。运行过程中 `resume-exit-code` 不存在是正常现象；出现退出码 0 仍须检查收尾结果，不能等同公开网页验收通过。

```bash
ssh tencent-cloud 'systemctl show filmtech-full-backfill-resume-20260930.service filmtech-full-backfill-resume-final-audit-20260930.service --property=Id,ActiveState,MainPID,ExecMainStatus; tail -n 8 /opt/filmtechnews/.data/full-backfill-20260930/resume.log'
```

信息来源页面已独立完成上线和验收，访问 https://filmtech.lumenghe.com/source-directory 即可查看；历史新闻补跑的终态与页面功能交付分别检查。

## 2026-09-30 19:22 调用链与最新终态核对

宿主机 `filmtech-codex.service` 当前运行，桥接及客户端文件 SHA-256 与本地代码一致。`/usr/local/bin/codex` 解析为主机既有 `codex-clash` 入口，CLI 版本 0.153.4；worker 现场环境确认模型 gpt-5.6-sol、reasoning_effort medium、模型开关 true、文章分析并发 1。每个模型步骤单独启动 `codex exec --ignore-user-config --ephemeral --skip-git-repo-check --json -s read-only`，stdin 传递提示词与材料，工具关闭，输出事件流由应用解析并通过 schema 校验、回执和共享发布入口落库。登录凭据不读取、不复制。

历史续跑在北京时间 18:57 又于批量预筛阶段取得未知结果并退出，续跑最后完成计数 548；收尾检查按主任务失败停止，八期日报尚未重建。退出日志确认恢复原预算 10/100/300 并启动常规 worker。桥接捕获错误后统一返回未知结果，CLI 超时上限 110 秒，stderr 不记录；现有日志不能明确区分超时、CLI 非零退出或事件流不完整，不将未知结果直接解释为账户额度耗尽。恢复时先核对未知回执的现状及一次自动放行记录，再决定安全续跑；本节替代上文续跑仍运行的历史描述。

## 2026-09-30 全量收尾与日报、周报、月报更新

用户要求尽快完成剩余文章并更新三类报刊。修复 CLI 110 秒硬终止和后端默认 120 秒等待的配合问题：腾讯云桥接改为最多 300 秒，默认模型 HTTP 最少等待 330 秒，worker 排空等待随配置延长，Docker 停止宽限 390 秒。桥接仅输出失败类型、退出码和耗时，不输出 stderr、提示词、凭据或账户信息。模型固定 gpt-5.6-sol / medium，单篇详细摘要、双评分、来源门槛和回执机制保持不变。

新增显式维护入口 `scripts/complete-filmtech-history.ts`，默认只预览，`--apply` 才执行。来源公开归档再次核对至启动时的冻结时间，保留旧清单与新清单的并集合，不删除旧条目；CineMontage 已确认的 403 不重复绕过。预筛最多四批并行，每批最多八篇且按输入长度拆分，结果保存到私有检查点；逐篇分析、正文补齐、摘要和发布仍按现有流程串行。失败批次保留相同输入身份，未知回执等待现有 30 分钟自动放行一次，不无限重试；有供应商 429 时停止，不绕过实际账户限制。

周报、月报新增显式 historical/asOf 选项，默认调度行为保持兼容；本次历史汇编按来源时间纳入补录文章，已结束周刊与当周阶段汇总分别生成，月刊注明实际材料覆盖和截止时刻。完成所有文章及公开释放后，重建 9 月 23 日至冻结日期的日报、2026-W39 和 W40 周报、2026-09 月报，保留旧报刊修订。模型成功返回不等同完成，必须继续核对实际文章修订、公开发布、回执、报刊候选和读者页面。

服务器独立单元 `filmtech-full-finish-20260930.service` 和 `filmtech-full-finish-audit-20260930.service` 已启动，私有恢复目录 `.data/full-finish-20260930/` 保存 `cutoff`、`database-before.dump`、`maintenance.log`、`discovery.log`、`build.log`、`restore.log`、`exit-code`、`audit.log`、`final-cloud.json`；数据卷 `/data/history-completion-20260930/` 保存预算、旧报刊、导入清单、批次结果和 completed.json。上一阶段文件与备份保持原样。常规 worker 在本次维护期间停止，退出后恢复原预算和常规 worker；收尾检查只在主任务退出码 0 后执行，最终公开网页验收仍待完成。

上线前验证通过类型检查、149 项空库后端与桥接测试、18 项前端测试、前端构建及本地烟雾检查。测试中的历史周报/月报验证补录纳入、截止边界、撤稿排除和旧修订保留，未访问外部模型服务。

来源刷新并集合共 2,380 个 URL，冻结时刻为 2026-09-30T11:49:52Z（北京时间 19:49:52），通过共享入口新增 27、修订 19 篇。首次收尾入口使用四批并行预筛、单篇串行写作。实际观察写作耗时后，采用临时数据库屏障等待所有在途模型结果返回，现场确认桥接 active=0 且维护事务等待屏障，再停止该入口；收到的模型回答保存在回执，屏障释放，未造成新的未知结果。该人为切换的旧退出状态不能解释为最终任务失败或完成。

当前入口替换为 `filmtech-full-finish-parallel-20260930.service` 与 `filmtech-full-finish-parallel-audit-20260930.service`，日志 `parallel.log`、`parallel-build.log`、`parallel-restore.log`、`parallel-audit.log`，终态 `parallel-exit-code`、`final-cloud.json`。新增 `--resume` 复用来源冻结清单、旧预算快照和已保存批次，按文章当前修订跳过已完成结果；两篇文章并行，每篇评分仍独立进行，最多四个模型请求在途。新的退出处理在收到终止信号后等待当前付费请求返回，保存已有结果再退出。后续定时生成同一期周报/月报会保留其已修复的来源日期归档方式，防止自动更新再次丢掉历史补录；六项报刊边界测试通过。屏障最迟十分钟自行释放，私有 `barrier.log` 和本机安全停止核对记录保存实际现场证据。

为尽快清空剩余材料，处理池最终调整为四篇动态分配任务，最多八个模型请求在途；单篇的双评分仍顺序独立调用，摘要与模型档位不变。服务器现场观察 CLI 进程内存与可用内存后采用该有界上限，临时配置只写入 `filmtech-codex.service.d/history-completion.conf`；维护结束按内容校验移除它，恢复桥接默认上限四，常规 worker 的文章并发仍为一。再次切换前两个文章事务均等待屏障且桥接 active=0，收到的回执正常保留，未出现新未知请求。动态处理池避免一篇结束后空等另一篇，继续使用原批次检查点。

当前权威入口为 `filmtech-full-finish-pool-20260930.service`、`filmtech-full-finish-pool-audit-20260930.service`。恢复优先检查本组：`pool.log`、`pool-build.log`、`pool-restore.log`、`pool-audit.log`、`pool-exit-code` 和 `final-cloud.json`，仍位于 `.data/full-finish-20260930/`。之前 full-finish 与 parallel 单元是保留的人工切换记录，不重复启动；冻结范围、发现并集合、已取得素材和原备份不变。两次临时屏障均已释放并删除设置键，现场安全核对保存在私有 pool-safe-stop-check.json。


实际观察发现，32 篇波次末尾只剩一篇较慢材料时，其余位置会空等。维护入口改为四个持续消费批次的队列，预筛与单篇分析按同一消费者串行接续，每个消费者最多两个模型请求，总上限仍为八；检查点写入串行化，致命错误停止其他消费者领取新任务并等待在途调用结束。模型、双评分、详细摘要与筛选门槛均不改变。149 项空库后端及桥接回归测试、类型检查和镜像私有文件排除核验通过。切换前数据库屏障确认一个事务等待、桥接 active=0，再发终止信号和释放屏障，旧 pool 人为退出码 143、原预算和 worker 的恢复记录保留。

当前权威入口更新为 `filmtech-full-finish-continuous-20260930.service`、`filmtech-full-finish-continuous-audit-20260930.service`，操作脚本 `run-continuous-cloud.sh`、`run-continuous-audit.sh`，日志 `continuous.log`、`continuous-build.log`、`continuous-restore.log`、`continuous-audit.log`，终态 `continuous-exit-code`、`final-cloud.json`，仍在服务器 `.data/full-finish-20260930/`。来源冻结、备份和数据卷检查点不变；不要重启旧入口。主任务退出时恢复预算 10/100/300、桥接默认并发四与常规 worker，最终验收须确认这些实际生效状态及公开报刊。
