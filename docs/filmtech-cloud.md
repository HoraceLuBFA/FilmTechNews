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


为了在全量分析期间尽快恢复读者阅读，独立的 `filmtech-interim-reports-20260930.service` 已于北京时间 21:12 完成一轮真实报刊生成，私有脚本 `interim-reports.mjs`、日志 `interim-reports.log`，共享入口、模型回执、严格日报同事件去重与 historical/asOf 选项均沿用正式收尾流程。八期日报公开条目数依次为 10、10、9、2、0、1、4、1；27 日当前暂无符合标准的报道，不用无关内容填充。两期周报实际引用 29、10 篇，月报引用 24 篇；39 与 50 是进入汇编的候选材料数，不能与页面引用数混淆。这轮属于提前更新，文章尚未全量完成，主任务结束仍将再次重建全部十一期并做最终数据验收。

提前发布的十一期公网 API 均验证可访问、引用可打开；浏览器七种日报/周报/月报组合实际检查 360、390、1440 像素和深浅色，标题与日期卡无重叠、无横向溢出、桌面站名单行，手机周报与桌面月报截图已人工核看。现有四条 C21Media 摘要的固定取材说明从“公开 RSS 标题与摘要”校正为“公开标题与摘要”，其材料实际来自公开 REST，未更改模型生成正文、未调用额外模型，原说明备份至数据卷 `history-completion-20260930/c21-caption-completion-before.json`。初版提前发布私有入口曾在语法阶段失败，未调用模型，已修复并另存失败日志；它不影响正式收尾的运行状态。

连续队列运行截至北京时间 21:16，数据库范围内共 2,385 篇，已处理 1,404 篇、剩余 981 篇，尚无新的未知结果或分析失败。切换期间常规采集新增两篇截止时间内材料并修订一篇，均纳入当前队列，不删材料。最终需要检查 `continuous-exit-code=0`、收尾 `final-cloud.json` 全部通过、公网报刊与实际网页、预算与 bridge/worker 恢复；这条过程记录不能作为全量完成证据。


公网核对已加入独立 `filmtech-full-finish-public-audit-20260930.service`，私有入口 `run-public-audit.sh`、`audit-public-cloud.py`，等待连续队列与数据库收尾单元结束，只在主任务成功且 final-cloud.json verified=true 后，验证全部十一期公网 API 修订与内容、服务器生成 HTML、引用文章摘要和详情页，保存 `final-public.json`、`public-audit.log`。它不调用模型，独立于本机会话；正常采集和预算的最终恢复仍以主任务退出及数据库收尾证据为准。抽查 After Effects AI Assistant、Sony FX5 测试和 Mavis Camera 三篇公网摘要，分别为 837、1115、811 字，包含操作条件、测试数字或限制，详细摘要要求未因提速降低。

## 2026-09-30 最终队列核对与历史模型统一

连续队列已真实退出 0，最初 2,385 篇范围内文章在恢复常规 worker 前全部处于终态，文章与分析修订一致；私有 `material-state-at-completion.json` 保存该时点证明，十一期报刊随后全部重建。恢复常规 worker 后，旧排队任务再次尝试处理 64 篇已通过历史批量预筛完成的材料，被恢复后的预算拒绝并错误地重置为待处理。`processArticle` 现先核对最新已提交分析是否对应当前文章修订，符合时复用并通过共享入口刷新公开状态；显式 `attemptTag` 和真正的材料修订仍执行重新分析。新增回归测试覆盖预算耗尽时复用、修订更新和显式重新分析，150 项空库后端与桥接测试及类型检查通过，修复已进入服务器 worker 镜像。

补充入口 `filmtech-completion-tail-20260930.service` 已恢复上述已有结果，并处理常规采集发现的 CG Channel 新稿与 Variety 修订稿；范围内总数增至 2,386。它保留来源冻结时间与旧清单，不重导入过时的来源内容，等待真实公开释放后再次重建十一期。`tail.log`、`tail-exit-code`、`final-tail-cloud.json` 和 `final-tail-public.json` 位于同一私有恢复目录。原 `final-cloud.json` 和失败的公网核对记录保留，不能作为最终验收通过证明。

