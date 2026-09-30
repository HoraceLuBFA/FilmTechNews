/** Remove acquisition boilerplate while preserving source attribution and substantive caveats. */
export function cleanReaderSummary(summary: string): string {
  return summary
    .replace(/综合产业媒体线索，仅依据公开\s*(?:RSS\s*)?标题与摘要，未(?:读取|抓取)付费正文。[\s\n]*/g, "")
    .replace(/以下为该来源的报道，尚未经独立专业来源交叉印证。[\s\n]*/g, "")
    .replace(/(?:现有材料|材料|相关内容)(?:可能|疑似)?仅(?:包含|含|为|提供)(?:RSS标题与摘要|RSS 标题与摘要|来源摘要|公开标题与摘要)[^。]*。[\s\n]*/g, "")
    .replace(/(?:现有材料(?:可能|疑似)?(?:仅为来源摘要)?[，,])?(?:正文(?:完整性未确认|未完整(?:取得|获取))|付费正文(?:尚未|未)(?:取得|获取|读取))[^。]*。/g, "")
    .replace(/(?:由于)?来源仅提供标题和截断摘要[，,]/g, "")
    .replace(/(^|[。\n；;])\s*(?:现有材料|现有正文|现有信息|由于材料完整性未确认|以上仅|本文仅(?:取得|获取|读取))(?=[^。]*?(?:来源摘要|RSS|标题[和与及]|公开标题|完整性未确认|截断|正文未完整))[^。]*(?:。|$)/g, (_text, boundary: string) => boundary === "；" || boundary === ";" ? "。" : boundary)
    .replace(/(?:据)?([^。\n]{1,35}?)的?公开\s*RSS\s*摘要称[，,]?/g, "$1报道称，")
    .replace(/(?:据)?([^。\n]{1,35}?)的?\s*RSS\s*摘要称[，,]?/g, "$1报道称，")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
