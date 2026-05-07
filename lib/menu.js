import { commandNames } from "../configSchema.js";

const charge = (handlerKey) => commandNames[handlerKey] || "";

export const menuMeta = {
  title: "Sakura 功能菜单",
  subtitle: "所有功能、权限和樱花币消耗一览",
  footer: "无费用标签表示免费；无权限标签表示所有人可用。",
};

export const menuAliases = {
  ai: "ai", chat: "ai", 对话: "ai", 聊天: "ai",
  创作: "creation", 生图: "creation", 绘图: "creation",
  图片: "image", pixiv: "image",
  表情: "fun", 娱乐: "fun",
  经济: "economy", 钓鱼: "fishing",
  群管: "group", 管理: "group",
  主人: "owner", 维护: "owner",
  工具: "utility", 自动: "auto",
};

export const menuGroups = [
  {
    id: "ai", title: "AI 对话与记忆", desc: "角色聊天、上下文、记忆和人设管理。",
    items: [
      { name: "AI聊天", command: "角色前缀 + 内容 / 开始对话 <角色>", desc: "前缀触发、开始对话和连续对话会按 AI聊天 扣费；结束对话不扣费。", costCommand: charge("AIChat.Chat"), examples: ["~ 今天有什么建议", "开始对话 小叶"] },
      { name: "停止生成", command: "#停止 / #强制停止", desc: "停止当前用户正在进行的对话或生成任务。" },
      { name: "清空单个对话", command: "#清空对话 <角色或前缀>", desc: "清空指定角色的当前对话历史。" },
      { name: "撤销对话", command: "#撤销对话 <角色或前缀>", desc: "回滚指定角色最近一轮对话。" },
      { name: "篡改对话", command: "#篡改对话 <内容>", desc: "手动写入一条对话上下文，用于修正角色短期走向。" },
      { name: "列出对话", command: "#列出对话 <角色或前缀>", desc: "导出指定角色当前对话记录。" },
      { name: "清空全部对话", command: "#清空全部对话", desc: "清空当前用户的全部角色对话。" },
      { name: "清空所有用户对话", command: "#清空所有用户对话", desc: "清空全体用户对话历史。", permission: "主人" },
      { name: "添加记忆", command: "#添加记忆 <内容>", desc: "为当前用户添加长期记忆。" },
      { name: "删除记忆", command: "#删除记忆 <关键词>", desc: "删除匹配的长期记忆。" },
      { name: "导出记忆", command: "#导出记忆", desc: "导出当前用户长期记忆。" },
      { name: "添加人设", command: "#人设增加", desc: "通过对话流程添加 AI 人设。" },
      { name: "删除人设", command: "#人设删除", desc: "删除指定 AI 人设。", permission: "主人" },
      { name: "列出人设", command: "#列出人设", desc: "查看已配置的人设列表。", permission: "主人" },
      { name: "列出AI设定", command: "#列出AI设定", desc: "以转发消息查看前缀绑定的 AI 角色。" },
      { name: "列出渠道", command: "#列出渠道", desc: "查看已配置的 AI 渠道。", permission: "主人" },
      { name: "取消流程", command: "#取消", desc: "取消当前正在进行的人设、记忆或语音角色录入流程。" },
    ],
  },
  {
    id: "creation", title: "AI 创作", desc: "生图、绘图、视频和语音生成。",
    items: [
      { name: "AI图片编辑", command: "#i <提示词>", desc: "使用生图渠道进行文生图或引用图片改图，支持比例和清晰度参数。", costCommand: charge("EditImage.dispatchHandler"), examples: ["#i 16:9 赛博风格城市夜景"] },
      { name: "自定义图片指令", command: "配置的 EditImage 触发词", desc: "按后台配置的图片编辑触发词处理引用图片。", costCommand: charge("EditImage.dispatchHandler") },
      { name: "NAI绘图", command: "#绘图 <提示词>", desc: "使用 NovelAI 绘图，支持画风和附加提示词。", costCommand: charge("NaiPainting.naiParams") },
      { name: "添加画风", command: "#添加画风 <名称>", desc: "添加 NAI 画风预设。", permission: "主人" },
      { name: "删除画风", command: "#删除画风 <名称>", desc: "删除 NAI 画风预设。", permission: "主人" },
      { name: "画风列表", command: "#画风列表", desc: "查看可用 NAI 画风。" },
      { name: "Grok图片编辑", command: "#gi <提示词>", desc: "使用 Grok 图片能力生成或编辑图片。", costCommand: charge("GrokImage.editImage") },
      { name: "Grok视频生成", command: "#gv <提示词>", desc: "使用 Grok 视频能力生成短视频。", costCommand: charge("GrokVideo.generateVideo") },
      { name: "语音生成", command: "说 <内容> / <角色名> <内容>", desc: "使用 VoxCPM 根据文本生成语音。", costCommand: charge("VoxCPMVoice.generateVoice") },
      { name: "添加语音角色", command: "#添加语音角色 <角色名>", desc: "通过参考语音录入新的语音角色。" },
      { name: "删除语音角色", command: "#删除语音角色 <角色名>", desc: "删除指定语音角色。" },
      { name: "语音角色列表", command: "#语音角色列表", desc: "查看可用语音角色。" },
    ],
  },
  {
    id: "image", title: "图片、Pixiv 与搜图", desc: "图库、插画、排行榜、订阅和以图搜图。",
    items: [
      { name: "来张涩图", command: "#来张涩图", desc: "从涩图库获取图片。", costCommand: charge("setuPlugin.handleApiRequest") },
      { name: "来张萝莉图", command: "#来张萝莉图", desc: "从配置图库获取萝莉图。", costCommand: charge("GetImagePlugin.handleImage") },
      { name: "Pixiv PID", command: "#pid <作品ID>", desc: "根据 Pixiv 作品 ID 获取插画。", costCommand: charge("pixivSearch.getPixivByPid") },
      { name: "来张插画", command: "#来张插画 <关键词>", desc: "按关键词搜索 Pixiv 插画。", costCommand: charge("pixivSearch.searchPixiv") },
      { name: "Pixiv榜单", command: "#日榜 / #周榜 / #月榜", desc: "查看 Pixiv 各类排行榜。", costCommand: charge("pixivSearch.viewRanking") },
      { name: "榜单详情", command: "#日榜#1", desc: "获取排行榜中指定序号的作品详情。", costCommand: charge("pixivSearch.getRankingItem") },
      { name: "订阅标签", command: "#订阅标签 <标签>", desc: "订阅 Pixiv 标签更新。" },
      { name: "取消订阅标签", command: "#取消订阅标签 <标签>", desc: "取消 Pixiv 标签订阅。" },
      { name: "订阅画师", command: "#订阅画师 <画师ID>", desc: "订阅指定 Pixiv 画师更新。" },
      { name: "取消订阅画师", command: "#取消订阅画师 <画师ID>", desc: "取消指定画师订阅。" },
      { name: "订阅列表", command: "#订阅列表", desc: "查看当前群 Pixiv 订阅。" },
      { name: "搜图", command: "#搜图 / #ascii搜图 / #saucenao搜图", desc: "引用图片进行以图搜图，支持多个渠道前缀。", costCommand: charge("SearchImage.imageSearch") },
      { name: "切割图片", command: "切割 <行> <列>", desc: "引用图片后切割成指定行列。" },
      { name: "传相册", command: "#传相册 <相册名>", desc: "引用图片上传到群相册。" },
      { name: "刷新群相册", command: "#刷新群相册", desc: "刷新群相册缓存。" },
    ],
  },
  {
    id: "fun", title: "表情、词条与娱乐", desc: "表情包、关键词回复、游戏和互动。",
    items: [
      { name: "添加词条", command: "#添加 <关键词>", desc: "引用消息添加关键词回复。", costCommand: charge("KeywordReply.添加词条"), examples: ["引用一条消息后发送 #添加 早安"] },
      { name: "删除词条", command: "#删除 <关键词>", desc: "删除当前群关键词回复。", costCommand: charge("KeywordReply.删除词条") },
      { name: "词条列表", command: "#词条列表", desc: "查看当前群所有关键词回复。" },
      { name: "关键词触发", command: "发送已添加的关键词", desc: "自动回复匹配的词条内容。" },
      { name: "表情包制作", command: "#<meme关键词>", desc: "按 meme 模板制作表情包。", costCommand: charge("memesPlugin.memes") },
      { name: "随机表情包", command: "#随机表情包", desc: "随机生成一个表情包。", costCommand: charge("memesPlugin.randomMemes") },
      { name: "表情包列表", command: "#表情包列表", desc: "查看可用 meme 模板。" },
      { name: "表情包搜索", command: "#表情包搜索 <关键词>", desc: "搜索 meme 模板。" },
      { name: "表情包帮助", command: "#表情包帮助", desc: "查看 meme 使用帮助。" },
      { name: "更新表情包", command: "#表情包更新", desc: "更新 meme 资源。", permission: "主人" },
      { name: "存表情", command: "#存表情", desc: "引用图片保存到表情库。", permission: "白名单" },
      { name: "发表情", command: "#发表情 <名称>", desc: "发送表情库中的图片。", permission: "白名单" },
      { name: "删表情", command: "#删表情 <名称>", desc: "删除表情库图片。", permission: "白名单" },
      { name: "清空表情库", command: "#清空表情库", desc: "清空表情库。", permission: "主人" },
      { name: "创建飞行棋", command: "#创建飞行棋", desc: "创建飞行棋房间。" },
      { name: "加入飞行棋", command: "#加入飞行棋", desc: "加入当前飞行棋房间。" },
      { name: "开始飞行棋", command: "#开始飞行棋", desc: "开始当前飞行棋游戏。" },
      { name: "选择棋子", command: "1 / 2 / 3 / 4", desc: "飞行棋中选择棋子。" },
      { name: "结束飞行棋", command: "#结束飞行棋", desc: "结束当前飞行棋游戏。" },
      { name: "好感度", command: "#好感度", desc: "查看自己的好感度状态。" },
      { name: "谁在意我", command: "#谁在意我", desc: "查看对自己好感较高的人。" },
      { name: "我在意谁", command: "#我在意谁", desc: "查看自己在意的人。" },
      { name: "复读/撤回互动", command: "自动触发", desc: "复读、撤回复读等群聊互动功能。", trigger: "自动" },
      { name: "主动触发伪人", command: "@机器人 / 配置触发词", desc: "艾特机器人或命中触发词时按伪人扣费；普通概率被动回复不扣费。", costCommand: charge("Mimic.Mimic"), trigger: "主动" },
    ],
  },
  {
    id: "economy", title: "经济系统", desc: "签到、资产、转账、商店和背包。",
    items: [
      { name: "签到", command: "#签到", desc: "每日签到获得樱花币和经验。" },
      { name: "添加樱花币", command: "#添加樱花币 <数量>", desc: "给指定用户添加樱花币。", permission: "主人" },
      { name: "打劫", command: "#打劫", desc: "尝试抢夺目标用户樱花币。" },
      { name: "反击", command: "#反击 / #复仇", desc: "对打劫行为进行反击。" },
      { name: "商店", command: "#商店", desc: "查看可购买物品。" },
      { name: "购买", command: "#购买 <物品> [数量]", desc: "购买商店物品。", costNote: "按商品价格" },
      { name: "背包", command: "#背包", desc: "查看自己的物品背包。" },
      { name: "升级背包", command: "#升级背包", desc: "消耗樱花币提升背包容量。", costNote: "按等级费用" },
      { name: "我的信息", command: "#我的信息", desc: "查看资产、等级和经验。" },
      { name: "转账", command: "#转账 <数量> @用户", desc: "向其他用户转账樱花币。", costNote: "转账金额" },
      { name: "出售", command: "#出售 <物品>", desc: "出售背包物品。" },
      { name: "使用物品", command: "#使用 <物品>", desc: "使用背包中的特殊物品。", costNote: "消耗物品" },
      { name: "领取复活币", command: "#领取复活币", desc: "低资产时领取每日复活币。" },
      { name: "金币排行", command: "#金币排行", desc: "查看樱花币排行榜。" },
      { name: "等级排行", command: "#等级排行", desc: "查看等级或经验排行榜。" },
    ],
  },
  {
    id: "fishing", title: "钓鱼玩法", desc: "钓鱼、装备、鱼雷、职业和排行。",
    items: [
      { name: "钓鱼", command: "#钓鱼", desc: "进行一次钓鱼并获得鱼、物品或事件。", costNote: "受装备/道具影响" },
      { name: "装备鱼竿", command: "#装备鱼竿 <名称>", desc: "装备背包中的鱼竿。", costNote: "需拥有装备" },
      { name: "装备鱼饵", command: "#装备鱼饵 <名称>", desc: "装备背包中的鱼饵。", costNote: "需拥有鱼饵" },
      { name: "装备鱼线", command: "#装备鱼线 <名称>", desc: "装备背包中的鱼线。", costNote: "需拥有鱼线" },
      { name: "钓鱼状态", command: "#钓鱼状态", desc: "查看当前装备和钓鱼状态。" },
      { name: "钓鱼记录", command: "#钓鱼记录 [页码]", desc: "查看个人钓鱼记录。" },
      { name: "投放鱼雷", command: "#投放鱼雷", desc: "在鱼塘投放鱼雷制造特殊事件。", costNote: "消耗鱼雷" },
      { name: "鱼雷状态", command: "#鱼雷状态", desc: "查看当前鱼塘鱼雷状态。" },
      { name: "钓鱼排行", command: "#钓鱼排行", desc: "查看钓鱼排行榜。" },
      { name: "职业列表", command: "#职业列表", desc: "查看钓鱼职业说明。" },
      { name: "选择职业", command: "#选择职业 <名称>", desc: "选择钓鱼职业。", costNote: "按职业规则" },
      { name: "进阶职业", command: "#进阶职业", desc: "升级当前钓鱼职业。", costNote: "按进阶费用" },
    ],
  },
  {
    id: "group", title: "群管理", desc: "成员清理、禁言、踢人、公告和群申请。",
    items: [
      { name: "清理未发言", command: "#清理未发言", desc: "准备清理从未发言的成员。", permission: "管理/白名单" },
      { name: "清理不活跃", command: "#清理不活跃", desc: "按最后发言时间准备清理不活跃成员。", permission: "管理/白名单" },
      { name: "按等级清理", command: "#清理等级 <等级>", desc: "按群等级准备清理成员。", permission: "管理/白名单" },
      { name: "禁言", command: "#禁言 @用户 10分钟", desc: "禁言指定成员。", permission: "管理/白名单" },
      { name: "踢人", command: "#踢 @用户", desc: "移出指定成员。", permission: "管理/白名单" },
      { name: "设精华", command: "#设精华", desc: "引用消息设置群精华。", permission: "管理/白名单" },
      { name: "全员禁言", command: "#全员禁言 / #解除全员禁言", desc: "开启或关闭全员禁言。", permission: "管理/白名单" },
      { name: "群公告", command: "#群公告 <内容>", desc: "发布群公告。", permission: "管理/白名单" },
      { name: "群待办", command: "#群待办", desc: "引用消息设置群待办。", permission: "管理/白名单" },
      { name: "群申请处理", command: "#同意 / #拒绝", desc: "处理入群申请。", permission: "管理/白名单" },
      { name: "入退群通知", command: "自动触发", desc: "成员加入或退出时自动发送提示。", trigger: "自动" },
    ],
  },
  {
    id: "utility", title: "生活与工具", desc: "提醒、睡眠、画像、B站解析和系统维护。",
    items: [
      { name: "菜单", command: "#菜单 / #AI菜单 / #主人菜单 / #全部菜单", desc: "查看总菜单、分类菜单、主人维护或完整菜单。" },
      { name: "个人画像", command: "#画像", desc: "生成当前用户画像卡片。" },
      { name: "提醒列表", command: "#提醒列表 [页码]", desc: "查询提醒任务。" },
      { name: "删除提醒", command: "#删除提醒 <ID>", desc: "删除指定提醒。" },
      { name: "开关提醒", command: "#开启提醒 <ID> / #关闭提醒 <ID>", desc: "启用或停用提醒。" },
      { name: "睡眠分析", command: "睡眠信息 / 睡眠分析", desc: "查看睡眠统计。" },
      { name: "晚安", command: "晚安", desc: "记录入睡时间。" },
      { name: "早安", command: "早安 / 起床", desc: "记录起床时间并计算睡眠。" },
      { name: "撤回引用", command: "撤回", desc: "引用机器人消息后请求撤回。" },
      { name: "B站解析", command: "发送 B 站链接", desc: "自动解析 B 站视频信息。", trigger: "自动" },
      { name: "消息转发", command: "按配置自动转发", desc: "根据后台规则跨群转发消息。", trigger: "自动" },
      { name: "更新插件", command: "#更新", desc: "执行插件更新。", permission: "主人" },
    ],
  },
  {
    id: "auto", title: "自动触发功能", desc: "无需显式命令，由群消息或事件触发。",
    items: [
      { name: "主动聊天", command: "自动触发", desc: "在配置群中按上下文主动参与聊天。", trigger: "自动" },
      { name: "表情包小偷", command: "自动触发", desc: "学习并按概率复用群内表情。", trigger: "自动" },
      { name: "冷群发图", command: "自动触发", desc: "群聊冷却时按配置随机发图。", trigger: "自动" },
      { name: "戳一戳回复", command: "戳机器人", desc: "收到戳一戳时自动回复或执行互动。", trigger: "自动" },
      { name: "撤回记录", command: "自动触发", desc: "记录并处理群撤回事件。", trigger: "自动" },
      { name: "60秒新闻", command: "定时推送", desc: "按配置群推送每日新闻。", trigger: "定时" },
      { name: "Pixiv订阅推送", command: "定时推送", desc: "定时推送订阅标签和画师新作品。", trigger: "定时" },
      { name: "自动清理", command: "定时执行", desc: "按配置自动清理不符合条件的成员。", trigger: "定时" },
    ],
  },
];