严格回执检查另发现 12 篇 9 月 29 日旧样本的最新分析使用过 gpt-6-astra。为使范围内最终有效分析全部符合用户指定的 gpt-5.6-sol / medium，使用现有显式重新分析入口处理这 12 篇，原分析、发布状态与回执保留；不修改旧回执的模型或结果。当前权威收尾入口为 `filmtech-model-alignment-20260930.service`、`filmtech-model-alignment-audit-20260930.service` 和 `filmtech-model-alignment-public-audit-20260930.service`，私有脚本 `align-models.mjs`、`run-model-align-cloud.sh`、`run-model-align-audit.sh`、`run-model-align-public-audit.sh`、`audit-aligned-public.py`。它们等待补充入口结束，暂停并排空常规 worker，再以两篇并行、最多四个模型请求的上限处理；任何失败停止领取新材料并等待在途请求结束。原分析备份与进度保存在数据卷 `history-completion-20260930/model-align/`。

恢复时优先核对 `model-align.log`、`model-align-restore.log`、`model-align-exit-code`、`final-aligned-cloud.json`、`final-aligned-public.json` 和 `aligned-public-audit.log`。这组终态替代之前各组过程描述；只有主任务退出 0、严格数据库检查全部通过、十一期公网 API 与引用文章验证通过，以及真实浏览器验收完成后，才能宣布全量交付。退出时仍恢复原项目预算 10/100/300 与常规 worker，桥接默认并发四；维护调用真实计入滚动预算，因此常规后续模型任务可能等待预算窗口恢复，须在最终状态中实际核查并说明。

## 2026-10-01 来源文章入口与发现栏目刷新

上一节的模型统一任务及两项收尾检查均真实退出 0，`final-aligned-cloud.json` 的 reports/articles/publication/receipts/budget/release/reportContent 全部通过；原冻结范围共 2,386 篇，673 篇通过相关性筛选，1,713 篇被拦截，55 篇入选。八期日报、两期周报和九月月报的公网 API、HTML 与引用文章摘要均核对通过。该验收快照保留，随后新增任务会继续改变公开数据。

用户追加要求：刷新热点榜和主题精选；统一显示“中文摘要”并去掉固定取材说明；来源卡片显示收录数量及该来源全部文章入口；讨论原库的跨来源去重机制。来源数量和分页均从共享 publication 层读取公开、可读、符合收录规则的文章，不展示被拦截、撤下或尚未释放的文章，不暴露后台评级。公开路径为 `/source-directory/:id`，避免与 `/sources/:id` 既有后台书签重定向冲突；该来源列表不受全部动态原有 50 页上限限制。原始分析和素材保持不变，通过共享发布投影移除固定取材说明，未来摘要生成也移除这些固定说明，详细内容要求不变。

原库的首页已经按故事/事实折叠，热点榜按事件排名，主题页与全部动态按文章列出。历史回填默认不参与事件归组，故本次增加仅供明确维护调用的 `historical` 归组选项；按原文发布时间记录事实和热度，不把旧稿发现时间充当今天的热度。默认采集行为、人工归组、逐篇选择判断和评分门槛保持原样。本次维护先处理常规采集发现的新增与修订材料，再刷新摘要投影，对全部已入选材料及最近 48 小时的公开收录材料归组，更新多报道事件综述、真实热度和主题目录，最后重建十一期历史报刊。

