console.log("[Schema] 开始加载配置定义...")

const configSchema = {
  categories: [
    {
      name: "图片功能",
      icon: "🖼️",
      configs: ["cool", "teatime", "EmojiThief", "summary", "pixiv", "r18", "jm", "EditImage", "tenor"],
    },
    {
      name: "AI渠道",
      icon: "🤖",
      configs: ["Channels"],
    },
    {
      name: "AI人设",
      icon: "🎭",
      configs: ["roles"],
    },
    {
      name: "AI设定",
      icon: "💬",
      configs: ["AI", "mimic", "ActiveChat"],
    },
    {
      name: "戳一戳",
      icon: "👉",
      configs: ["poke"],
    },
    {
      name: "其他",
      icon: "⚙️",
      configs: [
        "forwardMessage",
        "repeat",
        "recall",
        "60sNews",
        "bilicookie",
        "AutoCleanup",
        "webeditor",
        "groupnotice",
        "EmojiLike",
        "SoraVideo",
      ],
    },
  ],

  configNames: {
    "60sNews": "每日新闻",
    ActiveChat: "主动聊天",
    AI: "AI对话",
    AutoCleanup: "自动清理",
    bilicookie: "B站Cookie",
    Channels: "AI渠道",
    cool: "冷群",
    EditImage: "修图",
    EmojiThief: "表情包小偷",
    forwardMessage: "消息转发",
    menu: "菜单",
    jm: "禁漫下载",
    mimic: "伪人模式",
    pixiv: "P站功能",
    poke: "戳一戳",
    r18: "R18图片",
    recall: "防撤回",
    repeat: "复读",
    summary: "图片外显",
    teatime: "下午茶",
    tenor: "Tenor表情",
    webeditor: "配置面板",
    groupnotice: "进退群通知",
    EmojiLike: "表情回应",
    SoraVideo: "Sora视频",
    roles: "AI人设",
  },

  fields: {
    Groups: { label: "启用群", type: "groupSelect", help: "选择启用此功能的群聊" },
    groups: { label: "启用群", type: "groupSelect", help: "选择启用此功能的群聊" },
    name: { label: "名称", type: "text" },
    description: { label: "描述", type: "textarea" },
    title: { label: "标题", type: "text" },

    "roles.roles": {
      label: "人设列表",
      type: "array",
      itemType: "object",
      titleField: "name",
      schema: {
        name: { label: "人设名称", type: "text", required: true },
        prompt: { label: "设定内容", type: "textarea", required: true },
      },
    },

    "SoraVideo.access_token": { label: "Access Token", type: "textarea" },

    "summary.enable": { label: "启用", type: "boolean" },
    "poke.enable": { label: "戳一戳总开关", type: "boolean" },
    "poke.botname": {
      label: "机器人昵称",
      type: "text",
      help: "用于回复中的机用于回复中的bot名称，回复中的 _botname_ 会被替换为这里的名字",
    },
    "repeat.enable": { label: "复读", type: "boolean" },
    "recall.enable": { label: "防撤回", type: "boolean" },
    "recall.Groups": { label: "启用群", type: "groupSelect" },
    "ActiveChat.Groups": { label: "启用群", type: "groupSelect" },
    "r18.enable": { label: "启用群", type: "groupSelect", help: "影响所有图片功能" },

    "jm.baseDir": { label: "下载目录", type: "text", help: "jmcomic 漫画存放目录", path: "dir_rule.base_dir" },
    "jm.pdfDir": { label: "PDF存储目录", type: "text", help: "PDF 文件输出目录", path: "plugins.after_album.0.kwargs.pdf_dir" },

    "cool.Groups": { label: "启用群", type: "groupSelect" },
    "cool.randomIntervalMin": {
      label: "最小间隔 (分钟)",
      type: "number",
      help: "判断冷群的时间",
      min: 0,
    },
    "cool.randomIntervalMax": {
      label: "最大间隔 (分钟)",
      type: "number",
      help: "判断冷群的时间",
      min: 0,
    },
    randomIntervalMin: { label: "最小间隔 (分钟)", type: "number", help: "判断冷群的时间", min: 0 },
    randomIntervalMax: { label: "最大间隔 (分钟)", type: "number", help: "判断冷群的时间", min: 0 },

    "teatime.Groups": { label: "启用群", type: "groupSelect" },
    "teatime.cron": { label: "下午茶cron表达式", type: "text", help: "修改完重启生效" },
    cron: { label: "Cron表达式", type: "text", help: "定时任务的cron表达式" },

    "EmojiThief.Groups": { label: "启用群", type: "groupSelect" },
    "EmojiThief.rate": {
      label: "概率",
      type: "number",
      help: "发送表情包概率",
      min: 0,
      max: 1,
      step: 0.01,
    },
    rate: { label: "概率", type: "number", help: "0-1之间的小数", min: 0, max: 1, step: 0.01 },

    "summary.Summaries": { label: "外显文本列表", type: "array", itemType: "text" },
    Summaries: { label: "外显文本列表", type: "array", itemType: "text" },

    "pixiv.cookie": { label: "P站cookie", type: "text" },
    "pixiv.proxy": { label: "P站反代", type: "text" },
    "pixiv.excludeAI": { label: "排除AI绘图", type: "boolean" },
    "pixiv.minBookmarks": { label: "P站收藏数下限", type: "number", min: 0 },
    "pixiv.minBookmarkViewRatio": {
      label: "P站收藏浏览比下限",
      type: "number",
      help: "收藏数/浏览数的最小比例",
      min: 0,
      max: 1,
      step: 0.01,
    },
    "pixiv.defaultTags": { label: "P站默认搜索标签", type: "array", itemType: "text" },
    trigger: { label: "触发词", type: "text", required: true },
    cookie: { label: "Cookie", type: "textarea", help: "从浏览器获取的cookie" },
    proxy: { label: "反代地址", type: "text", help: "Pixiv图片反代地址" },
    excludeAI: { label: "排除AI作品", type: "boolean" },
    minBookmarks: { label: "最小收藏数", type: "number", min: 0 },
    minBookmarkViewRatio: {
      label: "收藏浏览比",
      type: "number",
      help: "收藏数/浏览数的最小比例",
      min: 0,
      max: 1,
      step: 0.01,
    },
    defaultTags: { label: "默认标签", type: "array", itemType: "text" },

    EditImage: {
      label: "修图API配置",
      type: "object",
      help: "配置用于修图的 Gemini API",
      schema: {
        model: { label: "模型名称", type: "text", required: true },
        api: { label: "API Key", type: "text", required: true },
        baseURL: {
          label: "反代地址",
          type: "text",
          required: false,
          help: "可选，Gemini API 反代地址，例如 https://your-proxy.com/",
        },
        vertexApi: {
          label: "Vertex API Key",
          type: "text",
          required: false,
          help: "默认渠道失败时的备用 Vertex API Key",
        },
        vertex: { label: "Vertex AI", type: "boolean", required: false },
        requirePermission: { label: "需要权限", type: "boolean", required: false },
        tasks: {
          label: "修图提示词",
          type: "array",
          itemType: "object",
          titleField: "trigger",
          schema: {
            trigger: { label: "触发词", type: "text", required: true },
            prompt: { label: "描述", type: "text", required: true },
          },
        },
      },
    },
    "EditImage.model": { label: "模型名称", type: "text", required: true },
    "EditImage.api": { label: "API Key", type: "text", required: true },
    "EditImage.vertexApi": {
      label: "Vertex API Key",
      type: "text",
      required: false,
      help: "失败时尝试使用 Vertex AI生成，为空则不尝试",
    },
    "EditImage.vertex": {
      label: "Vertex AI",
      type: "boolean",
      required: false,
      help: "开启后API Key只能填Vertex API Key",
    },
    "EditImage.requirePermission": { label: "需要权限", type: "boolean" },
    "EditImage.tasks": {
      label: "修图触发词",
      type: "array",
      itemType: "object",
      titleField: "trigger",
      schema: {
        trigger: { label: "触发词", type: "text", required: true },
        prompt: { label: "提示词", type: "text", required: true },
      },
    },

    "Channels.openai": {
      label: "OpenAI",
      type: "array",
      itemType: "object",
      help: "OpenAI API 类型的渠道",
      schema: {
        name: { label: "渠道名称", type: "text", required: true },
        baseURL: { label: "基本地址", type: "text", required: true },
        model: { label: "模型名称", type: "text", required: true },
        api: {
          label: "API Key",
          type: "textarea",
          help: "支持多个apikey轮询，一行一个",
          required: true,
        },
      },
    },
    "Channels.gemini": {
      label: "Gemini",
      type: "array",
      itemType: "object",
      help: "Gemini API 类型的渠道",
      schema: {
        name: { label: "渠道名称", type: "text", required: true },
        model: { label: "模型名称", type: "text", required: true },
        api: {
          label: "API Key",
          type: "textarea",
          help: "支持多个apikey轮询，一行一个",
          required: true,
        },
        vertex: { label: "Vertex AI", type: "boolean", required: false },
      },
    },
    "Channels.grok": {
      label: "Grok",
      type: "array",
      itemType: "object",
      help: "Grok API 类型的渠道",
      schema: {
        name: { label: "渠道名称", type: "text", required: true },
        model: { label: "模型名称", type: "text", required: true },
        sso: { label: "SSO Token", type: "textarea", required: false },
        cf_clearance: { label: "CF Clearance", type: "textarea", required: false },
        x_statsig_id: { label: "X Statsig ID", type: "textarea", required: false },
        temporary: { label: "临时会话", type: "boolean", required: false },
        dynamic_statsig: { label: "动态Statsig", type: "boolean", required: false },
      },
    },
    openai: {
      label: "OpenAI渠道",
      type: "array",
      itemType: "object",
      schema: {
        name: { label: "渠道名称", type: "text", required: true },
        baseURL: { label: "API地址", type: "text", required: true },
        model: { label: "模型名称", type: "text", required: true },
        api: {
          label: "API密钥",
          type: "textarea",
          help: "支持多个apikey轮询，一行一个",
          required: true,
        },
      },
    },
    gemini: {
      label: "Gemini渠道",
      type: "array",
      itemType: "object",
      schema: {
        name: { label: "渠道名称", type: "text", required: true },
        model: { label: "模型名称", type: "text", required: true },
        api: {
          label: "API密钥",
          type: "textarea",
          help: "支持多个apikey轮询，一行一个",
          required: true,
        },
        baseURL: {
          label: "反代地址",
          type: "text",
          required: false,
          help: "可选，Gemini API 反代地址，例如 https://your-proxy.com/",
        },
        vertex: { label: "Vertex AI", type: "boolean", required: false },
      },
    },

    "AI.profiles": {
      label: "角色配置",
      type: "array",
      itemType: "object",
      help: "配置不同的人格和其设定，可新增或删除角色",
      schema: {
        prefix: {
          label: "触发前缀",
          type: "text",
          required: true,
          help: "用于触发该角色的命令前缀",
        },
        name: {
          label: "角色名称",
          type: "roleSelect",
          required: true,
          help: "选择已有的AI人设",
        },
        Channel: {
          label: "渠道",
          type: "channelSelect",
          required: true,
          help: "使用的渠道名称，必须与上方渠道配置中的名称一致",
        },
        GroupContext: { label: "启用群聊上下文", type: "boolean" },
        History: { label: "启用历史记录", type: "boolean" },
        Tool: { label: "启用工具", type: "boolean" },
        atBot: { label: "@Bot 触发", type: "boolean", help: "有人@机器人时自动触发" },
        replyToBot: { label: "回复触发", type: "boolean", help: "回复机器人消息时自动触发" },
      },
    },
    "AI.groupContextLength": { label: "群聊上下文长度", type: "number", min: 1 },
    "AI.enableUserLock": {
      label: "是否启用用户锁",
      type: "boolean",
      help: "启用后，每个用户处理完当前消息前，不会处理该用户的后续消息，直到当前消息处理完毕",
    },
    "AI.requirePermission": {
      label: "需要权限",
      type: "boolean",
      help: "启用后，只有在权限列表中的用户才能触发",
    },
    "AI.toolschannel": {
      label: "工具渠道",
      type: "channelSelect",
      help: "用于AI工具的渠道，必须是gemini渠道",
    },
    "AI.appschannel": {
      label: "应用渠道",
      type: "channelSelect",
      help: "用于杂项功能(戳一戳，画像，早晚安，进退群等)的渠道",
    },
    "AI.defaultchannel": {
      label: "默认渠道",
      type: "channelSelect",
      help: "当指定渠道不可用时使用的备用渠道，建议设为gemini渠道",
    },
    profiles: {
      label: "角色配置",
      type: "array",
      itemType: "object",
      schema: {
        name: { label: "角色名称", type: "text", required: true },
        prefix: { label: "触发前缀", type: "text", required: true },
        Channel: { label: "使用渠道", type: "text", required: true },
        Prompt: { label: "预设提示词", type: "textarea", required: true },
        GroupContext: { label: "启用群聊上下文", type: "boolean" },
        History: { label: "启用历史记录", type: "boolean" },
        Tool: { label: "启用工具", type: "boolean" },
        atBot: { label: "@Bot 触发", type: "boolean", help: "有人@机器人时自动触发" },
        replyToBot: { label: "回复触发", type: "boolean", help: "回复机器人消息时自动触发" },
      },
    },
    groupContextLength: { label: "群聊上下文长度", type: "number", min: 1 },
    enableUserLock: { label: "启用用户锁", type: "boolean", help: "防止用户消息并发处理" },

    "mimic.Groups": { label: "启用群", type: "groupSelect" },
    "mimic.Channel": { label: "伪人渠道", type: "channelSelect" },
    "mimic.name": { label: "伪人预设", type: "roleSelect", help: "默认预设" },
    "mimic.alternateName": {
      label: "反差预设",
      type: "roleSelect",
      help: "伪人有概率触发的其他预设",
    },
    "mimic.triggerWords": { label: "伪人必定触发词", type: "array", itemType: "text" },
    "mimic.enableAtReply": {
      label: "伪人艾特回复",
      type: "boolean",
      help: "启用后,被艾特时会触发伪人回复",
    },
    "mimic.replyProbability": { label: "回复概率", type: "number", min: 0, max: 1, step: 0.01 },
    "mimic.alternatePromptProbability": {
      label: "反差回复概率",
      type: "number",
      min: 0,
      max: 1,
      step: 0.01,
    },
    "mimic.enableGroupLock": {
      label: "是否启用群聊锁",
      type: "boolean",
      help: "启用后,伪人模式的每个群处理完当前消息前,不会处理该群的后续消息,直到当前消息处理完毕",
    },
    "mimic.enableLevelLimit": {
      label: "启用等级限制",
      type: "boolean",
      help: "启用后，群等级小于等于10级的用户无法触发",
    },
    "mimic.splitMessage": {
      label: "启用消息分割",
      type: "boolean",
      help: "启用后,当伪人回复过长时会进行分割发送",
    },
    "mimic.enableTools": {
      label: "启用工具调用",
      type: "boolean",
      help: "启用后,伪人可以调用各种工具功能",
    },
    "mimic.recalltime": {
      label: "撤回时间(秒)",
      type: "number",
      min: 0,
      help: "反差预设触发时,消息撤回的延迟时间,单位为秒。设为0则不撤回",
    },
    "mimic.GroupConfigs": {
      label: "分群配置",
      type: "array",
      itemType: "object",
      titleField: "group",
      help: "为特定群组配置独立的伪人设定",
      schema: {
        group: { label: "群聊", type: "groupSelect", required: true },
        name: { label: "伪人预设", type: "roleSelect", help: "默认预设" },
        alternateName: {
          label: "反差预设",
          type: "roleSelect",
          help: "伪人有概率触发的其他预设",
        },
        triggerWords: { label: "伪人必定触发词", type: "textarea", help: "一行一个" },
        enableAtReply: {
          label: "伪人艾特回复",
          type: "boolean",
          help: "启用后,被艾特时会触发伪人回复",
        },
        replyProbability: { label: "回复概率", type: "number", min: 0, max: 1, step: 0.01 },
        alternatePromptProbability: {
          label: "反差回复概率",
          type: "number",
          min: 0,
          max: 1,
          step: 0.01,
        },
        enableGroupLock: {
          label: "是否启用群聊锁",
          type: "boolean",
          help: "启用后,伪人模式的每个群处理完当前消息前,不会处理该群的后续消息,直到当前消息处理完毕",
        },
        enableLevelLimit: {
          label: "启用等级限制",
          type: "boolean",
          help: "启用后，群等级小于等于10级的用户无法触发",
        },
        splitMessage: {
          label: "启用消息分割",
          type: "boolean",
          help: "启用后,当伪人回复过长时会进行分割发送",
        },
        enableTools: {
          label: "启用工具调用",
          type: "boolean",
          help: "启用后,伪人可以调用各种工具功能",
        },
        recalltime: {
          label: "撤回时间(秒)",
          type: "number",
          min: 0,
          help: "反差预设触发时,消息撤回的延迟时间,单位为秒。设为0则不撤回",
        },
        Channel: { label: "伪人渠道", type: "channelSelect" },
      },
    },
    Prompt: { label: "预设提示词", type: "textarea" },
    alternatePrompt: { label: "反差预设", type: "textarea" },
    triggerWords: { label: "必定触发词", type: "array", itemType: "text" },
    replyProbability: { label: "回复概率", type: "number", min: 0, max: 1, step: 0.01 },
    alternatePromptProbability: { label: "反差概率", type: "number", min: 0, max: 1, step: 0.01 },
    Channel: { label: "使用渠道", type: "text" },
    enableGroupLock: { label: "启用群聊锁", type: "boolean" },

    "menu.title": { label: "标题", type: "text" },
    "menu.description": { label: "描述", type: "text" },
    "menu.categories": {
      label: "菜单分类",
      type: "array",
      itemType: "object",
      help: "配置菜单中显示的指令分类",
      schema: {
        name: { label: "分类名称", type: "text", required: true },
        commands: {
          label: "指令列表",
          type: "array",
          itemType: "object",
          schema: {
            cmd: { label: "指令", type: "text", required: true },
            desc: { label: "描述", type: "text", required: true },
          },
        },
      },
    },
    categories: {
      label: "菜单分类",
      type: "array",
      itemType: "object",
      schema: {
        name: { label: "分类名称", type: "text", required: true },
        commands: {
          label: "命令列表",
          type: "array",
          itemType: "object",
          schema: {
            cmd: { label: "命令", type: "text", required: true },
            desc: { label: "说明", type: "text", required: true },
          },
        },
      },
    },

    "poke.masterReplies": { label: "戳主人回复", type: "textarea", help: "一行一个回复" },
    "poke.genericTextReplies": {
      label: "戳一戳通用回复",
      type: "textarea",
      help: "一行一个回复",
    },
    "poke.countRepliesGroup": {
      label: "群计数回复",
      type: "textarea",
      help: "一行一个回复。回复中的 _num_ 会被替换为实际数字",
    },
    "poke.countRepliesUser": {
      label: "个人计数回复",
      type: "textarea",
      help: "一行一个回复。回复中的 _num_ 会被替换为实际数字",
    },
    "poke.pokeBackTextReplies": { label: "戳回去回复", type: "textarea", help: "一行一个回复" },
    "poke.personas": {
      label: "戳一戳设定",
      type: "array",
      itemType: "roleSelect",
      help: "配置不同的人格和其设定",
    },
    masterReplies: { label: "戳主人回复", type: "textarea", help: "一行一个回复" },
    genericTextReplies: { label: "通用文本回复", type: "textarea", help: "一行一个回复" },
    countRepliesGroup: { label: "群计数回复", type: "textarea", help: "_num_会被替换为实际数字" },
    countRepliesUser: {
      label: "用户计数回复",
      type: "textarea",
      help: "_num_会被替换为实际数字",
    },
    pokeBackTextReplies: { label: "戳回去回复", type: "textarea", help: "一行一个回复" },

    personas: {
      label: "人设配置",
      type: "array",
      itemType: "object",
      schema: {
        name: { label: "角色名称", type: "text", required: true },
        Prompt: { label: "预设提示词", type: "textarea", required: true },
      },
    },

    "forwardMessage.forwardRules": {
      label: "转发规则",
      type: "array",
      itemType: "object",
      help: "配置消息转发规则，点击卡片展开编辑来源群号和目标群号",
      schema: {
        sourceGroupIds: {
          label: "来源群号",
          type: "groupSelect",
          required: true,
          help: "输入群号，可添加多个",
        },
        targetGroupIds: {
          label: "目标群号",
          type: "groupSelect",
          required: true,
          help: "输入群号，可添加多个",
        },
        enableImage: {
          label: "开启图片转发",
          type: "boolean",
          help: "是否开启图片转发",
        },
        enableVideo: {
          label: "开启视频转发",
          type: "boolean",
          help: "是否开启视频转发",
        },
        enableRecord: {
          label: "开启聊天记录转发",
          type: "boolean",
          help: "是否开启聊天记录转发",
        },
      },
    },
    forwardRules: {
      label: "转发规则",
      type: "array",
      itemType: "object",
      schema: {
        sourceGroupIds: { label: "来源群号", type: "groupSelect", required: true },
        targetGroupIds: { label: "目标群号", type: "groupSelect", required: true },
        enableImage: { label: "开启图片转发", type: "boolean" },
        enableVideo: { label: "开启视频转发", type: "boolean" },
        enableRecord: { label: "开启聊天记录转发", type: "boolean" },
      },
    },

    "60sNews.Groups": { label: "启用群", type: "groupSelect" },

    "bilicookie.cookie": { label: "B站cookie", type: "text" },

    "AutoCleanup.groups": {
      label: "启用群",
      type: "groupSelect",
      help: "每天0点自动清理：1.超过配置天数未发言的人 2.进群超24小时且群等级低于配置阈值的号",
    },
    "AutoCleanup.inactiveDays": {
      label: "未发言天数",
      type: "number",
      help: "超过该天数未发言会被自动清理",
      min: 1,
      step: 1,
    },
    "AutoCleanup.lowLevelThreshold": {
      label: "低等级阈值",
      type: "number",
      help: "进群超过24小时且群等级低于该值会被自动清理；例如 2 会清理 0/1 级",
      min: 1,
      step: 1,
    },

    "tenor.apiKey": {
      label: "Tenor API Key",
      type: "text",
      help: "从 https://developers.google.com/tenor/guides/quickstart 获取API密钥，用于戳一戳和表情包获取",
    },

    "webeditor.port": {
      label: "端口号",
      type: "number",
      help: "sakura服务端口.修改完需重启生效",
      min: 1024,
      max: 65535,
    },
    "webeditor.password": {
      label: "登录密码",
      type: "text",
      help: "sakura登录密码，修改后需重启生效",
    },

    "groupnotice.joinEnable": { label: "进群通知", type: "boolean" },
    "groupnotice.leaveEnable": { label: "退群通知", type: "boolean" },

    "SoraVideo.sora.access_token": {
      label: "OpenAI Access Token",
      type: "textarea",
      help: "从 ChatGPT 获取的 Access Token，用于 Sora 视频生成",
    },

    "EmojiLike.configs": {
      label: "群配置",
      type: "array",
      itemType: "object",
      titleField: "group",
      schema: {
        group: { label: "群聊", type: "groupSelect", required: true, help: "只能选择一个群聊" },
        replyAll: {
          label: "回应所有人",
          type: "boolean",
          help: "开启后回应群内所有人，关闭后仅回应特定用户",
        },
        default: {
          label: "默认表情ID",
          type: "text",
          help: "群内默认回应的表情ID，多个id用英文逗号隔开，如“11,22”,会随机选择",
        },
        users: {
          label: "特定用户配置",
          type: "textarea",
          help: "格式: QQ:表情ID，一行一个,多个id用英文逗号隔开,如“123456789:66,181”，会随机选择",
        },
      },
    },

    vertex: { label: "Vertex AI", type: "boolean" },
    port: { label: "端口", type: "number", min: 1024, max: 65535 },

    baseURL: { label: "API地址", type: "text" },
    api: { label: "API密钥", type: "textarea" },
    reg: { label: "触发词", type: "text" },
    prompt: { label: "提示词", type: "text" },
    cmd: { label: "命令", type: "text" },
    desc: { label: "说明", type: "text" },
    prefix: { label: "触发前缀", type: "text" },
    GroupContext: { label: "群聊上下文", type: "boolean" },
    History: { label: "历史记录", type: "boolean" },
    Tool: { label: "启用工具", type: "boolean" },
    commands: { label: "命令列表", type: "array", itemType: "object" },
    sourceGroupIds: { label: "来源群", type: "groupSelect" },
    targetGroupIds: { label: "目标群", type: "groupSelect" },
  },
}

function getFieldSchema(key) {
  if (configSchema.fields[key]) {
    return configSchema.fields[key]
  }

  return { label: key, type: "text" }
}

function getConfigName(configKey) {
  return configSchema.configNames[configKey] || configKey
}

function getCategories() {
  return configSchema.categories
}

if (typeof window !== "undefined") {
  window.configSchema = configSchema
  window.getFieldSchema = getFieldSchema
  window.getConfigName = getConfigName
  window.getCategories = getCategories
  console.log("[Schema] 配置定义加载完成，已暴露到 window 对象")
  console.log("[Schema] 分类数量:", configSchema.categories.length)
} else {
  globalThis.__configSchema = configSchema
}
