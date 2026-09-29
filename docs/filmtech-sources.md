# 首批信源验证记录

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