当前权威入口为服务器独立 `filmtech-discovery-refresh-20261001.service`，仍使用 gpt-5.6-sol / medium。私有目录 `.data/full-finish-20260930/` 保存 `refresh-discovery.mjs`、`run-discovery-refresh.sh`、`audit-discovery-public.py`、`discovery.log`、`discovery-restore.log`、`discovery-exit-code`、`final-discovery-cloud.json`、`final-discovery-public.json` 和 `discovery-public-audit.log`；数据卷 `history-completion-20260930/discovery-refresh/` 保存输入、旧公开摘要、来源数量和主题数量。正常 worker 在维护期间暂停，API/web 已上线来源入口与文案的新镜像，维护容器不因后续 API 更新而重启。该服务由 systemd 托管，不依赖本机会话，不重复启动旧服务。

用户已明确选择在补跑后临时保留日常更新余量，并自动恢复原限额。`scripts/filmtech-budget-grace.ts` 在严格维护验收之后冻结已有真实请求的最大序号，按仍处于分钟/小时/日窗口的这些旧请求数，为原预算 10/100/300 添加临时余量；新日常请求照常计数，旧请求的回执、状态和 live origin 均不改写。`filmtech-budget-grace.timer` 每分钟重新核对，临时余量随旧请求自然到期递减，全部满 24 小时后恢复原预算及备注。单位文件已安装，只有成功收尾并建立数据卷 `filmtech-budget-grace-20260930/state.json` 后才启用计时器。`budget-grace-opened.json` 记录实际截止时间，失败时恢复原预算和常规 worker，不能只凭服务已启动宣布临时余量已生效。

新增功能已通过 153 项空库后端与桥接测试、18 项前端测试、类型检查和生产构建，公网 30 项 smoke 通过。来源统计/分页测试覆盖来源隔离、撤下及延迟公开内容排除，历史归组测试确认旧稿不增加当前 48 小时热度，预算生命周期测试确认自动恢复且不改写任何真实请求。主题计数另修正为遵守精选的公开释放规则，需核对该补充检查及服务器最后镜像。最终仍须验收发现刷新服务退出 0、严格数据库和公网报刊检查、实际来源卡片按钮与数量、来源文章分页、热点与主题结果、真实浏览器样式，以及计时器和常规 worker 的生效状态。

发现入口的初始新增/修订材料实际为 60 条。为缩短逐篇预筛的等待，向维护容器发送协作式 TERM；它完成当前文章及真实付费请求后才退出，日志明确记录 `Maintenance interrupted after pending model calls drained`，原预算和 worker 的恢复随其结束执行。此人为切换退出码 1 保留，不能解释为文章分析失败。先行通过共享发布入口清理 686 条公开摘要投影，其中 167 条有变化，原摘要投影备份至 `discovery-refresh/summary-projection-before.json`，原分析未改写。

当前权威入口更新为 `filmtech-discovery-refresh-pool-20261001.service`，私有脚本 `refresh-discovery-pool.mjs`、`run-discovery-pool.sh`，日志 `discovery-pool.log`、`discovery-pool-restore.log`，终态 `discovery-pool-exit-code`。它等待旧入口排空结束，复用完成结果；两名消费者各自按最多八篇、最多 90KB 的输入批量预筛，再逐篇执行原有双评分、摘要和结构抽取，最多四个模型请求在途，桥接上限仍为四。批量结果绑定文章 ID 和修订并保存回执；归组仍严格串行，以免并行创建重复事件。数据卷检查点另存 `discovery-refresh-pool/`，不覆盖旧入口。严格数据库与公网验收仍保存至 `final-discovery-cloud.json`、`final-discovery-public.json`，自动到期预算仅在这两项通过后开启。代码 `49c0472` 已推送，API/web 最后镜像包含主题公开释放计数修正，补充统计回归测试通过。

