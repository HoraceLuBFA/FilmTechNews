/** Reader-facing directory. Keep collection policies and editorial scores out of this catalogue. */
export const SOURCE_GROUPS = [
  {
    "id": "camera",
    "name": "摄影与现场制作",
    "description": "摄影机、镜头、灯光与片场实践"
  },
  {
    "id": "vfx",
    "name": "视效动画与创意",
    "description": "视觉特效、动画、动态设计与开源工具"
  },
  {
    "id": "post",
    "name": "剪辑色彩与声音",
    "description": "影视后期、调色、录音与混音"
  },
  {
    "id": "engineering",
    "name": "媒体工程与影院",
    "description": "广播、传输、显示、影院与放映"
  },
  {
    "id": "industry",
    "name": "产业与制作研究",
    "description": "创作者实践、内容产业与电影数据研究"
  }
] as const;

export const SOURCE_DIRECTORY = [
  {
    "id": "cined",
    "name": "CineD",
    "url": "https://www.cined.com/",
    "group": "camera",
    "description": "关注数字电影摄影机、镜头、灯光与制作工具，结合器材新闻、实拍评测和实验室测试，提供拍摄选型与工作流程参考。",
    "logo": "/source-logos/cined.png"
  },
  {
    "id": "newsshooter",
    "name": "Newsshooter",
    "url": "https://www.newsshooter.com/",
    "group": "camera",
    "description": "面向摄影师与现场制作人员，报道摄影机、镜头、灯光、录音及配件，以实际使用体验、器材评测和新品解析见长。",
    "logo": "/source-logos/newsshooter.png"
  },
  {
    "id": "fdtimes",
    "name": "Film and Digital Times",
    "url": "https://www.fdtimes.com/",
    "group": "camera",
    "description": "聚焦电影摄影与数字影像制作，通过摄影师访谈、片场案例和器材技术解读，连接镜头设计、摄影实践与制作流程。",
    "logo": "/source-logos/fdtimes.ico"
  },
  {
    "id": "british-cinematographer",
    "name": "British Cinematographer",
    "url": "https://britishcinematographer.co.uk/",
    "group": "camera",
    "description": "以电影摄影师及其创作为中心，提供长篇访谈、作品摄影解析和片场幕后，关注灯光、镜头语言与影像制作技术。",
    "logo": "/source-logos/british-cinematographer.png"
  },
  {
    "id": "ymcinema",
    "name": "Y.M.Cinema",
    "url": "https://ymcinema.com/",
    "group": "camera",
    "description": "围绕电影摄影机、大画幅影像、镜头与电影制作，汇集器材动态、摄影技术讨论及作品拍摄信息。",
    "logo": "/source-logos/ymcinema.png"
  },
  {
    "id": "artofvfx",
    "name": "The Art of VFX",
    "url": "https://www.artofvfx.com/",
    "group": "vfx",
    "description": "专注影视视觉特效，汇集视效总监与制作团队访谈、特效分解和项目幕后，帮助理解镜头实现及跨部门协作。",
    "logo": "/source-logos/artofvfx.jpg"
  },
  {
    "id": "beforesandafters",
    "name": "befores & afters",
    "url": "https://beforesandafters.com/",
    "group": "vfx",
    "description": "深入视觉特效、动画和实体特效的制作过程，以幕后采访、镜头分解与工艺细节呈现创意如何落地。",
    "logo": "/source-logos/beforesandafters.jpg"
  },
  {
    "id": "fxguide",
    "name": "fxguide",
    "url": "https://www.fxguide.com/",
    "group": "vfx",
    "description": "提供视觉特效、计算机图形与数字制作的深入报道，结合技术访谈和案例分析，关注渲染、合成及新兴制作方法。",
    "logo": "/source-logos/fxguide.png"
  },
  {
    "id": "vfxvoice",
    "name": "VFX Voice",
    "url": "https://vfxvoice.com/",
    "group": "vfx",
    "description": "由视觉特效协会出版，报道电影、剧集、动画与游戏等领域的视效制作，侧重从业者访谈、制作案例及行业趋势。",
    "logo": "/source-logos/vfxvoice.png"
  },
  {
    "id": "cgchannel",
    "name": "CG Channel",
    "url": "https://www.cgchannel.com/",
    "group": "vfx",
    "description": "面向 CG 艺术家，汇集三维、动画、视效及数字绘画软件新闻、教程和资源，便于跟踪工具更新与创作方法。",
    "logo": "/source-logos/cgchannel.ico"
  },
  {
    "id": "animation-magazine",
    "name": "Animation Magazine",
    "url": "https://www.animationmagazine.net/",
    "group": "vfx",
    "description": "覆盖动画电影、剧集及短片，提供创作者访谈、制作幕后、软件技术和行业消息，连接作品创作与动画产业。",
    "logo": "/source-logos/animation-magazine.ico"
  },
  {
    "id": "motionographer",
    "name": "Motionographer",
    "url": "https://motionographer.com/",
    "group": "vfx",
    "description": "关注动态设计、动画与视觉叙事，通过作品展示、创作者访谈和制作故事，观察设计理念与运动影像的表达方式。",
    "logo": "/source-logos/motionographer.png"
  },
  {
    "id": "cartoonbrew",
    "name": "Cartoon Brew",
    "url": "https://www.cartoonbrew.com/",
    "group": "vfx",
    "description": "关注动画艺术与产业，报道动画作品、创作者、制作公司和行业变化，兼顾制作实践与动画生态。",
    "logo": "/source-logos/cartoonbrew.png"
  },
  {
    "id": "aswf",
    "name": "Academy Software Foundation",
    "url": "https://www.aswf.io/",
    "group": "vfx",
    "description": "关注影视内容制作的开源软件生态，发布项目进展、技术协作及社区活动，覆盖色彩、图像、场景交换与制作基础工具。",
    "logo": "/source-logos/aswf.png"
  },
  {
    "id": "provideocoalition",
    "name": "ProVideo Coalition",
    "url": "https://www.provideocoalition.com/",
    "group": "post",
    "description": "由制作从业者分享摄影、剪辑、调色、音频与视效经验，提供软件教程、工具评测及可用于实际项目的工作流程。",
    "logo": "/source-logos/provideocoalition.jpg"
  },
  {
    "id": "postperspective",
    "name": "postPerspective",
    "url": "https://postperspective.com/",
    "group": "post",
    "description": "围绕影视后期制作，报道剪辑、调色、视效、声音及制作设施，以团队访谈、项目案例和工作流程介绍见长。",
    "logo": "/source-logos/postperspective.png"
  },
  {
    "id": "cinemontage",
    "name": "CineMontage",
    "url": "https://cinemontage.org/",
    "group": "post",
    "description": "电影剪辑师工会刊物，呈现剪辑师、声音编辑及其他后期从业者的创作经验、作品幕后与职业议题。",
    "logo": "/source-logos/cinemontage.jpg"
  },
  {
    "id": "production-expert",
    "name": "Production Expert",
    "url": "https://www.production-expert.com/",
    "group": "post",
    "description": "面向音乐制作与影视后期音频人员，分享 DAW、插件、录音、混音和工作室技术的教程、评测与实用经验。",
    "logo": "/source-logos/production-expert.png"
  },
  {
    "id": "mixonline",
    "name": "Mix Online",
    "url": "https://www.mixonline.com/",
    "group": "post",
    "description": "聚焦专业音频，覆盖录音、混音、影视声音、扩声与沉浸式音频，提供设备报道、工程实践和制作案例。",
    "logo": "/source-logos/mixonline.svg"
  },
  {
    "id": "redshark",
    "name": "RedShark News",
    "url": "https://www.redsharknews.com/",
    "group": "engineering",
    "description": "关注视频制作与影像技术，涵盖摄影、后期、显示和新兴工具，以产品解析及技术评论连接制作现场和媒体工程。",
    "logo": "/source-logos/redshark.png"
  },
  {
    "id": "tvtech",
    "name": "TV Tech",
    "url": "https://www.tvtechnology.com/",
    "group": "engineering",
    "description": "聚焦广播电视和媒体技术，报道 IP 制作、云工作流程、播出、传输及设施建设，提供面向工程与运营的行业观察。",
    "logo": "/source-logos/tvtech.png"
  },
  {
    "id": "digital-cinema-report",
    "name": "Digital Cinema Report",
    "url": "https://www.digitalcinemareport.com/",
    "group": "engineering",
    "description": "关注数字电影的制作、后期、发行和放映，报道影院系统、技术部署及行业合作，连接内容制作与影院端。",
    "logo": "/source-logos/digital-cinema-report.png"
  },
  {
    "id": "cinema-technology",
    "name": "Cinema Technology",
    "url": "https://www.cinema-technology.com/",
    "group": "engineering",
    "description": "围绕影院技术与放映实践，关注放映、声音、银幕及影院系统，通过技术文章、案例和行业交流介绍运营中的技术问题。",
    "logo": "/source-logos/cinema-technology.png"
  },
  {
    "id": "advanced-television",
    "name": "Advanced Television",
    "url": "https://advanced-television.com/",
    "group": "engineering",
    "description": "报道广播电视、流媒体与视频分发行业，关注平台、传输、市场及相关技术，补充媒体基础设施与商业变化的背景。",
    "logo": "/source-logos/advanced-television.png"
  },
  {
    "id": "filmmaker",
    "name": "Filmmaker Magazine",
    "url": "https://filmmakermagazine.com/",
    "group": "industry",
    "description": "关注独立电影与创作者实践，提供导演及制作团队访谈、摄影和后期经验、制作方法与发行观察。",
    "logo": "/source-logos/filmmaker.png"
  },
  {
    "id": "thewrap",
    "name": "TheWrap",
    "url": "https://www.thewrap.com/",
    "group": "industry",
    "description": "报道电影、电视、流媒体及娱乐商业，关注制作公司、平台与行业变化，为技术应用提供产业背景。",
    "logo": "/source-logos/thewrap.png"
  },
  {
    "id": "deadline",
    "name": "Deadline",
    "url": "https://deadline.com/",
    "group": "industry",
    "description": "覆盖电影、电视、流媒体及娱乐产业，持续报道项目、公司、平台和行业事件，便于观察制作需求及市场变化。",
    "logo": "/source-logos/deadline.png"
  },
  {
    "id": "variety",
    "name": "Variety",
    "url": "https://variety.com/",
    "group": "industry",
    "description": "覆盖影视、娱乐商业与媒体行业，结合新闻、评论及创作者访谈，提供制作、平台、市场与技术应用的广泛背景。",
    "logo": "/source-logos/variety.png"
  },
  {
    "id": "indiewire",
    "name": "IndieWire",
    "url": "https://www.indiewire.com/",
    "group": "industry",
    "description": "关注电影、剧集和独立创作，结合评论、创作者访谈与制作幕后，呈现摄影、剪辑、声音和视效等创作环节。",
    "logo": "/source-logos/indiewire.png"
  },
  {
    "id": "stephen-follows",
    "name": "Stephen Follows",
    "url": "https://stephenfollows.com/",
    "group": "industry",
    "description": "以数据分析研究电影产业，讨论制作、发行、票房、就业与观众行为，为行业判断提供研究方法和数据视角。",
    "logo": "/source-logos/stephen-follows.png"
  },
  {
    "id": "thr-business",
    "name": "The Hollywood Reporter",
    "url": "https://www.hollywoodreporter.com/",
    "group": "industry",
    "description": "覆盖影视娱乐行业，本网站主要关注其商业报道，包括公司、平台、制作业务及产业变动，补充技术趋势的商业语境。",
    "logo": "/source-logos/thr-business.png"
  },
  {
    "id": "c21media",
    "name": "C21Media",
    "url": "https://www.c21media.net/",
    "group": "industry",
    "description": "面向电视与内容产业，报道节目制作、发行、平台、国际合作及商业动态，帮助观察影视制作与内容市场的联系。",
    "logo": "/source-logos/c21media.png"
  }
] as const;
