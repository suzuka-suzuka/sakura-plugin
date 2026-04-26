import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import {
    DEFAULT_TAVILY_MAX_RESULTS,
    DEFAULT_TAVILY_MCP_URL,
    DEFAULT_TAVILY_SEARCH_DEPTH,
    MAX_TAVILY_SEARCH_RESULTS,
    TAVILY_SEARCH_DEPTH_OPTIONS,
    TAVILY_RAW_CONTENT_OPTIONS,
    normalizeTavilyRawContent,
} from './lib/AIUtils/tavilyConfig.js';

function cronString(defaultValue = '0 * * * *') {
    return z.string().default(defaultValue).refine((val) => {
        if (!val || !val.trim()) return false;
        const parts = val.trim().split(/\s+/);
        if (parts.length !== 5) return false;
        try {
            CronExpressionParser.parse(val);
            return true;
        } catch {
            return false;
        }
    }, { message: 'Cron 表达式格式无效，请使用标准 5 段式 cron 格式' });
}

export const commandNames = {
    "setuPlugin.handleApiRequest": "来张涩图",
    "GetImagePlugin.handleImage": "来张萝莉图",
    "GrokImage.editImage": "gi（Grok图片编辑）",
    "GrokVideo.generateVideo": "gv（Grok视频生成）",
    "KeywordReply.添加词条": "添加词条",
    "KeywordReply.删除词条": "删除词条",
    "memesPlugin.memes": "表情包制作",
    "memesPlugin.randomMemes": "随机表情包",
    "pixivSearch.getPixivByPid": "来张插画（P站搜图）",
    "pixivSearch.searchPixiv": "来张插画（P站搜图）",
    "SoraVideo.generateVideo": "sv（Sora视频生成）",
    "VitsVoice.vitsSpeak": "xx说（语音合成）",
    "pixivSearch.viewRanking": "p站排行榜",
    "pixivSearch.getRankingItem": "p站排行榜详情",
    "SearchImage.imageSearch": "搜图",
};

export const manualCommandNames = [
    "AI图片编辑",
    "AI聊天",
    "伪人",
    "绘图",
];

export const News60sSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('推送群号列表|#groupSelect|选择需要推送60秒新闻的QQ群号'),
}).describe('60秒新闻推送');

const ProfileSchema = z.object({
    prefix: z.string().default('').describe('触发前缀|AI对话的触发前缀'),
    name: z.string().default('').describe('角色名称|#roleSelect|AI角色的名称'),
    Channel: z.string().default('default').describe('使用渠道|#channelSelect|选择使用的AI渠道'),
    GroupContext: z.boolean().default(false).describe('群组上下文|是否读取群聊上下文'),
    History: z.boolean().default(true).describe('历史记录|是否保存对话历史'),
    Tool: z.preprocess(val => typeof val === 'boolean' ? '' : val, z.string().default('')).describe('工具组|#toolGroupSelect|选择此角色使用的工具组'),
    Memory: z.boolean().default(false).describe('用户记忆|是否将用户长期记忆注入到系统提示中'),
    enableNaiPainting: z.boolean().default(false).describe('NAI绘图|是否启用NAI绘图功能'),
    naiPrompt: z.string().default('').describe('NAI绘图提示词|#textarea|附加到生成的NAI绘图指令后的提示词'),
});

const ToolGroupSchema = z.object({
    name: z.string().default('').describe('工具组名称'),
    tools: z.array(z.string()).default([]).describe('工具列表|#toolMultiSelect|选择此组包含的工具'),
});

export const AISchema = z.object({
    profiles: z.array(ProfileSchema).default([]).describe('AI角色列表|#nameField:prefix|配置多个AI角色，每个角色可以有不同的前缀和设置'),
    toolGroups: z.array(ToolGroupSchema).default([]).describe('工具组|#nameField:name|自定义工具组合，每个角色可绑定一个工具组'),
    groupContextLength: z.number().default(20).describe('群上下文长度|群聊上下文记忆的消息条数'),
    chatHistoryLength: z.number().default(20).describe('对话历史长度|保留的对话历史消息条数'),
    enableUserLock: z.boolean().default(false).describe('用户锁定|同一用户同时只能进行一个对话'),
    toolschannel: z.string().default('default').describe('工具渠道|#channelSelect'),
    appschannel: z.string().default('default').describe('应用渠道|#channelSelect'),
    defaultchannel: z.string().default('default').describe('默认渠道|#channelSelect'),
    retryCount: z.number().int().min(0).default(1).describe('渠道重试次数|请求失败时对当前渠道的最大重试次数，等待时间线性回退（5s、10s、15s…），耗尽后再回退至默认渠道'),
    maxToolCalls: z.number().default(20).describe('最大工具调用次数|每次对话允许AI连续调用工具的最大次数，超过后将强制结束'),
    trustAICommand: z.boolean().default(false).describe('完全信任AI|开启后AI调用的全部命令均直接执行，无需用户确认且无视白名单'),
}).describe('AI 对话设定');