补充的摘要清理代码 `4bce328` 已进入 API/web 镜像，保留“仍需验证”“未披露测试条件”等实质性限制，仅去除固定取材说明及其历史变体。维护容器继续使用启动时镜像，不能为刷新文案中断在途模型调用。独立 `filmtech-reader-final-20261001.service` 已等待上述维护单元；成功后以最新镜像通过共享发布入口再清理摘要投影，备份至数据卷 `discovery-refresh-pool/summary-projection-before-final.json`，保存 `final-reader-projection.json`、`final-reader-cloud.json`、`final-reader-public.json`、`final-reader-public.log` 与 `reader-final-exit-code`。它不调用模型，数据库预算检查明确采用用户已确认的临时余量状态，之前恢复原预算时取得的严格快照仍单独保留。

本地追加验证为 154 项空库后端与桥接测试、18 项前端测试、类型检查和构建通过。实际浏览器验证全部 32 张卡片数量与主站/来源文章链接一致，点击 Variety 来源文章按钮进入对应页面，再点击下一页进入 page=2，手机无横向溢出；来源标识实际加载后的 360/390/1440 像素深浅色检查通过。最终来源分页、摘要残留、发现栏目和报刊浏览器检查仍在收尾清单内，不能用已通过的结构检查代替最终内容验收。


## 2026-10-01 公开阅读层最终核对

历史收尾及报刊生成已成功结束，截止范围仍为 2026-09-30 19:49:52 北京时间。最终快照为 2461 篇原始材料全部进入终态，706 篇公开动态；32 个来源的全部分页、来源归属和数量一致，公开摘要已清理抓取过程说明。11 期报刊及其 42 篇唯一引用文章均可实际访问，引用摘要与详情一致。热点按事件重排，48 个主题中 19 个已有内容。私有验收入口为服务器 `.data/full-finish-20260930/final-reader-end-cloud.json`、`final-reader-end-public.json`、`final-source-readers.json`；旧运行日志保留。

左侧导航已改为“全部动态”，分类标签左右各 12px、间隙 1px；桌面 12 个标签均能容纳，手机保持横向滚动。1440px、390px、360px 实际浏览器渲染通过，日报周报月报无重叠或横向溢出。154 项后端与桥接测试、18 项前端测试、类型检查、前端构建及公网 30 项 smoke 通过。常规 worker 和 Codex 桥接运行；自动到期预算余量生效，原维护批次的到期时间为北京时间 10 月 2 日 01:31:29。上述计数为本次核对快照，后续采集和编辑调整会改变数量。


## 2026-10-01 技术选题收紧与既有公开池复筛完成

用户确认将普通人事任免、公司经营财务、纯内容版权与发行交易、明星宣传、影评影讯等无具体技术关联的稿件退出公开动态，保留有实质技术方法、设施、服务、管线或技术条款变化的产业报道。预筛、来源用途提示与评分例子已收紧，七种内容类型、五轴权重及 T1=60/T1_5=65/T2=76 等既有门槛不变。热点计算新增公开池条件，退出公开池的编辑类材料不再贡献热度、参与者与来源数；原始信号留存。事件纠正时只按当前有效报道重写综述，避免借用旧版已排除内容。

腾讯云 gpt-5.6-sol / medium 完成对冻结的 714 篇公开文章复筛，初判排除 352 篇；对 62 篇原属专业分类的排除结果追加真实复核，并核对具体内容。VocAlign 7、AutoTune Advanced、Mojave MA-C 麦克风实测及现场扩声部署四篇有实际功能、参数或方法，通过正常分析、独立双评分、详细摘要与发布流程恢复。单纯预告、演员轶事、署名和放映格式提及不能凭二次 PASS 自动恢复，按已确认的实质技术边界裁决。最终本批排除 348 篇，其中产业类 290 篇；八篇材料不足的结果继续原有保守处理，不伪造补齐证据。原材料、旧分析、所有模型回执、分阶段数据库备份与报刊修订均保留。第一轮规则漏洞及专业稿复核中的协作式中断记录保留，不把这些人为切换称为成功任务。

