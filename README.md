# 影视技术日报 / FilmTechNews

面向影视制作、影像技术及媒体工程的资讯聚合站，基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 改造。公开信源经过采集、相关性筛选、评分、中文摘要和归组，通过网站、RSS、API 与 MCP 提供阅读索引。原项目说明保存在 [README.upstream.md](README.upstream.md)。

线上地址：<https://filmtech.lumenghe.com>。当前由腾讯云独立采集、生成和展示，调用服务器自己的 Codex，使用 `gpt-5.6-sol`、`medium`。Mac 仅保留独立本地预览，生产更新不依赖本机开机。

## 内容范围

摄影现场、视效动画、虚拟制作、剪辑色彩、声音、媒体工程、影院与沉浸、AI 影视、标准研究、产业动态。现已同步 OpenClaw 的 30 个来源配置，并保留 ASWF、Cinema Technology 两个补充来源。按 A/B/C 来源用途分别处理技术正文、专业线索和产业背景，具体可用性及例外见来源记录。默认展示分段的中文摘要和原文链接，不公开抓取全文。摘要覆盖主要事实、技术方法、参数、结果和限制，长度随原文信息量调整；列表保留简短预览。

筛选重视技术变化、可复核参数、工作流、制作方法和标准更新，排除无技术增量的娱乐宣传与重复营销。沿用原项目七类内容、五维权重和分级门槛，后续应使用人工标注样本校准。首次回填保留原始日期，历史文章不作为当日新稿进入日报。

## 运行与配置

Node.js 24.11+、PostgreSQL 17、npm workspaces。行业配置集中在 `industry/`；API、worker、web 分离。密钥与运行数据分别位于忽略的 `.env`、`.data/`，不要提交 Git。

```bash
npm ci
# 按 docs/filmtech-local.md 准备 .env
npm run build -w @aihot/web
python3 scripts/local.py start
# http://127.0.0.1:3310
```

模型支持原有 OpenAI-compatible API，也提供实验性的私有 Codex CLI 桥接。ChatGPT OAuth 由官方 Codex CLI 管理，不读取或复制令牌。腾讯云现已通过既有代理入口完成真实调用验证，后台 worker 全部迁移到服务器；本机原生产生成进程已禁用。调用仍经过预算、回执和业务结果验证，访客请求不触发模型调用。

## 项目文档

- [当前状态与恢复入口](docs/filmtech-plan.md)
- [本地运行](docs/filmtech-local.md)与[腾讯云运行](docs/filmtech-cloud.md)
- [来源可行性表](docs/filmtech-sources.md)与[影视技术筛选标准](docs/filmtech-editorial-policy.md)
- [用户已确认的上线文本](docs/filmtech-launch-review.md)
- 原框架：[定制指南](docs/customize.md)、[架构](docs/architecture.md)、[评分校准](docs/selection.md)

## 验证

修改后执行 `npm run typecheck`、隔离数据库上的 `npm test`、前端构建与测试，以及运行站点的 `scripts/smoke.ts`。Codex 私有适配器另有 `node --test tests/codex-bridge.test.mjs`，测试使用本地桩，不消耗模型额度。详细命令与验收约束见 [AGENTS.md](AGENTS.md)。

本项目为 Horace 维护的个人实验项目，不代表任职机构立场。模型摘要可能有误，重要结论与参数请核对原始来源。