export const TavilyMCPSchema = z.object({
    apiKey: z.string().default('').describe('API Key|#textarea|Tavily Remote MCP API Key'),
    baseURL: z.string().default(DEFAULT_TAVILY_MCP_URL).describe('Remote MCP URL|通常保持默认即可'),
    includeFavicon: z.boolean().default(true).describe('默认返回图标|作为 Tavily MCP 的默认参数'),
    includeImages: z.boolean().default(false).describe('默认返回图片|作为 Tavily MCP 的默认参数'),
    includeRawContent: z.preprocess(
        (val) => normalizeTavilyRawContent(val),
        z.enum(TAVILY_RAW_CONTENT_OPTIONS).default('false')
    ).describe('正文返回模式|false=不返回, markdown=返回Markdown正文, text=返回纯文本正文'),
    searchDepth: z.enum(TAVILY_SEARCH_DEPTH_OPTIONS).default(DEFAULT_TAVILY_SEARCH_DEPTH).describe('默认搜索深度|basic/advanced/fast/ultra-fast'),
    maxResults: z.number().int().min(1).max(MAX_TAVILY_SEARCH_RESULTS).default(DEFAULT_TAVILY_MAX_RESULTS).describe('默认结果数量|当前 Tavily 搜索结果上限为 20'),
}).describe('Tavily MCP');

export const ActiveChatSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('主动聊天群号|#groupSelect|在这些群中启用主动聊天功能'),
}).describe('主动聊天');

export const AutoCleanupSchema = z.object({
    groups: z.array(z.number()).default([]).describe('自动清理群号|#groupSelect|清除小于1级和半年未发言的人'),
}).describe('自动清理');

const GeminiChannelSchema = z.object({
    name: z.string().default('default').describe('渠道名称'),
    model: z.string().default('gemini-2.5-flash-preview-05-20').describe('模型名称'),
    api: z.string().default('').describe('API Key'),
    baseURL: z.string().default('').describe('自定义URL|留空使用默认地址'),
    vertex: z.boolean().optional().describe('Vertex AI|是否使用Google Vertex AI'),
});

const OpenAIChannelSchema = z.object({
    name: z.string().default('v3').describe('渠道名称'),
    baseURL: z.string().default('https://api.openai.com/v1').describe('API地址'),
    api: z.string().default('').describe('API Key'),
    model: z.string().default('gpt-4').describe('模型名称'),
    enable_thinking: z.boolean().default(false).describe('思考模式|开启后向 OpenAI 兼容接口传入 enable_thinking'),
});

const ImageGeminiChannelSchema = z.object({
    name: z.string().default('gemini-image').describe('渠道名称'),
    model: z.string().default('gemini-3-pro-image-preview').describe('生图模型'),
    api: z.string().default('').describe('API Key|#textarea'),
    baseURL: z.string().default('').describe('自定义URL|留空使用默认地址'),
    vertex: z.boolean().default(false).describe('Vertex AI'),
    vertexApi: z.string().default('').describe('备用 Vertex API Key|#textarea|普通 Gemini 请求失败后可回退到 Vertex'),
});

const ImageOpenAIChannelSchema = z.object({
    name: z.string().default('openai-image').describe('渠道名称'),
    baseURL: z.string().default('https://api.openai.com/v1').describe('API地址'),
    api: z.string().default('').describe('API Key|#textarea'),
    model: z.string().default('gpt-image-2').describe('生图模型'),
});

const GrokChannelSchema = z.object({
    name: z.string().default('grok').describe('渠道名称'),
    model: z.string().default('grok-2').describe('模型名称'),
    sso: z.string().default('').describe('SSO Token|#textarea'),
    cf_clearance: z.string().default('').describe('CF Clearance|#textarea'),
    x_statsig_id: z.string().default('').describe('Statsig ID|#textarea'),
    temporary: z.boolean().default(true).describe('临时会话'),
    dynamic_statsig: z.boolean().default(true).describe('动态Statsig'),
    dynamic_statsig: z.boolean().default(true).describe('动态Statsig'),
});