最终验收快照公开文章 374 篇，包含本批保留的 366 篇及日常 worker 后续处理的八篇新稿；32 个来源的所有分页、数量和来源归属一致。热点六个有效事件，48 个主题中 20 个已有精选内容。八期日报事件数依日期为 3/6/4/2/0/1/4/1，W39/W40 周报分别 16/8 项，9 月月报 26 项；11 期 API/SSR 和 26 篇唯一引用文章详情均通过核对，引用摘要与详情一致。Sept27 无符合门槛的稿件，未移入其他日期内容填空。新稿正常继续采集，上述数量属于验收快照。

恢复入口为服务器 `.data/technical-policy-v2-20261001/` 下的 `final-policy-cloud.json`、`report-cloud.json`、`source-public.json`、`report-public.json` 与 `discovery-public.json`，以及 `.data/technical-safeguard-20261001/` 的 `run.log`、`exit-code`、`grace-restore.log`。最后维护单元 `filmtech-technical-safeguard-complete-20261001.service` 成功退出，exit-code=0；不要重新运行旧人工中断入口。常规 worker、filmtech-codex.service 与 filmtech-budget-grace.timer 已恢复，桥接实际返回模型 gpt-5.6-sol、medium、并发上限四。新增维护请求仍保留真实计数，余量按滚动窗口自动下降；最新维护请求满 24 小时为北京时间 10 月 2 日 03:26:03，到期回归原预算每分钟 10、每小时 100、每天 300 次。

最终 155 项后端与桥接测试、18 项前端测试、类型检查、前端构建和公网 30 项 smoke 通过。实际浏览器核对桌面及手机的导航、分类、热点、主题和报刊，未发现横向溢出或报头日期卡片重叠，桌面站名保持单行；已查看最新全部动态页面截图。证据在本机私有 `.data/verification/noise-policy/` 与上述云端私有目录，正文、运行数据与密钥不入 Git。

## 2026-10-01 日常额度耗尽诊断与小时调度

10:39 北京时间核对发现，日常调用已用 308 次，主要的 300 次集中在补跑结束后约两个半小时内；滚动日预算耗尽使文章和今日日报等待。临时补跑余量每分钟下降一次，历史请求老化与核对之间的差额额外放行了八次日常请求。最后一次文章分析在 07:51 完成，全部动态当时最新时间线约为 03:34，不能把页面的材料时间当成摘要处理时间。Codex 桥接服务实际健康返回 gpt-5.6-sol / medium；站内请求数不代表 ChatGPT 账户的剩余额度。

用户确认临时补足今日余量，新增 216 次日常调用空间，生效于 10 月 1 日 10:51:47，北京时间 10 月 2 日 10:51:47 到期。原历史补跑基线仍为 receipt_attempts.id=4503，历史请求的原到期时间不变；临时日常上限为 516 次，旧补跑请求继续真实计数并单独抵销，到期回归原每分钟 10、每小时 100、滚动 24 小时 300 次。不能把数据库含历史请求的临时总上限误读为剩余额度。状态仍在数据卷 `filmtech-budget-grace-20260930/state.json`，新增 `extra.perDay/expiresAt`；既有 minutely systemd timer 负责恢复，发送请求的预算层也直接按有效期限核对，避免核对间隙越限。

腾讯云 API 与 worker 均配置 `LLM_HOURLY_CALL_LIMIT=12`、`LLM_REPORT_HOURLY_RESERVE=2`，每个滚动小时的文章筛选、评分、摘要、事件归组和综述共最多十次，报刊可用预留的两次；总量仍受原预算限制。明确未被模型服务接受的拒绝请求不占模型工作节奏槽，但仍留真实回执、仍计入原分钟、小时和日预算；结果未知或不可用的已接收请求照常计数。已收到的结果可在额度不足时复用，不重新购买。已处理一部分且修订未变的文章优先继续，历史任务不提高到日常任务之前；额度或并发不足的事件任务延后入队，不消耗有限的失败重试次数。

