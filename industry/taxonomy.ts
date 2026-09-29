// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉模型怎么归类。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 */
export const CATEGORIES = [
  {
    "key": "camera-lighting",
    "label": "摄影现场",
    "section": "摄影与现场制作",
    "guide": "摄影机、镜头、胶片、灯光、监看、现场录音设备和运动控制，含实拍测试"
  },
  {
    "key": "vfx-animation",
    "label": "视效动画",
    "section": "视效与动画",
    "guide": "离线渲染、合成、三维资产、角色动画、VFX 制作与制作管线"
  },
  {
    "key": "virtual-production",
    "label": "虚拟制作",
    "section": "虚拟制作",
    "guide": "实时渲染、LED 影棚、摄影机跟踪、动作捕捉、预演与虚拟摄制"
  },
  {
    "key": "post-color",
    "label": "剪辑色彩",
    "section": "剪辑与色彩",
    "guide": "剪辑、调色、色彩管理、母版、影像修复与后期交接"
  },
  {
    "key": "sound",
    "label": "声音",
    "section": "声音制作",
    "guide": "声音设计、对白、拟音、录音、混音、沉浸声与声音交付"
  },
  {
    "key": "media-engineering",
    "label": "媒体工程",
    "section": "媒体基础设施",
    "guide": "编码、存储、网络、IP、云制作、资产管理、协作、质控与保存"
  },
  {
    "key": "cinema-xr",
    "label": "影院与沉浸",
    "section": "影院与沉浸式呈现",
    "guide": "放映、影院显示、影院服务器、VR/XR、沉浸式影像及终端呈现"
  },
  {
    "key": "ai-film",
    "label": "AI 影视",
    "section": "AI 影视工具",
    "guide": "图像、视频、音频、三维生成与处理，AI 制作工具、模型和工作流"
  },
  {
    "key": "standards-research",
    "label": "标准研究",
    "section": "标准与研究",
    "guide": "标准与规范正式更新、论文、实验研究和参考实现；具体产品或使用流程优先归对应制作环节"
  },
  {
    "key": "industry",
    "label": "产业动态",
    "section": "产业动态",
    "guide": "对影视制作有实际影响的公司、供应链、工会、设施、服务、政策与产业事件"
  }
] as const;

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = ["产品更新", "模型发布", "技术幕后", "论文/研究", "开源/仓库", "教程/实践", "专业观点", "评测/基准", "现象/趋势", "行业动态", "政策/监管", "标准/规范", "其他"] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = ["摄影", "镜头", "灯光", "现场录音", "监看", "VFX", "动画", "虚拟制作", "实时渲染", "动作捕捉", "剪辑", "调色", "色彩管理", "声音", "沉浸声", "编码", "存储", "云制作", "IP制作", "质控", "修复保存", "放映", "HDR", "VR/XR", "视频生成", "图像生成", "声音生成", "三维生成", "AI工作流", "开源生态", "Agent", "推理"] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = ["ARRI", "Sony", "Blackmagic Design", "RED", "Canon", "Panavision", "Cooke", "ZEISS", "Adobe", "Avid", "FilmLight", "Foundry", "SideFX", "Autodesk", "Maxon", "Blender", "Epic Games", "disguise", "Dolby", "IMAX", "Barco", "Christie", "ILM", "Framestore", "Weta FX", "DNEG", "SMPTE", "DCI", "ASWF", "Runway", "可灵", "OpenAI", "Anthropic", "DeepSeek", "DeepMind", "Google", "Meta", "Microsoft", "xAI", "Hugging Face", "GitHub", "arXiv"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "教程/玩法": "教程/实践",
  "技巧/最佳实践": "教程/实践",
  "合作/生态": "行业动态",
  "融资/收购": "行业动态",
  "公司动态": "行业动态",
  "合作": "行业动态",
  "融资": "行业动态",
  "收购": "行业动态",
  "政策": "政策/监管",
  "监管": "政策/监管",
  "法规": "政策/监管",
  "论文": "论文/研究",
  "研究": "论文/研究",
  "paper": "论文/研究",
  "papers": "论文/研究",
  "open-source": "开源/仓库",
  "开源": "开源/仓库",
  "仓库": "开源/仓库",
  "repo": "开源/仓库",
  "教程": "教程/实践",
  "实践": "教程/实践",
  "产品": "产品更新",
  "更新": "产品更新",
  "发布": "产品更新",
  "模型": "模型发布",
  "趋势": "现象/趋势",
  "观点": "专业观点",
  "大佬观点": "专业观点",
  "幕后": "技术幕后",
  "评测": "评测/基准",
  "标准": "标准/规范",
  "规范": "标准/规范",
  "视频": "视频生成",
  "语音": "声音生成",
  "非AI/通用工具": "产品更新",
  "行业": "行业动态",
  "动态": "行业动态"
};