export const ChannelsSchema = z.object({
    gemini: z.array(GeminiChannelSchema).default([]).describe('Gemini 渠道列表|配置Google Gemini API渠道'),
    openai: z.array(OpenAIChannelSchema).default([]).describe('OpenAI 渠道列表|配置 OpenAI API 渠道'),
    grok: z.array(GrokChannelSchema).default([]).describe('Grok 渠道列表|配置Grok网页渠道'),
}).describe('AI 渠道管理');

export const ImageChannelsSchema = z.object({
    gemini: z.array(ImageGeminiChannelSchema).default([ImageGeminiChannelSchema.parse({})]).describe('Gemini 生图渠道|配置 Google Gemini 图片生成渠道'),
    openai: z.array(ImageOpenAIChannelSchema).default([ImageOpenAIChannelSchema.parse({})]).describe('OpenAI 生图渠道|配置 OpenAI 图片生成渠道'),
}).describe('生图渠道管理');

const EditTaskSchema = z.object({
    trigger: z.string().default('').describe('触发词|图片编辑触发词'),
    prompt: z.string().default('').describe('提示词|#textarea|图片编辑指令'),
});

export const EditImageSchema = z.object({
    imageChannel: z.string().default('').describe('生图渠道|#imageChannelSelect|从生图渠道管理中选择'),
    tasks: z.array(EditTaskSchema).default([]).describe('编辑指令列表|配置自定义的图片编辑指令'),
}).describe('图片编辑');

export const EmojiThiefSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('启用群号|#groupSelect|在这些群中启用表情包学习'),
    rate: z.number().default(1).describe('回复概率|触发回复的概率'),
    vectorRate: z.number().default(0.1).describe('矢量概率|#step:0.01|学习表情的概率'),
}).describe('表情包学习');

export const SoraVideoSchema = z.object({
    access_token: z.string().default('').describe('Access Token|#textarea|Sora视频生成的访问令牌'),
}).describe('Sora 视频生成');

export const VitsVoiceSchema = z.object({
    defaultSpeaker: z.string().default('派蒙').describe('默认语音角色|TTS语音合成使用的默认角色'),
}).describe('语音合成');

export const BilicookieSchema = z.object({
    cookie: z.string().default('').describe('B站Cookie|#textarea|用于解析B站链接的Cookie'),
    autoResolve: z.boolean().default(true).describe('自动解析|是否自动解析群内的B站链接'),
}).describe('B站解析');

export const CoolSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('启用群号'),
    randomIntervalMin: z.number().default(30).describe('最小间隔(秒)|随机冷却的最小间隔'),
    randomIntervalMax: z.number().default(60).describe('最大间隔(秒)|随机冷却的最大间隔'),
}).describe('冷群发图');

export const NaiSchema = z.object({
    token: z.string().default('').describe('Token|#textarea'),
    model: z.string().default('nai-diffusion-4-5-full').describe('模型'),
    negative: z.string().default('nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page').describe('负面提示词|默认负面提示词'),
}).describe('NovelAI 绘画');

const CommandCostSchema = z.object({
    command: z.string().describe('指令名称'),
    cost: z.number().default(0).describe('消耗樱花币'),
});

const defaultCommandCosts = [
    { command: "来张插画", cost: 5 },
    { command: "来张萝莉图", cost: 5 },
    { command: "gi（Grok图片编辑）", cost: 10 },
    { command: "gv（Grok视频生成）", cost: 20 },
    { command: "添加词条", cost: 50 },
    { command: "删除词条", cost: 50 },
    { command: "表情包制作", cost: 5 },
    { command: "随机表情包", cost: 5 },
    { command: "pid（P站搜图）", cost: 5 },
    { command: "涩图（P站搜图）", cost: 5 },
    { command: "sv（Sora视频生成）", cost: 20 },
    { command: "xx说（语音合成）", cost: 5 },
    { command: "AI图片编辑", cost: 20 },
    { command: "AI聊天", cost: 10 },
    { command: "伪人", cost: 10 },
    { command: "绘图", cost: 30 },
    { command: "p站排行榜", cost: 20 },
    { command: "p站排行榜详情", cost: 5 },
    { command: "搜图", cost: 5 },
];