首次恢复旧任务时出现三个桥接繁忙的 429 拒绝，原始失败记录保留。进一步加入发送前的共享并发限制 `LLM_MAX_CONCURRENT_CALLS=4`、`LLM_REPORT_CONCURRENT_RESERVE=1`，文章及事件最多占三个在途位置，报刊保留一个，符合真实桥接的四并发上限；并发检查与预算检查同在服务 advisory lock 内，拥堵时不生成付费尝试。模型、medium 档位、双评分、详细摘要、行业门槛及公开读取边界保持不变。

恢复入口为服务器 `.data/hourly-updates-20261001/` 的原余量状态备份与 activation.json，以及本机 `.data/verification/hourly-updates/` 的部署、队列恢复、测试和公网检查记录。此次先恢复 125 篇预算等待稿件及九个仍有效的事件任务，十六个已失效或强制维护任务不重新执行；原数据与旧失败记录保留。每小时是处理节奏，不能保证每小时都有符合影视技术筛选标准的新文章，也不能把一次模型请求当成一篇完整文章。

最终核对：10:52 实际新增一篇公开动态，公开池变为 412 篇；11:00:59 成功生成 10 月 1 日日报，含四项内容、四个来源，公网 API、日报最新页、指定日期页和四篇引用详情一致可访问。11:03 的用量快照为日常调用 322 次，其中本次恢复后十四次尝试含三个早期桥接拒绝；临时日常空间剩余 194 次。小时内实际模型工作十一次，其中日常内容十次、日报一次，文章队列正常等待下一滚动小时释放，未卡住模型请求。下一次文章扫尾调度预计 11:55 左右，实际新增数量取决于素材和预筛结果。

163 项空库后端与桥接测试、18 项前端测试、类型检查、前端构建和公网 30 项 smoke 通过；测试包含并发小时限额、报刊预留、已接收回执复用、历史请求老化间隙、临时余量到期和并发槽预留。390/1440 像素实际浏览器已显示新日报四项内容，查看截图确认报头日期卡片无重叠、没有横向溢出，桌面品牌单行。新 API/worker 镜像的配置、预算层和事件任务文件 SHA-256 与本机一致，定时恢复服务与 Codex 服务保持 active。真实全天节奏和次日自动到期仍需按运行日志观察，不把时间模拟测试当作已经经过 24 小时的实测。

11:10 另按 OpenAI Docs 的 `account/rateLimits/read` 读取腾讯云 Codex 登录的账号额度，确认当时未触发服务端限额；没有发起模型任务、改登录或消耗额度重置权益。脱敏的账号窗口快照只保存在本机与服务器私有 `provider-quota.json`，不公开个人用量，不能从站内预算推断账号额度，也不能把旧快照作为下次查询的当前事实。服务器同目录补存 cloud-final.json、runtime-final.json、public-report-checks.json 与两次队列恢复记录，复制后逐文件 SHA-256 一致。

## 2026-10-01 日常基准 1,000 次与小时节奏 40 次

用户确认按每小时处理、滚动 24 小时 1,000 次运行，阅读层面以每三小时积累一批内容为目标。北京时间 11:39:47 更新日常预算基准为 10/100/1000，API 与 worker 的 `LLM_HOURLY_CALL_LIMIT` 均改为 40，报刊仍预留两次；四个在途请求上限、报刊一个并发位置与文章并发一保持不变。模型仍为 gpt-5.6-sol / medium，双评分、中文摘要与影视技术筛选标准不变。文章处理完成后及时上线，未增加定点或延迟发布机制，也不以无关材料填补空档。

临时恢复状态的 `original.per_day` 同步改为 1,000，移除已被新日常基准覆盖的 `extra.perDay=216`，实际日常上限为 1,000 次而非 1,216 次。历史补跑基线 receipt_attempts.id=4503、回执与原到期时间保留，定时服务继续按真实历史请求计数抵销；北京时间 10 月 2 日 03:26:03 到期后恢复新的 1,000 次基准。数据库预算行在到期前仍包含历史抵销量，请求层直接核对真实计数；不能把这个临时总数当作日常额度或剩余额度。