/** 模型漏了分类标签时，按内容类型补一个。 */
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  model_release: "模型发布", product_launch: "产品更新", tool_or_prompt: "教程/实践", research_paper: "论文/研究",
  industry_event: "行业动态", opinion_analysis: "专业观点", tutorial_explainer: "教程/实践",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/** 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {
  "arri": {"name": "ARRI", "displayTag": "ARRI", "aliases": ["ARRI", "ALEXA", "阿莱"]},
  "sony": {"name": "Sony", "displayTag": "Sony", "aliases": ["Sony", "CineAlta", "VENICE", "索尼"]},
  "blackmagic": {"name": "Blackmagic Design", "displayTag": "Blackmagic Design", "aliases": ["Blackmagic Design", "Blackmagic", "DaVinci Resolve", "URSA"]},
  "red": {"name": "RED", "displayTag": "RED", "aliases": ["RED Digital Cinema", "RED V-RAPTOR", "RED KOMODO"]},
  "canon": {"name": "Canon", "displayTag": "Canon", "aliases": ["Canon", "佳能"]},
  "panavision": {"name": "Panavision", "displayTag": "Panavision", "aliases": ["Panavision"]},
  "cooke": {"name": "Cooke", "displayTag": "Cooke", "aliases": ["Cooke"]},
  "zeiss": {"name": "ZEISS", "displayTag": "ZEISS", "aliases": ["ZEISS", "蔡司"]},
  "adobe": {"name": "Adobe", "displayTag": "Adobe", "aliases": ["Adobe", "Premiere Pro", "After Effects"]},
  "avid": {"name": "Avid", "displayTag": "Avid", "aliases": ["Avid", "Pro Tools", "Media Composer"]},
  "filmlight": {"name": "FilmLight", "displayTag": "FilmLight", "aliases": ["FilmLight", "Baselight"]},
  "foundry": {"name": "Foundry", "displayTag": "Foundry", "aliases": ["Foundry", "Nuke", "Katana"]},
  "sidefx": {"name": "SideFX", "displayTag": "SideFX", "aliases": ["SideFX", "Houdini"]},
  "autodesk": {"name": "Autodesk", "displayTag": "Autodesk", "aliases": ["Autodesk", "Maya", "3ds Max"]},
  "maxon": {"name": "Maxon", "displayTag": "Maxon", "aliases": ["Maxon", "Cinema 4D", "Redshift"]},
  "blender": {"name": "Blender", "displayTag": "Blender", "aliases": ["Blender"]},
  "epic": {"name": "Epic Games", "displayTag": "Epic Games", "aliases": ["Epic Games", "Unreal Engine"]},
  "disguise": {"name": "disguise", "displayTag": "disguise", "aliases": ["disguise"]},
  "dolby": {"name": "Dolby", "displayTag": "Dolby", "aliases": ["Dolby", "杜比"]},
  "imax": {"name": "IMAX", "displayTag": "IMAX", "aliases": ["IMAX"]},
  "barco": {"name": "Barco", "displayTag": "Barco", "aliases": ["Barco", "巴可"]},
  "christie": {"name": "Christie", "displayTag": "Christie", "aliases": ["Christie Digital", "科视"]},
  "ilm": {"name": "ILM", "displayTag": "ILM", "aliases": ["Industrial Light & Magic", "ILM", "工业光魔"]},
  "framestore": {"name": "Framestore", "displayTag": "Framestore", "aliases": ["Framestore"]},
  "weta": {"name": "Weta FX", "displayTag": "Weta FX", "aliases": ["Weta FX", "Wētā FX"]},
  "dneg": {"name": "DNEG", "displayTag": "DNEG", "aliases": ["DNEG"]},
  "smpte": {"name": "SMPTE", "displayTag": "SMPTE", "aliases": ["SMPTE"]},
  "dci": {"name": "DCI", "displayTag": "DCI", "aliases": ["Digital Cinema Initiatives", "DCI"]},
  "aswf": {"name": "ASWF", "displayTag": "ASWF", "aliases": ["Academy Software Foundation", "ASWF"]},
  "runway": {"name": "Runway", "displayTag": "Runway", "aliases": ["Runway"]},
  "kling": {"name": "可灵", "displayTag": "可灵", "aliases": ["Kling", "可灵"]},

  openai: { name: "OpenAI", displayTag: "OpenAI", aliases: ["OpenAI", "ChatGPT", "Sora", "Codex", "GPT"] },
  anthropic: { name: "Anthropic", displayTag: "Anthropic", aliases: ["Anthropic", "Claude"] },
  google: { name: "Google", displayTag: "Google", aliases: ["Google", "DeepMind", "Gemini", "谷歌"] },
  deepseek: { name: "DeepSeek", displayTag: "DeepSeek", aliases: ["DeepSeek", "深度求索"] },
  qwen: { name: "千问 Qwen", displayTag: null, aliases: ["Qwen", "通义", "阿里"] },
  kimi: { name: "Kimi / 月之暗面", displayTag: null, aliases: ["Kimi", "月之暗面", "Moonshot"] },
  minimax: { name: "MiniMax", displayTag: null, aliases: ["MiniMax", "海螺"] },
  zhipu: { name: "智谱 GLM", displayTag: null, aliases: ["智谱", "GLM", "Z.ai"] },
  xai: { name: "xAI", displayTag: "xAI", aliases: ["xAI", "Grok"] },
  meta: { name: "Meta", displayTag: "Meta", aliases: ["Meta", "Llama"] },
  microsoft: { name: "Microsoft", displayTag: "Microsoft", aliases: ["Microsoft", "微软", "Copilot"] },
  nvidia: { name: "NVIDIA", displayTag: null, aliases: ["NVIDIA", "英伟达"] },
  "hugging-face": { name: "Hugging Face", displayTag: "Hugging Face", aliases: ["Hugging Face"] },
  cursor: { name: "Cursor", displayTag: null, aliases: ["Cursor", "Anysphere"] },
  openrouter: { name: "OpenRouter", displayTag: null, aliases: ["OpenRouter"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "arri", name: "ARRI", patterns: [new RegExp("\\bARRI\\b|\\bALEXA\\b|\u963f\u83b1", "i")] },
  { id: "sony", name: "Sony", patterns: [new RegExp("\\bSony\\b|\\bCineAlta\\b|\\bVENICE\\b|\u7d22\u5c3c", "i")] },
  { id: "blackmagic", name: "Blackmagic Design", patterns: [new RegExp("\\bBlackmagic\\ Design\\b|\\bBlackmagic\\b|\\bDaVinci\\ Resolve\\b|\\bURSA\\b", "i")] },
  { id: "red", name: "RED", patterns: [new RegExp("\\bRED\\ Digital\\ Cinema\\b|\\bRED\\ V\\-RAPTOR\\b|\\bRED\\ KOMODO\\b", "i")] },
  { id: "canon", name: "Canon", patterns: [new RegExp("\\bCanon\\b|\u4f73\u80fd", "i")] },
  { id: "panavision", name: "Panavision", patterns: [new RegExp("\\bPanavision\\b", "i")] },
  { id: "cooke", name: "Cooke", patterns: [new RegExp("\\bCooke\\b", "i")] },
  { id: "zeiss", name: "ZEISS", patterns: [new RegExp("\\bZEISS\\b|\u8521\u53f8", "i")] },
  { id: "adobe", name: "Adobe", patterns: [new RegExp("\\bAdobe\\b|\\bPremiere\\ Pro\\b|\\bAfter\\ Effects\\b", "i")] },
  { id: "avid", name: "Avid", patterns: [new RegExp("\\bAvid\\b|\\bPro\\ Tools\\b|\\bMedia\\ Composer\\b", "i")] },
  { id: "filmlight", name: "FilmLight", patterns: [new RegExp("\\bFilmLight\\b|\\bBaselight\\b", "i")] },
  { id: "foundry", name: "Foundry", patterns: [new RegExp("\\bFoundry\\b|\\bNuke\\b|\\bKatana\\b", "i")] },
  { id: "sidefx", name: "SideFX", patterns: [new RegExp("\\bSideFX\\b|\\bHoudini\\b", "i")] },
  { id: "autodesk", name: "Autodesk", patterns: [new RegExp("\\bAutodesk\\b|\\bMaya\\b|\\b3ds\\ Max\\b", "i")] },
  { id: "maxon", name: "Maxon", patterns: [new RegExp("\\bMaxon\\b|\\bCinema\\ 4D\\b|\\bRedshift\\b", "i")] },
  { id: "blender", name: "Blender", patterns: [new RegExp("\\bBlender\\b", "i")] },
  { id: "epic", name: "Epic Games", patterns: [new RegExp("\\bEpic\\ Games\\b|\\bUnreal\\ Engine\\b", "i")] },
  { id: "disguise", name: "disguise", patterns: [new RegExp("\\bdisguise\\b", "i")] },
  { id: "dolby", name: "Dolby", patterns: [new RegExp("\\bDolby\\b|\u675c\u6bd4", "i")] },
  { id: "imax", name: "IMAX", patterns: [new RegExp("\\bIMAX\\b", "i")] },
  { id: "barco", name: "Barco", patterns: [new RegExp("\\bBarco\\b|\u5df4\u53ef", "i")] },
  { id: "christie", name: "Christie", patterns: [new RegExp("\\bChristie\\ Digital\\b|\u79d1\u89c6", "i")] },
  { id: "ilm", name: "ILM", patterns: [new RegExp("\\bIndustrial\\ Light\\ \\&\\ Magic\\b|\\bILM\\b|\u5de5\u4e1a\u5149\u9b54", "i")] },
  { id: "framestore", name: "Framestore", patterns: [new RegExp("\\bFramestore\\b", "i")] },
  { id: "weta", name: "Weta FX", patterns: [new RegExp("\\bWeta\\ FX\\b|W\u0113t\u0101\\ FX", "i")] },
  { id: "dneg", name: "DNEG", patterns: [new RegExp("\\bDNEG\\b", "i")] },
  { id: "smpte", name: "SMPTE", patterns: [new RegExp("\\bSMPTE\\b", "i")] },
  { id: "dci", name: "DCI", patterns: [new RegExp("\\bDigital\\ Cinema\\ Initiatives\\b|\\bDCI\\b", "i")] },
  { id: "aswf", name: "ASWF", patterns: [new RegExp("\\bAcademy\\ Software\\ Foundation\\b|\\bASWF\\b", "i")] },
  { id: "runway", name: "Runway", patterns: [new RegExp("\\bRunway\\b", "i")] },
  { id: "kling", name: "可灵", patterns: [new RegExp("\\bKling\\b|\u53ef\u7075", "i")] },

  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt|\bgpt-?[o\d]|\bsora\b|\bcodex\b/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i, /\b(?:opus|sonnet|haiku)\s*\d+(?:[.\-]\d+)*\b/i, /\bfable\s*\d+(?:[.\-]\d+)*\b|\bmythos\b/i] },
  { id: "google", name: "Google / Gemini", patterns: [/google|deepmind|\bgemini\b|notebooklm|\bveo\s?\d|\bAlphaFold\b|\bAMIE\b/i] },
  { id: "deepseek", name: "DeepSeek", patterns: [/deepseek|深度求索/i] },
  { id: "xai", name: "xAI / Grok", patterns: [/\bxai\b|\bgrok\b/i] },
  { id: "meta", name: "Meta / Llama", patterns: [/\bMeta\b/, /\bmeta\s?ai\b|\bllama\b/i] },
  { id: "microsoft", name: "Microsoft / Copilot", patterns: [/microsoft|copilot|微软/i] },
  { id: "nvidia", name: "NVIDIA", patterns: [/nvidia|英伟达|\bnemotron\b|\bnemo\b|\bblackwell\b|\brubin(?:\s+ultra)?\b|\bcuda\b/i] },
  { id: "qwen", name: "千问 Qwen", patterns: [/\bqwen|通义|千问/i] },
  { id: "hugging-face", name: "Hugging Face", patterns: [/hugging\s?face/i] },
  { id: "cursor", name: "Cursor", patterns: [/\bCursor\b/] },
  { id: "kimi", name: "Kimi / 月之暗面", patterns: [/\bkimi\b|月之暗面|\bmoonshot\s?ai\b/i] },
  { id: "openrouter", name: "OpenRouter", patterns: [/openrouter/i] },
  { id: "minimax", name: "MiniMax", patterns: [/minimax/i] },
  { id: "zhipu", name: "智谱 GLM", patterns: [/智谱|\bglm-?[4-9]/i] },
  { id: "hunyuan", name: "腾讯混元", patterns: [/混元|hunyuan/i] },
  { id: "doubao", name: "字节豆包", patterns: [/豆包|doubao|字节跳动|bytedance/i] },
  { id: "mistral", name: "Mistral", patterns: [/mistral/i] },
  { id: "perplexity", name: "Perplexity", patterns: [/\bPerplexity\b/] },
  { id: "runway", name: "Runway", patterns: [/\brunway\b/i] },
  { id: "suno", name: "Suno", patterns: [/\bsuno\b/i] },
  { id: "midjourney", name: "Midjourney", patterns: [/midjourney/i] },
  { id: "stability-ai", name: "Stability AI", patterns: [/stability\s?ai/i] },
  { id: "elevenlabs", name: "ElevenLabs", patterns: [/eleven\s?labs/i] },
  { id: "vllm", name: "vLLM", patterns: [/\bvllm\b/i] },
  { id: "ollama", name: "Ollama", patterns: [/\bollama\b/i] },
  { id: "windsurf", name: "Windsurf", patterns: [/windsurf/i] },
  { id: "devin", name: "Devin", patterns: [/\bdevin\b/i] },
  { id: "manus", name: "Manus", patterns: [/\bmanus\b/i] },
  { id: "apple", name: "Apple AI", patterns: [/\bapple\s?(intelligence|silicon|ai)\b|苹果(智能|\s?AI)/i] },
  { id: "amazon", name: "Amazon / AWS", patterns: [/amazon|\baws\b|亚马逊/i] },
  { id: "baidu", name: "百度文心", patterns: [/百度|baidu|文心|\bernie\s?bot\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  {"entityId": "arri", "domains": ["arri.com"]},
  {"entityId": "sony", "domains": ["sony-cinematography.com", "pro.sony"]},
  {"entityId": "blackmagic", "domains": ["blackmagicdesign.com"]},
  {"entityId": "adobe", "domains": ["adobe.com"]},
  {"entityId": "avid", "domains": ["avid.com"]},
  {"entityId": "filmlight", "domains": ["filmlight.ltd.uk"]},
  {"entityId": "foundry", "domains": ["foundry.com"]},
  {"entityId": "sidefx", "domains": ["sidefx.com"]},
  {"entityId": "autodesk", "domains": ["autodesk.com"]},
  {"entityId": "maxon", "domains": ["maxon.net"]},
  {"entityId": "epic", "domains": ["unrealengine.com"]},
  {"entityId": "dolby", "domains": ["dolby.com"]},
  {"entityId": "smpte", "domains": ["smpte.org"]},
  {"entityId": "dci", "domains": ["dcimovies.com"]},
  {"entityId": "aswf", "domains": ["aswf.io"]},

  { entityId: "openai", domains: ["openai.com"] },
  { entityId: "anthropic", domains: ["anthropic.com", "claude.com"] },
  { entityId: "google", domains: ["deepmind.google", "ai.google", "blog.google"] },
  { entityId: "deepseek", domains: ["deepseek.com"] },
  { entityId: "xai", domains: ["x.ai"] },
  { entityId: "meta", domains: ["ai.meta.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "qwen", domains: ["qwen.ai"] },
  { entityId: "cursor", domains: ["cursor.com"] },
  { entityId: "openrouter", domains: ["openrouter.ai"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "meta", pattern: /@AIatMeta\b/i },
  { entityId: "zhipu", pattern: /\bZhipu(?:\s+AI\b|['’]s\b)/i },
];