export const EconomySchema = z.object({
    enable: z.boolean().default(true).describe('启用经济系统'),
    Groups: z.array(z.number()).default([]).describe('经济群号|#groupSelect|启用后指令将消耗樱花币'),
    gamegroups: z.array(z.number()).default([]).describe('游戏群号|#groupSelect|启用经济游戏功能的群'),
    commandCosts: z.array(CommandCostSchema).default(defaultCommandCosts).describe('指令消耗配置|#commandCost|配置各指令消耗的樱花币数量'),
}).describe('经济系统');

const ForwardRuleSchema = z.object({
    sourceGroupIds: z.array(z.number()).default([]).describe('来源群号|#groupSelect|转发消息来源的群号列表'),
    targetGroupIds: z.array(z.number()).default([]).describe('目标群号|#groupSelect|消息转发到的目标群号列表'),
    enableImage: z.boolean().default(true).describe('转发图片'),
    enableVideo: z.boolean().default(true).describe('转发视频'),
    enableRecord: z.boolean().default(true).describe('转发语音'),
});

export const ForwardMessageSchema = z.object({
    forwardRules: z.array(ForwardRuleSchema).default([]).describe('转发规则列表|配置消息从哪些群转发到哪些群'),
}).describe('消息转发');

export const GroupnoticeSchema = z.object({
    joinEnable: z.boolean().default(false).describe('入群通知|新成员加入时发送通知'),
    leaveEnable: z.boolean().default(false).describe('退群通知|成员退出时发送通知'),
}).describe('群通知');



const GroupConfigSchema = z.object({
    group: z.number().default(0).describe('群号|#groupSelect|选择此独立配置生效的群'),
    name: z.string().default('小叶').describe('角色|#roleSelect'),
    alternateName: z.string().default('雌小鬼').describe('反差角色|#roleSelect'),
    replyProbability: z.number().default(0.05).describe('回复概率|#step:0.01|0-1之间的小数'),
    triggerWords: z.array(z.string()).default(['小叶']).describe('触发词列表'),
    enableAtReply: z.boolean().default(true).describe('At回复|被@时是否回复'),
    alternatePromptProbability: z.number().default(0.1).describe('反差人格概率|#step:0.01|0-1之间'),
    recalltime: z.number().default(10).describe('撤回时间(秒)|自动撤回消息的秒数'),
    Channel: z.string().default('2.5').describe('使用渠道|#channelSelect'),
    Tool: z.preprocess(val => typeof val === 'boolean' ? '' : val, z.string().default('')).describe('工具组|#toolGroupSelect|选择此群使用的工具组'),
    enableGroupLock: z.boolean().default(false).describe('群锁定|是否开启群流程锁'),
    splitMessage: z.boolean().default(true).describe('拆分消息|是否拆分长消息'),
});

export const MimicSchema = z.object({
    name: z.string().default('小叶').describe('默认角色|#roleSelect'),
    alternateName: z.string().default('雌小鬼').describe('反差角色|#roleSelect'),
    replyProbability: z.number().default(0.05).describe('回复概率|#step:0.01|0-1之间'),
    triggerWords: z.array(z.string()).default(['小叶']).describe('触发词列表'),
    enableAtReply: z.boolean().default(true).describe('At回复'),
    alternatePromptProbability: z.number().default(0.1).describe('反差人格概率|#step:0.01'),
    recalltime: z.number().default(10).describe('撤回时间(秒)'),
    Channel: z.string().default('2.5').describe('使用渠道|#channelSelect'),
    Tool: z.preprocess(val => typeof val === 'boolean' ? '' : val, z.string().default('')).describe('工具组|#toolGroupSelect|选择伪人使用的工具组'),
    enableGroupLock: z.boolean().default(false).describe('群锁定'),
    splitMessage: z.boolean().default(true).describe('拆分消息'),
    Groups: z.array(z.number()).default([]).describe('启用群号|#groupSelect'),
    GroupConfigs: z.array(GroupConfigSchema).default([]).describe('群独立配置|为每个群设置不同的模拟人参数'),
}).describe('伪人配置');

const RankingConfigSchema = z.object({
    mode: z.string().describe('排行榜类型'),
    minLikeRate: z.number().default(0.1).describe('最低点赞率|#step:0.01'),
    minBookmarkRate: z.number().default(0.1).describe('最低收藏率|#step:0.01'),
    minBookmarks: z.number().default(500).describe('最低收藏数'),
});

