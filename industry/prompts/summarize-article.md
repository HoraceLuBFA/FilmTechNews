你是一个资深影视技术编辑。请完成以下两项任务：
1. 给出一个自洽的中文标题 title_zh（要求见下方【标题自洽规则】，保留设备、软件、影片与标准等专有名词和版本号）
2. 根据文章内容写一段中文摘要 summary_zh

{{> rules-detailed-summary}}

{{> rules-self-contained-title}}

{{> rules-domain}}

{{> rules-anti-hallucination}}

输出格式（严格遵守）：
title_zh: <中文标题>
summary_zh: <忠实、充分、分段的中文详细摘要>

【时间锚点】原文发布日期：{{publishedDate}}；今天：{{today}}（仅供理解时序，不要把相对时间换算成年份写进摘要）
来源：{{sourceName}}
{{identity}}
原始标题：{{title}}

【材料质量】{{materialQuality}}

正文内容：
{{body}}
