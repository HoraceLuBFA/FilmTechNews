# 本地运行与模型配置

站点：影视技术日报 / FilmTechNews。先安装 Node.js 24.11+、PostgreSQL 17 和 npm 依赖，执行 `npm ci`，再按 `.env.example` 创建本地 `.env`。初次配置生成随机管理员密码、会话密钥和图片代理密钥，文件权限设为 0600，禁止提交 Git。

当前预览使用 web 3310、API 3311、PostgreSQL 55440，均绑定本机。数据库为 `filmtech_local`，数据目录 `.data/postgres-local`。环境文件需设置 `SITE_URL=http://127.0.0.1:3310`、`API_BASE_URL=http://127.0.0.1:3311`、`DATABASE_URL=postgres://127.0.0.1:55440/filmtech_local`，API/WEB_HOST 为 127.0.0.1，API/WEB_PORT 分别为 3311/3310。

```bash
npm run build -w @aihot/web
python3 scripts/local.py start
python3 scripts/local.py status
python3 scripts/local.py stop
```

启动脚本负责项目自己的数据库、种子和 API/worker/web。关闭保留数据，不影响其他数据库服务。日志在 `.data/runtime`。后台位于 `/admin`，密码取本地 `.env` 的 `ADMIN_PASSWORD`。

生产采集与生成现由腾讯云独立运行，见 [腾讯云运行](filmtech-cloud.md)。本机旧生产 LaunchAgent 已退出并禁用；此处的本地预览使用独立数据库，不连接生产队列。

## ChatGPT OAuth 试验接入

使用官方 Codex CLI 管理的 ChatGPT 登录，运行 `codex login status` 确认登录。项目不读取或复制 OAuth 令牌，不将 ChatGPT 令牌当作 OpenAI API key。生产长期定时任务宜另行评估官方建议的 API key 接入，OAuth 当前作为用户本人控制的私有试验。参考 [官方认证说明](https://learn.chatgpt.com/docs/auth)、[非交互调用](https://learn.chatgpt.com/docs/non-interactive-mode)。

`CODEX_BRIDGE_TOKEN` 为本地自行生成的随机访问密码，至少 32 字符，与 `LLM_API_KEY` 相同。`LLM_BASE_URL=http://127.0.0.1:3320/v1`，`LLM_MODEL` 和 `CODEX_BRIDGE_MODEL` 均设为 `gpt-5.6-sol`，推理强度为 `medium`，`LLM_EXTRA_JSON={"reasoning_effort":"medium"}`。桥接程序用 `codex exec`，关闭工具、插件、用户项目指令和记忆，使用临时只读工作目录；只接受 system/user 纯文本消息。模型调用仍经过原项目回执、预算和结果验证。用量记录来自 CLI，费用未知，不标为免费或虚构 API 账单。

`python3 scripts/local.py start` 检测到 CODEX_BRIDGE_TOKEN 时同时运行桥接程序；使用普通 OpenAI-compatible API 时不需要该变量。桥接监听器不得代理到公开网站。配置或网络错误的非致命警告不等于调用失败，验收以 `turn.completed`、最终消息和业务 schema 为准；超时或未知结果进入 unknown 回执，30 分钟后可自动恢复一次。当前版本文章的模型请求第二次结果未知时，等待至少两小时，且同服务、同模型在该失败之后已有最近 30 分钟内完成的真实成功请求，才再自动恢复最后一次；第三次未知保留核查，成功阶段继续复用，所有实际请求仍计入预算。

默认保持 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false` 和推送阀门关闭。少量真实测试可仅为该命令设置 `MODEL_CALLS_ENABLED=true`，持续采集应在确认试运行后开启。首次回填文章保留原始发布时间，不改成今天新闻。