function buildOwnerMenuGroup() {
  const items = menuGroups.flatMap((group) =>
    group.items
      .filter((item) => item.permission === "主人")
      .map((item) => ({ ...item, desc: `【${group.title}】${item.desc}` }))
  );

  return { id: "owner", title: "主人维护", desc: "聚合主人专用的配置、清理和维护指令。", items };
}

function getMenuGroups({ includeOwner = false } = {}) {
  return includeOwner ? [...menuGroups, buildOwnerMenuGroup()] : menuGroups;
}

function normalizeText(value) {
  return `${value || ""}`.trim().toLowerCase();
}

function buildCostMap(economyConfig = {}) {
  const map = new Map();
  for (const item of economyConfig.commandCosts || []) {
    if (item?.command) map.set(item.command, Number(item.cost) || 0);
  }
  return map;
}

function isCommandChargingActive(economyConfig = {}, groupId = null) {
  if (!economyConfig.enable) return false;
  if (groupId == null || groupId === "") return true;
  return (economyConfig.Groups || []).map(Number).includes(Number(groupId));
}

function resolveCost(item, costMap, commandChargingActive) {
  if (!item.costCommand || !commandChargingActive) {
    return { cost: 0, costText: "", costNote: item.costNote || "", isCharged: false, showCost: false, costClass: "", commandChargingActive };
  }

  if (!costMap.has(item.costCommand)) {
    return { cost: null, costText: "未配置", costNote: item.costNote || "", isCharged: false, showCost: true, costClass: "free", commandChargingActive };
  }

  const cost = costMap.get(item.costCommand);
  return { cost, costText: cost > 0 ? `${cost}币` : "", costNote: item.costNote || "", isCharged: cost > 0, showCost: cost > 0, costClass: cost > 0 ? "charged" : "free", commandChargingActive };
}

