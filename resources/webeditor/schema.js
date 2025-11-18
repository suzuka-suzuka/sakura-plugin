console.log("[Schema] 开始加载配置定义... v2.0")

const configSchema = {
  categories: [
    {
      name: "图片功能",
      icon: "🖼️",
      configs: ["cool", "teatime", "EmojiThief", "summary", "pixiv", "r18", "EditImage", "tenor"],
    },
    {
      name: "AI渠道",
      icon: "🤖",
      configs: ["Channels"],
    },
    {
      name: "AI设定",
      icon: "💬",
      configs: ["AI", "mimic"],
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
        "Permission",
        "webeditor",
        "groupnotice",
        "SoraVideo",
      ],
    },
  ],

  configNames: {
    "60sNews": "每日新闻",
    AI: "AI对话",
    AutoCleanup: "自动清理",
    bilicookie: "B站Cookie",
    Channels: "AI渠道",
    cool: "冷群",
    EditImage: "修图",
    EmojiThief: "表情包小偷",
    forwardMessage: "消息转发",
    menu: "菜单",
    mimic: "伪人模式",
    Permission: "权限管理",
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
    SoraVideo: "Sora视频生成",
  },

  fields: {
    Groups: { label: "启用群", type: "groupSelect", help: "选择启用此功能的群聊" },
    groups: { label: "启用群", type: "groupSelect", help: "选择启用此功能的群聊" },
    name: { label: "名称", type: "text" },
    description: { label: "描述", type: "textarea" },
    title: { label: "标题", type: "text" },

    "summary.enable": { label: "启用", type: "boolean" },
    "poke.enable": { label: "戳一戳总开关", type: "boolean" },
    "poke.botname": {
      label: "机器人昵称",
      type: "text",
      help: "用于回复中的机用于回复中的bot名称，回复中的 _botname_ 会被替换为这里的名字",
    },
    "repeat.enable": { label: "复读", type: "boolean" },
    "recall.enable": { label: "防撤回", type: "boolean" },
    "r18.enable": { label: "启用群", type: "groupSelect", help: "影响所有图片功能" },
    "Permission.enable": {
      label: "已赋权QQ",
      type: "array",
      itemType: "text",
      help: "赋予管理权限",
    },

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

    "EditImage.tasks": {
      label: "修图提示词",
      type: "array",
      itemType: "object",
      help: "配置自定义图片编辑指令和提示词",
      schema: {
        reg: { label: "触发词", type: "text", required: true },
        prompt: { label: "描述", type: "text", required: true },
      },
    },
    tasks: {
      label: "修图任务",
      type: "array",
      itemType: "object",
      schema: {
        reg: { label: "触发词", type: "text", required: true },
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
      },
    },

    "AI.enableActiveChat": {
      label: "启用消息未回复用户唤醒",
      type: "boolean",
      help: "启用后，机器人会回复上一条ai对话未回复的人",
    },
    "AI.profiles": {
      label: "角色配置",
      type: "array",
      itemType: "object",
      help: "配置不同的人格和其设定，可新增或删除角色",
      schema: {
        name: { label: "角色名称", type: "text", required: true },
        prefix: {
          label: "触发前缀",
          type: "text",
          required: true,
          help: "用于触发该角色的命令前缀",
        },
        Channel: {
          label: "渠道",
          type: "text",
          required: true,
          help: "使用的渠道名称，必须与上方渠道配置中的名称一致",
        },
        Prompt: {
          label: "预设提示词",
          type: "textarea",
          required: true,
          help: "角色的核心设定，例如：你是一个可爱的猫娘...",
        },
        GroupContext: { label: "启用群聊上下文", type: "boolean" },
        History: { label: "启用历史记录", type: "boolean" },
        Tool: { label: "启用工具", type: "boolean" },
      },
    },
    "AI.groupContextLength": { label: "群聊上下文长度", type: "number", min: 1 },
    "AI.enableUserLock": {
      label: "是否启用用户锁",
      type: "boolean",
      help: "启用后，每个用户处理完当前消息前，不会处理该用户的后续消息，直到当前消息处理完毕",
    },
    "AI.toolschannel": {
      label: "工具渠道",
      type: "text",
      help: "用于AI工具的渠道，必须是gemini渠道",
    },
    "AI.appschannel": {
      label: "应用渠道",
      type: "text",
      help: "用于杂项功能(戳一戳，画像，早晚安，进退群等)的渠道",
    },
    "AI.defaultchannel": {
      label: "默认渠道",
      type: "text",
      help: "当指定渠道不可用时使用的备用渠道，建议设为gemini渠道",
    },
    "AI.groupPrompts": {
      label: "群组自定义预设",
      type: "array",
      itemType: "object",
      help: "为特定群组设置自定义预设，优先级最高，不会干扰主预设。群号可直接输入或从已连接的群中选择",
      schema: {
        groupId: { label: "群号", type: "text", required: true, help: "输入群号（如：123456789）" },
        prompt: { label: "自定义预设提示词", type: "textarea", required: true, help: "该群使用的自定义AI预设，会覆盖默认预设" },
      },
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
      },
    },
    groupContextLength: { label: "群聊上下文长度", type: "number", min: 1 },
    enableUserLock: { label: "启用用户锁", type: "boolean", help: "防止用户消息并发处理" },

    "mimic.Groups": { label: "启用群", type: "groupSelect" },
    "mimic.Channel": { label: "伪人渠道", type: "text" },
    "mimic.Prompt": { label: "伪人预设", type: "textarea", help: "默认预设" },
    "mimic.alternatePrompt": {
      label: "反差预设",
      type: "textarea",
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
    "mimic.splitMessage": {
      label: "启用消息分割",
      type: "boolean",
      help: "启用后,当伪人回复过长时会进行分割发送",
    },
    "mimic.recalltime": {
      label: "撤回时间(秒)",
      type: "number",
      min: 0,
      help: "反差预设触发时,消息撤回的延迟时间,单位为秒。设为0则不撤回",
    },
    "mimic.groupPrompts": {
      label: "群组自定义预设",
      type: "array",
      itemType: "object",
      help: "为特定群组设置自定义预设，优先级最高，不会干扰主预设。群号可直接输入或从已连接的群中选择",
      schema: {
        groupId: { label: "群号", type: "text", required: true, help: "输入群号（如：123456789）" },
        prompt: { label: "自定义预设提示词", type: "textarea", required: true, help: "该群使用的自定义伪人预设，会覆盖默认预设" },
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
      itemType: "object",
      help: "配置不同的人格和其设定",
      schema: {
        name: { label: "角色名称", type: "text", required: true },
        Prompt: { label: "预设提示词", type: "textarea", required: true, help: "角色的核心设定" },
      },
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
          type: "array",
          itemType: "text",
          required: true,
          help: "输入群号，可添加多个",
        },
        targetGroupIds: {
          label: "目标群号",
          type: "array",
          itemType: "text",
          required: true,
          help: "输入群号，可添加多个",
        },
      },
    },
    forwardRules: {
      label: "转发规则",
      type: "array",
      itemType: "object",
      schema: {
        sourceGroupIds: { label: "来源群号", type: "array", itemType: "text", required: true },
        targetGroupIds: { label: "目标群号", type: "array", itemType: "text", required: true },
      },
    },

    "60sNews.Groups": { label: "启用群", type: "groupSelect" },

    "bilicookie.cookie": { label: "B站cookie", type: "text" },

    "AutoCleanup.groups": {
      label: "启用群",
      type: "groupSelect",
      help: "每天0点自动清理：1.半年未发言的人 2.进群超24小时但群等级为1级的号",
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

    port: { label: "端口", type: "number", min: 1024, max: 65535 },

    baseURL: { label: "API地址", type: "text" },
    model: { label: "模型名称", type: "text" },
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

window.configSchema = configSchema
window.getFieldSchema = getFieldSchema
window.getConfigName = getConfigName
window.getCategories = getCategories

console.log("[Schema] 配置定义加载完成，已暴露到 window 对象")
console.log("[Schema] 分类数量:", configSchema.categories.length)
