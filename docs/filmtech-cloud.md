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

初始采集 13 个已验证来源，每站回填最多 3 条、最多 3 个月。Deadline 已配置但关闭。模型分析并发 1；`llm` 回执预算每分钟 10 次、每小时 100 次、每天 300 次，以数据库 budgets 为准。实际消耗的是 ChatGPT 账户额度，回执记录 token 用量，费用未知。所有外部推送关闭。

历史回填保留原始时间，进入归档，不混入新一期日报。日报窗口为北京时间前一天 08:00 至当天 08:00，首次上线可能尚无完整一期；不能为了填满日报更改文章时间。首次 6 篇生成样本和全文抓取记录在本机 `.data/verification`、`.data/source-audit`，不入 Git。

## 部署与恢复注意

服务器旧内核上 `postgres:17-alpine` 初始化报文件写入 EPERM；改用 `postgres:17-bookworm` 后数据库成功启动。仅改本项目 Compose override，未改 Docker 安全策略或其他服务。数据库主版本仍为 17。

初次数据库引导使用本地 `pg_dump --no-owner --no-acl --exclude-schema=pgboss`，只允许导入空库。正式运行后禁止反复恢复该快照覆盖云端反馈、文章或设置。升级前备份数据库并停止、排空 worker，再构建指定 web 镜像并启动 api/web/worker。当前部署归档与数据库快照位于服务器项目 `.data`，不得置于公开 web 目录。

Nginx 专用配置为 `/usr/local/nginx/conf/vhost/filmtech.lumenghe.com.conf`，加载前必须 `/usr/local/nginx/sbin/nginx -t -c /usr/local/nginx/conf/nginx.conf`，然后 reload。证书沿用现有续期链路，需随主机正常维护。专用访问日志关闭，应用容器日志每份最大 10 MB，最多保留 3 份；无访客统计。后台密码在本机 `.data/tencent/access.txt` 与服务器 `.env`，不在聊天或 Git 输出。

服务器同时存在 RPM Nginx 和 /usr/local 安装版。实际 systemd nginx 使用后者；不得仅用 PATH 中 nginx 检查另一套配置。首次发布已发现并纠正此差异，错误落在未使用目录的本任务配置已移走备份。