const defaultRankingConfigs = [
    { mode: '日榜', minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 600 },
    { mode: '周榜', minLikeRate: 0.15, minBookmarkRate: 0.2, minBookmarks: 2000 },
    { mode: '月榜', minLikeRate: 0.05, minBookmarkRate: 0.075, minBookmarks: 5000 },
    { mode: '男性日榜', minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 700 },
    { mode: '女性日榜', minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 500 },
    { mode: '原创日榜', minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 400 },
    { mode: '新人日榜', minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 200 },
    { mode: 'r18日榜', minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 800 },
    { mode: 'r18周榜', minLikeRate: 0.15, minBookmarkRate: 0.2, minBookmarks: 2500 },
];

// 标签订阅配置 Schema
const TagSubscriptionSchema = z.object({
    groupId: z.number().default(0).describe('群号|#groupSelect|订阅推送的目标群'),
    tags: z.array(z.string()).default([]).describe('订阅标签列表|要订阅的 Pixiv 标签'),
});

// 画师订阅配置 Schema
const ArtistSubscriptionSchema = z.object({
    groupId: z.number().default(0).describe('群号|#groupSelect|订阅推送的目标群'),
    artistIds: z.array(z.string()).default([]).describe('画师ID列表|要订阅的画师 UID'),
});

export const PixivSchema = z.object({
    refresh_token: z.string().default('').describe('Pixiv Refresh Token|#textarea'),
    cookie: z.string().default('').describe('Pixiv Cookie|#textarea|用于 Web API 搜索，支持深层分页'),
    proxy: z.string().default('').describe('图片反代域名|如 i.pixiv.re，留空则不使用'),
    recallTime: z.number().default(30).describe('自动撤回时间(秒)|R18作品及风控翻转图片的撤回时间，设为0则不撤回'),
    excludeAI: z.boolean().default(true).describe('排除AI作品|是否过滤AI生成的作品'),
    minBookmarks: z.number().default(600).describe('最低收藏数|低于此值的作品不显示'),
    minBookmarkViewRatio: z.number().default(0.09).describe('最低收藏率|#step:0.01|收藏/浏览比低于此值的不显示'),
    defaultTags: z.array(z.string()).default([]).describe('默认标签|搜索时使用的默认标签'),
    rankingConfigs: z.array(RankingConfigSchema).default(defaultRankingConfigs).describe('排行榜筛选配置|#fixed|#nameField:mode|为每个排行榜单独配置筛选参数'),
    rankingPushGroups: z.array(z.number()).default([]).describe('周榜定时推送群|#groupSelect|每周日11点自动推送周榜的群'),
    // 标签订阅配置
    tagSubscriptions: z.array(TagSubscriptionSchema).default([]).describe('标签订阅|#nameField:groupId|为每个群配置要订阅的标签'),
    tagSubMaxPages: z.number().default(5).describe('标签订阅扫描页数|每次检查时最多扫描的页数'),
    tagSubFreshnessPeriod: z.number().default(86400).describe('标签订阅保质期(秒)|只推送发布时间在此范围内的作品'),
    tagSubMinBookmark: z.number().default(300).describe('标签订阅最低收藏|作品收藏数必须达到此值'),
    tagSubMinBookRate: z.number().default(0.09).describe('标签订阅最低收藏率|#step:0.01|收藏/浏览比'),
    tagSubMinBookPerHour: z.number().default(50).describe('标签订阅每小时收藏增速|作品每小时需新增的收藏数'),
    // 画师订阅配置
    artistSubscriptions: z.array(ArtistSubscriptionSchema).default([]).describe('画师订阅|#nameField:groupId|为每个群配置要订阅的画师'),
    artistSubFreshnessPeriod: z.number().default(43200).describe('画师订阅保质期(秒)|只推送发布时间在此范围内的作品'),
}).describe('Pixiv 功能');

export const BotSchema = z.object({
    botname: z.string().default('小叶').describe('机器人名称|机器人在各功能中使用的名称'),
}).describe('机器人基础设定');

