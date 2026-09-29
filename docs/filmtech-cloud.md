# 腾讯云运行与本机生成

用户已确认采用 Horace 个人实验项目的使用规则和隐私说明，并授权公开上线。域名为 `https://filmtech.lumenghe.com`，DNSPod 管理，Nginx 复用现有通配符证书。服务器仅通过 SSH 别名 `tencent-cloud` 引用，不在项目记录中保存服务器地址。

## 当前架构

腾讯云 `/opt/filmtechnews` 运行 Docker Compose 的 PostgreSQL、API 和 web。Web 主机端口绑定 `127.0.0.1:3310`，数据库绑定 `127.0.0.1:55441`，公网只有现有 Nginx 的 HTTP/HTTPS。启动使用：

```bash
cd /opt/filmtechnews
docker compose -f docker-compose.yml -f deploy/tencent.compose.yml up -d api web
```

不要直接 `docker compose up -d` 启动全部服务：当前生成进程在本机，云端 worker 和 Codex bridge 保持停用。腾讯云实际调用 ChatGPT OAuth 返回 403 和 `unsupported_country_region_territory`，已有登录状态不能代表可调用。没有修改代理或绕过服务端限制。

本机 `scripts/cloud-worker.py` 维护 SSH 隧道、私有 Codex bridge（本机 3322）和 worker。worker 直接写云端数据库，避免周期性覆盖数据库或丢失读者反馈。隧道把本机 55441 转发到云端同号本机端口；模型输入为公开文章，网站访客请求不触发模型调用。认证材料放在忽略目录 `.data/cloud-worker/worker.env`，权限 0600。

LaunchAgent 名称为 `com.horace.filmtechnews.worker`，配置在 `~/Library/LaunchAgents/`。管理命令：

```bash
launchctl print gui/$(id -u)/com.horace.filmtechnews.worker
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.horace.filmtechnews.worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.horace.filmtechnews.worker.plist
```

生成进程依赖本机开机、登录、联网和有效 ChatGPT 登录。睡眠或断网期间网页仍由腾讯云提供已有内容，恢复后重新连接并按原项目机制补任务。此方案不能称为完全云端无人值守。

## 配额与内容边界

初始采集 13 个已验证来源，每站回填最多 3 条、最多 3 个月。Deadline 已配置但关闭。模型分析并发 1；`llm` 回执预算每分钟 10 次、每小时 100 次、每天 300 次，以数据库 budgets 为准。实际消耗的是 ChatGPT 账户额度，回执记录 token 用量，费用未知。所有外部推送关闭。

历史回填保留原始时间，进入归档，不混入新一期日报。日报窗口为北京时间前一天 08:00 至当天 08:00，首次上线可能尚无完整一期；不能为了填满日报更改文章时间。首次 6 篇生成样本和全文抓取记录在本机 `.data/verification`、`.data/source-audit`，不入 Git。

## 部署与恢复注意

服务器旧内核上 `postgres:17-alpine` 初始化报文件写入 EPERM；改用 `postgres:17-bookworm` 后数据库成功启动。仅改本项目 Compose override，未改 Docker 安全策略或其他服务。数据库主版本仍为 17。

初次数据库引导使用本地 `pg_dump --no-owner --no-acl --exclude-schema=pgboss`，只允许导入空库。正式运行后禁止反复恢复该快照覆盖云端反馈、文章或设置。升级前先备份数据库，再构建指定 web 镜像并启动 api/web。当前部署归档与数据库快照位于服务器项目 `.data`，不得置于公开 web 目录。

Nginx 专用配置为 `/usr/local/nginx/conf/vhost/filmtech.lumenghe.com.conf`，加载前必须 `/usr/local/nginx/sbin/nginx -t -c /usr/local/nginx/conf/nginx.conf`，然后 reload。证书沿用现有续期链路，需随主机正常维护。专用访问日志关闭，应用容器日志每份最大 10 MB，最多保留 3 份；无访客统计。后台密码在本机 `.data/tencent/access.txt` 与服务器 `.env`，不在聊天或 Git 输出。

服务器同时存在 RPM Nginx 和 /usr/local 安装版。实际 systemd nginx 使用后者；不得仅用 PATH 中 nginx 检查另一套配置。首次发布已发现并纠正此差异，错误落在未使用目录的本任务配置已移走备份。