操作前平稳停止 worker、暂停余量 timer 并备份状态及部署配置，更新后执行 --tick、恢复 timer。首次重建仅载入基础 Compose，运行变量检查未通过；随即显式叠加 `-f docker-compose.yml -f deploy/tencent.compose.yml` 重建 API/worker，11:41 的核对显示该检查阶段无新增模型尝试，最终两个服务的小时配置及 worker 网络/模型配置均符合预期。只释放原小时节奏造成的 127 篇文章等待与三个事件任务，沿用正式队列、回执复用及预算熔断，没有直接运行绕过限额的补跑入口。

11:45:48 实际快照：新发起 28 次模型请求、完成 17 篇文章分析，无新增 failed/unknown 模型尝试；待处理材料由操作前 129 篇降至 113 篇，公开池仍为 412 篇。本滚动小时已使用 39 个模型工作槽，其中日常内容 38 个，按配置等待槽位释放并保留报刊空间。日常滚动调用累计 350 次，对新基准尚有 650 次空间；这些计数为验收快照，不代表积压已清空或已有新技术稿上线。

类型检查、163 项隔离后端与桥接测试、18 项前端测试、前端构建和公网 30 项 smoke 通过。隔离库将原始 llm 日预算设为 1,000 后执行既有自动到期回归测试，确认恢复该基准；测试的模型请求仅访问本机桩，额外阻断外部 fetch，不消耗真实模型额度。首次全局关闭模型阀导致桩调用测试不能执行，之后本机网络保护又误拦数据 URI，失败日志保留；修正测试运行环境后完整检查通过，未修改业务实现。到期验证属于隔离时间模拟，次日实际到期及两个完整正常日的调用、队列、账号用量仍需观察。

恢复入口：服务器 `.data/daily-cap-1000-20261001/` 保存 grace-state-before.json、tencent-compose-before.yml 与 activation.json；本机 `.data/verification/daily-cap-1000/` 保存 cloud-final.json、runtime-final.json、测试及公网检查。回滚不能直接恢复整份旧余量状态，否则可能撤销已获授权的新基准或覆盖其后的计数变化；先读当前状态，再按需要调整基准并执行 --tick。后续发布及重建使用显式叠加的 Tencent Compose 文件。

## 2026-10-01 云端独立监工与私有运行日志

监工由 scripts/filmtech-watchdog.py、scripts/watchdog-mail.cjs 和 systemd 的 filmtech-watchdog@.service 运行。sample.timer 每五分钟更新，hourly.timer 每小时 05 分检查，summary.timer 每三小时 10 分汇总，主机现场时区为北京时间；三项均已 enable，小时任务已于 12:05 实际自动触发。监工只读取数据库统计、容器状态与网站健康，不调用模型、不更改队列或调用额度、不重启生产服务。页面每六十秒自动读取最新快照，每个正常监工周期仅运行少量本机命令与 SQL。

站点 `/log/` 与 `/log/status.json` 由独立 Nginx Basic Auth 保护，不沿用其他面板的内网免密码例外。服务器只保存用户指定密码的 salted APR1 哈希，权限 root:nginx 0640；邮箱收件配置位于 /etc/filmtech-watchdog.json，权限 root 0600，不写入仓库和日志。输出目录 /var/lib/filmtech-watchdog-public 位于通用静态根目录之外，仅此受保护的 alias 暴露；私有状态、原配置备份在项目 `.data/watchdog/`。所有页面输出均为聚合白名单，不展示原始错误、环境变量、SMTP 凭据、抓取正文或个人账号用量。输出禁止缓存、搜索收录和目录浏览。