export const PokeSchema = z.object({
    enable: z.boolean().default(true).describe('启用戳一戳'),
    personas: z.array(z.string()).default(['猫娘', '雌小鬼']).describe('人格列表|#roleSelectArray|戳一戳回复使用的人格'),
    masterReplies: z.string().default('').describe('主人回复|#textarea|对主人的特殊回复模板'),
    genericTextReplies: z.string().default('').describe('通用文字回复|#textarea'),
    countRepliesGroup: z.string().default('').describe('群计数回复|#textarea'),
    countRepliesUser: z.string().default('').describe('用户计数回复|#textarea'),
    pokeBackTextReplies: z.string().default('').describe('反戳回复|#textarea'),
}).describe('戳一戳');

export const R18Schema = z.object({
    Groups: z.array(z.number()).default([]).describe('R18群号|#groupSelect|允许发送R18内容的群号'),
}).describe('R18 管理');

export const RecallSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('防撤回启用的群|#groupSelect|在这些群中监听消息撤回'),
}).describe('防撤回');

export const RepeatSchema = z.object({
    enable: z.boolean().default(true).describe('启用复读|是否启用自动复读功能'),
}).describe('复读');

const RoleSchema = z.object({
    name: z.string().default('').describe('角色名称'),
    prompt: z.string().default('').describe('角色提示词|#textarea|定义此角色的系统提示词'),
    Channel: z.string().default('').describe('使用渠道|#channelSelect|留空则使用系统默认渠道'),
    GroupContext: z.boolean().default(false).describe('群组上下文|是否读取群聊上下文'),
    History: z.boolean().default(true).describe('历史记录|是否保存对话历史'),
    Tool: z.preprocess(val => typeof val === 'boolean' ? '' : val, z.string().default('')).describe('工具组|#toolGroupSelect|选择此角色使用的工具组'),
    Memory: z.boolean().default(false).describe('用户记忆|是否将用户长期记忆注入到系统提示中'),
    enableNaiPainting: z.boolean().default(false).describe('NAI绘图|是否启用NAI绘图功能'),
    naiPrompt: z.string().default('').describe('NAI绘图提示词|#textarea|附加到生成的NAI绘图指令后的提示词'),
});

export const RolesSchema = z.object({
    roles: z.array(RoleSchema).default([]).describe('角色列表|预设的AI角色模板'),
}).describe('AI 角色模板');

export const SummarySchema = z.object({
    enable: z.boolean().default(true).describe('启用图片外显'),
    Summaries: z.array(z.string()).default([]).describe('图片外显内容'),
}).describe('图片外显');

export const SearchImageSchema = z.object({
    defaultChannel: z.enum(['ascii2d', 'google', 'saucenao']).default('ascii2d').describe('默认搜图渠道|不带前缀的“搜图”指令默认使用的渠道'),
    maxResults: z.number().default(3).describe('结果条数|转发消息中展示的最大结果数量'),
    googleLogin: z.boolean().default(true).describe('Google 登录|检测到未登录时是否等待手动登录；已有 google-lens-profile 时始终复用登录态'),
    sauceNaoApiKey: z.string().default('').describe('SauceNAO API Key|SauceNAO 搜图使用的 API Key'),
}).describe('搜图');

export const TeatimeSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('下午茶群号|#groupSelect'),
    cron: cronString('0 15 * * *').describe('定时推送的时间表达式|#cron|5段格式: 分 时 日 月 周'),
}).describe('下午茶推送');

const ReminderTaskItemSchema = z.object({
    id: z.string().default('').describe('任务ID|用于标识单条定时任务'),
    enable: z.boolean().default(true).describe('启用任务|是否启用该定时提醒'),
    cron: cronString('0 8 * * *').describe('Cron表达式|#cron|5段格式: 分 时 日 月 周'),
    groupId: z.number().default(0).describe('目标群号|#groupSelect|填写后向该群推送，0 表示不使用群推送'),
    qq: z.string().default('').describe('目标QQ|在群内可用于@某人；不填则仅发送文本'),
    content: z.string().default('早安~').describe('提醒内容|#textarea|定时任务发送的文本内容'),
    createdAt: z.string().default('').describe('创建时间|ISO 时间字符串'),
    source: z.string().default('').describe('来源|任务来源标记'),
}).describe('定时提醒项');

export const ReminderTaskSchema = z.object({
    tasks: z.array(ReminderTaskItemSchema).default([]).describe('提醒任务列表|#nameField:id|可配置多个重复提醒任务'),
}).describe('重复提醒任务');



export const pluginMeta = {
    displayName: '樱花插件',
    icon: '🌸',
};