export function resolveMenuFilter(filterText = "") {
  const normalized = normalizeText(filterText);
  if (!normalized) return null;
  if (menuAliases[normalized]) return menuAliases[normalized];

  const matched = getMenuGroups({ includeOwner: true }).find((group) => normalizeText(group.id) === normalized || normalizeText(group.title).includes(normalized));
  return matched?.id || null;
}

const overviewLabels = {
  ai: "AI",
  creation: "创作",
  image: "图片",
  fun: "表情",
  economy: "经济",
  fishing: "钓鱼",
  group: "群管",
  utility: "工具",
  auto: "自动",
};

export function buildMenuOverviewData({ groupId = null, economyConfig = {} } = {}) {
  const commandChargingActive = isCommandChargingActive(economyConfig, groupId);
  const commands = menuGroups.map((group) => {
    const label = overviewLabels[group.id] || group.id;
    return {
      name: group.title,
      command: `#${label}菜单`,
      desc: `${group.desc} 共 ${group.items.length} 项功能。`,
      cost: 0,
      costText: "",
      costNote: "",
      isCharged: false,
      showCost: false,
      costClass: "",
      permission: "",
      showPermission: false,
      trigger: "指令",
      examples: [`#${label}菜单`],
    };
  });

  return {
    title: menuMeta.title,
    subtitle: "发送 #AI菜单、#钓鱼菜单 查看分类详情；发送 #主人菜单 查看维护指令；发送 #全部菜单 查看完整菜单。",
    footer: menuMeta.footer,
    menu: [{ id: "overview", title: "菜单分类", category: "菜单分类", desc: "选择一个分类查看二级菜单。", commands }],
    filterId: null,
    groupId,
    commandChargingActive,
    totalCount: commands.length,
    isOverview: true,
  };
}

export function buildMenuData({ economyConfig = {}, groupId = null, filter = "" } = {}) {
  const filterId = resolveMenuFilter(filter);
  const costMap = buildCostMap(economyConfig);
  const commandChargingActive = isCommandChargingActive(economyConfig, groupId);
  const sourceGroups = getMenuGroups({ includeOwner: !filterId || filterId === "owner" });
  const groups = sourceGroups
    .filter((group) => !filterId || group.id === filterId)
    .map((group) => ({
      ...group,
      category: group.title,
      commands: group.items.map((item) => ({
        ...item,
        ...resolveCost(item, costMap, commandChargingActive),
        permission: item.permission || "",
        showPermission: Boolean(item.permission),
        trigger: item.trigger || "指令",
      })),
    }));

  return {
    title: filterId ? `${menuMeta.title} - ${groups[0]?.title || filter}` : menuMeta.title,
    subtitle: menuMeta.subtitle,
    footer: menuMeta.footer,
    menu: groups,
    filterId,
    groupId,
    commandChargingActive,
    totalCount: groups.reduce((sum, group) => sum + group.commands.length, 0),
  };
}