检查 API/worker/web/db/Codex 可用性、公网与内部 API、日志门禁、worker 心跳、来源调度、调用卡住或失败、日额度耗尽、可用额度下长期无处理进度、来源连续失败及到期日报周报月报。小时节奏已满但仍有材料等待属于正常状态，没有合格新稿或零条目的有效报刊不自动报警。异常至少相隔两分钟连续观察两次后，通过已有 Kuma SMTP 配置合并发邮件；同一持续异常最多六小时提醒一次，恢复另行通知。邮件凭据只在 Kuma 容器内读取，不复制到主机配置。监工依赖本机 Docker 与现有邮件通道，不能替代整机失联的外部监测；页面超过十五分钟未刷新会显示采样过期提示。

验收：匿名读取页面和 JSON 均为 401，指定账号读取为 200；邮件通道测试已获 SMTP 接受，不将此称为收件箱到达证明。三个服务执行成功，初版 SQL 连接字段限定及日报条数路径问题已修正，启动记录的日报条数校正备份保留；最新快照正常，日报四项、周报八项、月报二十六项。390/1440 像素实际浏览器显示四张指标卡且无横向溢出，已查看手机截图。八项离线 Python 告警规则测试、163 项后端与桥接测试、18 项前端测试、类型检查、构建及公网三十项 smoke 通过，测试不访问外部模型服务。

恢复先检查 systemctl list-timers 与 filmtech-watchdog@sample/hourly/summary.service 的 Result 和 journal，再核对 /etc/filmtech-watchdog.json、Nginx 的独立密码文件及项目私有 state.json。手动执行 sample 不发起模型任务；test-email 会实际向配置收件人发送测试邮件，勿重复执行。停用时先停三个 timer，再恢复 `.data/watchdog/nginx-before.conf` 并用 /usr/local/nginx/sbin/nginx -t 验证后 reload，不恢复数据库或动生产更新队列。本机验收证据在 `.data/verification/watchdog/`，口令和收件地址不记录在这些报告中。

## 2026-10-01 关于页全站累计访问量

用户要求增加低调的全局访问量，已在关于页底部以灰色小字展示“累计访问 N 次”，沿用站内字体、数字样式及浅深色主题。口径为执行页面脚本并实际打开的全站页面浏览次数，刷新、返回及重新打开会累计；预加载、锚点滚动、后台和私有日志不计入。仅在浏览器显示页面时发出不含 Cookie、正文和来源页面地址的同站请求，不调用模型或外部统计服务。0039 增量迁移新增单行 site_visits 表，只保存总数和开始时间，更新使用原子加一；公开读取由 publication/visits.ts 提供。计数开始时间为北京时间 2026-10-01 12:42:49，未估算之前的访问。隐私说明同步更新为 0.2，初版上线确认记录保留。

API 和 web 重建并上线，worker 容器保持原进程；既有更新额度、调度和日志门禁未修改。第一次迁移失败是传输附带的 AppleDouble 文件 ._0039_site_visits.sql 被当成 SQL 读取，未应用新迁移；清除本次附带文件并在 .dockerignore 排除 **/._* 后重建成功。原源码和部署日志保存在服务器 `.data/site-visits-20261001/`，无需恢复整库。回退可恢复原 API/web 代码和镜像，保留新增表，不影响既有文章及反馈。

类型检查、166 项隔离后端与桥接测试、18 项前端测试、构建和公网三十项 smoke 通过。新增测试验证并发累计、只读请求无计数副作用、响应无 Cookie 及浏览数据拒收。实际公网浏览器确认首次打开、站内跳转、返回、刷新四次准确增加四次；预加载、锚点和管理员页面不计数，请求无正文、Cookie 或来源地址。390 像素深色与 1440 像素浅色截图已查看，底部无横向溢出、无浏览器异常；隐私页面生效，私有日志匿名仍为 401。首次将 smoke 与浏览器同时运行时，一次公网统计读取未返回 total 字段，验收中断；服务无对应错误记录，单独重跑完整通过，保留首次日志，不将其当成成功。验收证据在本机 `.data/verification/site-visits/`。