export const configSchema = {
    'bot': BotSchema,
    '60sNews': News60sSchema,
    'AI': AISchema,
    'TavilyMCP': TavilyMCPSchema,
    'ActiveChat': ActiveChatSchema,
    'AutoCleanup': AutoCleanupSchema,
    'Channels': ChannelsSchema,
    'ImageChannels': ImageChannelsSchema,
    'EditImage': EditImageSchema,
    'EmojiThief': EmojiThiefSchema,
    'SoraVideo': SoraVideoSchema,
    'VitsVoice': VitsVoiceSchema,
    'bilicookie': BilicookieSchema,
    'cool': CoolSchema,
    'economy': EconomySchema,
    'forwardMessage': ForwardMessageSchema,
    'groupnotice': GroupnoticeSchema,
    'mimic': MimicSchema,
    'nai': NaiSchema,
    'pixiv': PixivSchema,
    'poke': PokeSchema,
    'r18': R18Schema,
    'recall': RecallSchema,
    'repeat': RepeatSchema,
    'roles': RolesSchema,
    'SearchImage': SearchImageSchema,
    'summary': SummarySchema,
    'teatime': TeatimeSchema,
    'reminderTask': ReminderTaskSchema,
};


export const schemaCategories = {
    '基础设定': ['bot'],
    'AI渠道': ['Channels'],
    'AI角色': ['roles'],
    'AI设定': ['AI', 'TavilyMCP', 'mimic', 'ActiveChat'],
    '戳一戳': ['poke'],
    '图片功能': ['ImageChannels', 'EditImage', 'nai', 'pixiv', 'r18', 'summary', 'SearchImage', 'cool', 'teatime', 'EmojiThief'],
    '经济系统': ['economy'],
    '其他功能': ['60sNews', 'AutoCleanup', 'forwardMessage', 'groupnotice', 'repeat', 'recall', 'bilicookie', 'VitsVoice', 'SoraVideo', 'reminderTask'],
};

export const schemaLabels = {
    'TavilyMCP': 'Tavily MCP',
    'bot': '机器人基础设定',
    '60sNews': '60秒新闻推送',
    'AI': 'AI 对话设定',
    'ActiveChat': '主动聊天',
    'AutoCleanup': '自动清理',
    'Channels': 'AI 渠道管理',
    'ImageChannels': '生图渠道管理',
    'EditImage': '图片编辑',
    'EmojiThief': '表情偷取',
    'SoraVideo': 'Sora 视频生成',
    'VitsVoice': '语音合成',
    'bilicookie': 'B站解析',
    'cool': '随机冷却',
    'economy': '经济系统',
    'forwardMessage': '消息转发',
    'groupnotice': '群通知',
    'mimic': '伪人配置',
    'nai': 'NovelAI 绘画',
    'pixiv': 'Pixiv 图库',
    'poke': '戳一戳',
    'r18': 'R18 管理',
    'recall': '撤回监听',
    'repeat': '复读机',
    'roles': 'AI 角色',
    'SearchImage': '统一搜图',
    'summary': '图片外显',
    'teatime': '下午茶推送',
    'reminderTask': '重复提醒任务',
};

export const dynamicOptionsConfig = {
    roleSelect: {
        label: '角色',
        sources: [
            { module: 'roles', path: 'roles', valueKey: 'name' }
        ],
    },
    roleSelectArray: {
        label: '角色',
        isArray: true,
        sources: [
            { module: 'roles', path: 'roles', valueKey: 'name' }
        ],
    },
    channelSelect: {
        label: '渠道',
        sources: [
            { module: 'Channels', path: 'gemini', valueKey: 'name' },
            { module: 'Channels', path: 'openai', valueKey: 'name' },
            { module: 'Channels', path: 'grok', valueKey: 'name' },
        ],
    },
    channelSelectArray: {
        label: '渠道',
        isArray: true,
        sources: [
            { module: 'Channels', path: 'gemini', valueKey: 'name' },
            { module: 'Channels', path: 'openai', valueKey: 'name' },
            { module: 'Channels', path: 'grok', valueKey: 'name' },
        ],
    },
    imageChannelSelect: {
        label: '生图渠道',
        sources: [
            { module: 'ImageChannels', path: 'gemini', valueKey: 'name' },
            { module: 'ImageChannels', path: 'openai', valueKey: 'name' },
        ],
    },
    toolGroupSelect: {
        label: '工具组',
        sources: [
            { module: 'AI', path: 'toolGroups', valueKey: 'name' },
        ],
    },
};
