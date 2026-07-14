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

const COMMON_REASONING_LEVELS = ['default', 'off', 'minimal', 'low', 'medium', 'high'];
const OPENAI_REASONING_EFFORT_OPTIONS = ['inherit', 'default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const GEMINI_THINKING_LEVEL_OPTIONS = ['inherit', 'default', 'off', 'minimal', 'low', 'medium', 'high'];
const ROUTING_STRATEGIES = ['round_robin', 'weighted_round_robin', 'priority', 'priority_weighted'];
const ROUTING_STRATEGY_LABELS = [
    'round_robin=轮询',
    'weighted_round_robin=加权轮询',
    'priority=优先级',
    'priority_weighted=优先级加权轮询',
].join(',');

const nonEmptyString = (label) => z.string().trim().min(1, `${label}不能为空`);

const routingStrategy = (label) => z.enum(ROUTING_STRATEGIES)
    .default('priority_weighted')
    .describe(`${label}|#optionLabels:${ROUTING_STRATEGY_LABELS}`);

function addUniqueFieldIssues(items, field, ctx, pathPrefix = []) {
    const seen = new Set();
    items.forEach((item, index) => {
        const value = item?.[field];
        if (!value) return;
        if (seen.has(value)) {
            ctx.addIssue({
                code: 'custom',
                path: [...pathPrefix, index, field],
                message: `${field} “${value}”重复`,
            });
        }
        seen.add(value);
    });
}

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
    "VideoGeneration.generateVideo": "视频生成",
    "BiliUidAnalyzer.queryUid": "B站UID分析",
    "KeywordReply.添加词条": "添加词条",
    "KeywordReply.删除词条": "删除词条",
    "memesPlugin.memes": "表情包制作",
    "memesPlugin.randomMemes": "随机表情包",
    "pixivSearch.getPixivByPid": "pid（P站搜图）",
    "pixivSearch.searchPixiv": "来张插画",
    "AIChat.Chat": "AI聊天",
    "EditImage.dispatchHandler": "AI图片编辑",
    "NaiPainting.naiParams": "绘图",
    "Mimic.Mimic": "拟态回复",
    "VoxCPMVoice.generateVoice": "语音生成",
    "pixivSearch.viewRanking": "p站排行榜",
    "pixivSearch.getRankingItem": "p站排行榜详情",
    "SearchImage.imageSearch": "搜图",
};

export const manualCommandNames = [
];

export const News60sSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('推送群号列表|#groupSelect|选择需要推送60秒新闻的QQ群号'),
}).describe('60秒新闻推送');

export const GroupInsightSchema = z.object({
    autoDailyReport: z.boolean().default(true).describe('自动群聊日报|每天23:59为当天活跃群生成实时报告，不读取或写入报告缓存'),
    Groups: z.array(z.number()).default([]).describe('日报群号|#groupSelect|留空时向所有当天达到消息门槛的已记录群发送'),
}).describe('群聊洞见');

const ProfileSchema = z.object({
    prefixes: z.array(nonEmptyString('触发前缀')).min(1, '至少配置一个触发前缀').describe('触发前缀|第一个为主前缀，其余为别名；匹配时最长前缀优先'),
    name: z.string().default('').describe('角色名称|#roleSelect|AI角色的名称'),
    route: nonEmptyString('模型路由').describe('模型路由|#routeSelect|选择逻辑模型路由'),
    groupContext: z.boolean().default(false).describe('群组上下文|是否读取群聊上下文'),
    history: z.boolean().default(true).describe('历史记录|是否保存对话历史'),
    toolGroup: z.string().default('').describe('工具组|#toolGroupSelect|选择此角色使用的工具组'),
    enableNaiPainting: z.boolean().default(false).describe('NAI绘图|是否启用NAI绘图功能'),
    naiPrompt: z.string().default('').describe('NAI绘图提示词|#textarea|附加到生成的NAI绘图指令后的提示词'),
});

const ToolGroupSchema = z.object({
    name: z.string().default('').describe('工具组名称'),
    tools: z.array(z.string()).default([]).describe('工具列表|#toolMultiSelect|选择此组包含的工具'),
});

export const AISchema = z.object({
    profiles: z.array(ProfileSchema).default([]).describe('AI角色列表|#nameField:name|配置多个AI角色，每个角色可以有多个触发前缀'),
    toolGroups: z.array(ToolGroupSchema).default([]).describe('工具组|#nameField:name|自定义工具组合，每个角色可绑定一个工具组'),
    groupContextLength: z.number().default(20).describe('群上下文长度|群聊上下文记忆的消息条数'),
    chatHistoryLength: z.number().default(20).describe('对话历史长度|保留的对话历史消息条数'),
    enableUserLock: z.boolean().default(false).describe('单人锁|统一控制 AI 聊天与拟态回复；每个功能同一用户在同一群内只处理一条消息'),
    toolsRoute: z.string().default('default').describe('工具路由|#routeSelect'),
    appsRoute: z.string().default('default').describe('应用路由|#routeSelect'),
    gcsBucket: z.string().default('').describe('GCS Bucket|Vertex 视频分析上传的 Cloud Storage bucket'),
    gcsPrefix: z.string().default('sakura-message-videos').describe('GCS Prefix|Vertex 视频分析临时文件目录'),
    maxToolCalls: z.number().default(20).describe('最大工具调用次数|每次对话允许AI连续调用工具的最大次数，超过后将强制结束'),
    trustAICommand: z.boolean().default(false).describe('完全信任AI|开启后AI调用的全部命令均直接执行，无需用户确认且无视白名单'),
    enableMarkdownProcess: z.boolean().default(true).describe('处理Markdown消息|开启后会对Markdown消息进行处理（短文本去除格式、长文本转图片），关闭则直接原样发送'),
    markdownPlainTextLimit: z.number().int().min(0).default(300).describe('Markdown纯文本字数阈值|开启Markdown处理后，低于此字数的消息会去除Markdown格式以纯文本发送，超过则渲染为图片'),
    markdownSplitImageLimit: z.number().int().min(0).default(0).describe('Markdown分图阈值|大于0且Markdown长度达到此字数时，尝试拆成两张图片发送；0表示关闭'),
}).superRefine((config, ctx) => {
    const seen = new Set();
    config.profiles.forEach((profile, profileIndex) => {
        profile.prefixes.forEach((prefix, prefixIndex) => {
            if (seen.has(prefix)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['profiles', profileIndex, 'prefixes', prefixIndex],
                    message: `触发前缀“${prefix}”重复`,
                });
            }
            seen.add(prefix);
        });
    });
}).describe('AI 对话设定');

export const TavilyMCPSchema = z.object({
    apiKey: z.string().default('').describe('API Key|Tavily Remote MCP API Key'),
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

const ImageGeminiChannelSchema = z.object({
    name: z.string().default('gemini-image').describe('渠道名称'),
    model: z.string().default('gemini-3-pro-image-preview').describe('生图模型'),
    api: z.string().default('').describe('API Key'),
    baseURL: z.string().default('').describe('自定义URL|留空使用默认地址'),
});

const ImageOpenAIChannelSchema = z.object({
    name: z.string().default('openai-image').describe('渠道名称'),
    baseURL: z.string().default('https://api.openai.com/v1').describe('API地址'),
    api: z.string().default('').describe('API Key'),
    model: z.string().default('gpt-image-2').describe('生图模型'),
});

const ImageGrokChannelSchema = z.object({
    name: z.string().default('grok-image').describe('渠道名称'),
    baseURL: z.string().default('http://127.0.0.1:8317/v1').describe('API地址|Grok OpenAI 兼容媒体接口地址'),
    api: z.string().default('').describe('API Key|接口未启用鉴权时可留空'),
    model: z.string().default('grok-imagine-image-quality').describe('生图模型'),
});

const ImageVertexChannelSchema = z.object({
    name: z.string().default('vertex-image').describe('渠道名称'),
    model: z.string().default('gemini-3-pro-image-preview').describe('生图模型'),
    serviceAccountRef: z.string().trim().default('').describe('服务账号|#vertexCredentialSelect|选择已导入并验证的 Vertex 服务账号 JSON'),
    baseURL: z.string().default('').describe('自定义URL|留空使用 Vertex 默认地址'),
});

function migrateImageChannelsConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

    const config = { ...value };
    const hasGeminiChannels = Array.isArray(config.gemini);
    const geminiChannels = hasGeminiChannels ? config.gemini : [];
    const legacyVertexChannels = geminiChannels.filter((channel) => channel?.vertex === true);

    if (hasGeminiChannels) {
        config.gemini = geminiChannels.filter((channel) => channel?.vertex !== true);
    }
    if (!Array.isArray(config.vertex) && legacyVertexChannels.length > 0) {
        config.vertex = legacyVertexChannels.map((channel) => ({
            name: channel.name,
            model: channel.model,
            serviceAccountRef: channel.serviceAccountRef || channel.credentialRef || '',
            baseURL: channel.baseURL || '',
        }));
    }

    return config;
}

const VideoGrokChannelSchema = z.object({
    name: z.string().default('grok-video').describe('渠道名称'),
    baseURL: z.string().default('http://127.0.0.1:8317/v1').describe('Grok 网关地址|本地 Grok OAuth 网关的 /v1 接口地址'),
    api: z.string().default('').describe('Grok 网关密钥|本地 Grok OAuth 网关的 Bearer API Key；网关未启用鉴权时可留空'),
    model: z.string().default('grok-imagine-video').describe('视频生成模型|grok-imagine-video-1.5-preview 无参考图时会自动改用 grok-imagine-video'),
    pollIntervalMs: z.number().int().min(1000).default(5000).describe('轮询间隔|单位毫秒，用于查询 Grok 视频生成结果'),
    timeoutMs: z.number().int().min(30000).default(900000).describe('等待超时|单位毫秒，超过后停止等待视频生成'),
    preferNativeVideo: z.boolean().default(true).describe('优先原生接口|开启后使用 /videos/generations，可透传 xAI 原生参数'),
});

const VideoGeminiChannelSchema = z.object({
    name: z.string().default('gemini-video').describe('渠道名称'),
    model: z.string().default('gemini-omni-flash-preview').describe('视频生成模型'),
    serviceAccountRef: z.string().trim().default('').describe('服务账号|#vertexCredentialSelect|选择已导入并验证的 Vertex 服务账号 JSON'),
    baseURL: z.string().default('').describe('自定义URL|留空使用 Vertex global 默认地址'),
    timeoutMs: z.number().int().min(30000).default(900000).describe('等待超时|单位毫秒，超过后停止等待视频生成'),
});

function migrateVideoChannelsConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (Array.isArray(value.grok) || Array.isArray(value.gemini)) return value;

    const hasLegacyGrokConfig = [
        'baseURL',
        'baseUrl',
        'apiKey',
        'api',
        'videoModel',
        'pollIntervalMs',
        'timeoutMs',
        'preferNativeVideo',
    ].some((key) => Object.hasOwn(value, key));

    if (!hasLegacyGrokConfig) return value;
    return {
        grok: [{
            name: 'grok-video',
            baseURL: value.baseURL || value.baseUrl,
            api: value.apiKey || value.api,
            model: value.videoModel,
            pollIntervalMs: value.pollIntervalMs,
            timeoutMs: value.timeoutMs,
            preferNativeVideo: value.preferNativeVideo,
        }],
        gemini: [],
    };
}

const VideoChannelsObjectSchema = z.object({
    grok: z.array(VideoGrokChannelSchema).default([VideoGrokChannelSchema.parse({})]).describe('Grok 视频渠道|配置 Grok OpenAI 兼容视频生成渠道'),
    gemini: z.array(VideoGeminiChannelSchema).default([]).describe('Gemini Omni 视频渠道|使用 Vertex 服务账号凭证'),
}).superRefine((config, ctx) => {
    const seen = new Map();
    for (const type of ['grok', 'gemini']) {
        config[type].forEach((channel, index) => {
            const name = channel?.name?.trim();
            if (!name) {
                ctx.addIssue({
                    code: 'custom',
                    path: [type, index, 'name'],
                    message: '渠道名称不能为空',
                });
                return;
            }
            if (seen.has(name)) {
                ctx.addIssue({
                    code: 'custom',
                    path: [type, index, 'name'],
                    message: `渠道名称“${name}”与 ${seen.get(name)} 重复`,
                });
                return;
            }
            seen.set(name, `${type} 渠道`);
        });
    }
}).describe('视频渠道管理');

export const CliProxyMediaSchema = z.preprocess(
    migrateVideoChannelsConfig,
    VideoChannelsObjectSchema
);

const CredentialSchema = z.object({
    id: nonEmptyString('凭据 ID').describe('凭据 ID|供应商内唯一'),
    apiKey: z.string().trim().default('').describe('API Key|OpenAI 和 Gemini Developer API 使用'),
    serviceAccountRef: z.string().trim().default('').describe('服务账号|#vertexCredentialSelect|Vertex AI 使用；从网页导入并验证 JSON'),
    enabled: z.boolean().default(true).describe('启用'),
    priority: z.number().int().default(0).describe('优先级|数值越大越优先'),
    weight: z.number().int().min(1).default(1).describe('权重|同优先级轮询权重'),
});

const ProviderSchema = z.object({
    id: nonEmptyString('供应商 ID').describe('供应商 ID'),
    protocol: z.enum(['openai', 'gemini']).default('openai').describe('接口协议'),
    baseURL: z.string().trim().default('').describe('API 地址|留空使用对应协议的官方默认地址；自定义 OpenAI 兼容地址通常以 /v1 结尾'),
    vertex: z.boolean().default(false).describe('Vertex AI|仅 Gemini 协议使用；聊天和模型列表统一使用服务账号 JSON'),
    credentials: z.array(CredentialSchema).min(1, '至少配置一个凭据').describe('凭据池|#providerCredentials|#nameField:id'),
}).superRefine((provider, ctx) => {
    addUniqueFieldIssues(provider.credentials, 'id', ctx, ['credentials']);
    const usesVertex = provider.protocol === 'gemini' && provider.vertex === true;
    if (provider.vertex === true && provider.protocol !== 'gemini') {
        ctx.addIssue({
            code: 'custom',
            path: ['vertex'],
            message: 'Vertex AI 只能用于 Gemini 协议',
        });
    }
    provider.credentials.forEach((credential, index) => {
        const field = usesVertex ? 'serviceAccountRef' : 'apiKey';
        if (!credential[field]) {
            ctx.addIssue({
                code: 'custom',
                path: ['credentials', index, field],
                message: usesVertex ? '请选择已验证的服务账号 JSON' : 'API Key 不能为空',
            });
        }
    });
});

export const ProvidersSchema = z.object({
    providers: z.array(ProviderSchema).default([]).describe('AI 供应商|#nameField:id'),
}).superRefine((config, ctx) => {
    addUniqueFieldIssues(config.providers, 'id', ctx, ['providers']);
}).describe('AI 供应商管理');

const RouteTargetSchema = z.object({
    id: nonEmptyString('目标 ID').describe('目标 ID|路由内唯一'),
    provider: nonEmptyString('供应商').describe('供应商|#providerSelect'),
    model: nonEmptyString('模型').describe('模型名称|#modelSelect|只能从供应商模型端点返回的列表中选择'),
    enabled: z.boolean().default(true).describe('启用'),
    priority: z.number().int().default(0).describe('优先级|数值越大越优先'),
    weight: z.number().int().min(1).default(1).describe('权重|同优先级轮询权重'),
    temperatureOverride: z.number().min(-1).max(2).default(-1).describe('温度覆盖|设为 -1 继承路由；建议不要和 Top-P 同时调整'),
    topPOverride: z.number().min(-1).max(1).default(-1).describe('Top-P 覆盖|设为 -1 继承路由；建议不要和温度同时调整'),
    openaiEnableThinking: z.boolean().default(false).describe('OpenAI 兼容思考开关|向兼容端点传入非标准 enable_thinking'),
    openaiReasoningEffort: z.enum(OPENAI_REASONING_EFFORT_OPTIONS).default('inherit').describe('OpenAI 思考等级|inherit 使用路由统一等级；default 不传 reasoning_effort'),
    geminiThinkingLevel: z.enum(GEMINI_THINKING_LEVEL_OPTIONS).default('inherit').describe('Gemini 思考等级|inherit 使用路由统一等级；default 不传 thinkingConfig'),
    geminiThinkingBudget: z.number().int().min(-2).default(-2).describe('Gemini 思考预算|-2 忽略固定预算，改用 Gemini 思考等级；等级为 inherit 时继承路由统一思考等级。-1 由模型动态决定；0 关闭；正数为固定 token 预算'),
    nativeWebSearch: z.boolean().default(false).describe('原生联网搜索|OpenAI 兼容端点传入 web_search；Gemini 3 / Vertex AI 传入 Google Search，并可与自定义工具混用'),
});

const RouteSchema = z.object({
    id: nonEmptyString('路由 ID').describe('路由 ID'),
    strategy: routingStrategy('供应商目标调度策略'),
    temperature: z.number().min(-1).max(2).default(-1).describe('默认温度|-1 使用模型默认值；建议不要和 Top-P 同时调整'),
    topP: z.number().min(-1).max(1).default(-1).describe('默认 Top-P|-1 使用模型默认值；建议不要和温度同时调整'),
    reasoningLevel: z.enum(COMMON_REASONING_LEVELS).default('default').describe('统一思考等级|Target 可转换或覆盖为供应商原生参数'),
    maxAttempts: z.number().int().min(1).default(3).describe('最大尝试次数|一次请求最多尝试的目标与 Key 组合数'),
    retryDelayMs: z.number().int().min(0).default(1000).describe('重试间隔|毫秒'),
    targets: z.array(RouteTargetSchema).min(1, '至少配置一个路由目标').describe('路由目标|#nameField:id'),
}).superRefine((route, ctx) => {
    addUniqueFieldIssues(route.targets, 'id', ctx, ['targets']);
});

export const RoutesSchema = z.object({
    routes: z.array(RouteSchema).default([]).describe('逻辑模型路由|#nameField:id'),
}).superRefine((config, ctx) => {
    addUniqueFieldIssues(config.routes, 'id', ctx, ['routes']);
}).describe('AI 路由管理');

const ImageChannelsObjectSchema = z.object({
    openai: z.array(ImageOpenAIChannelSchema).default([ImageOpenAIChannelSchema.parse({})]).describe('OpenAI 生图渠道|配置 OpenAI 图片生成渠道'),
    grok: z.array(ImageGrokChannelSchema).default([ImageGrokChannelSchema.parse({})]).describe('Grok 生图渠道|配置 Grok OpenAI 兼容图片生成渠道'),
    gemini: z.array(ImageGeminiChannelSchema).default([ImageGeminiChannelSchema.parse({})]).describe('Gemini 生图渠道|使用 Gemini Developer API Key'),
    vertex: z.array(ImageVertexChannelSchema).default([]).describe('Vertex 生图渠道|使用已导入的 Vertex 服务账号凭证'),
}).superRefine((config, ctx) => {
    const seen = new Map();
    for (const type of ['openai', 'grok', 'gemini', 'vertex']) {
        config[type].forEach((channel, index) => {
            const name = channel?.name?.trim();
            if (!name) {
                ctx.addIssue({
                    code: 'custom',
                    path: [type, index, 'name'],
                    message: '渠道名称不能为空',
                });
                return;
            }
            if (seen.has(name)) {
                ctx.addIssue({
                    code: 'custom',
                    path: [type, index, 'name'],
                    message: `渠道名称“${name}”与 ${seen.get(name)} 重复`,
                });
                return;
            }
            seen.set(name, `${type} 渠道`);
        });
    }
}).describe('生图渠道管理');

export const ImageChannelsSchema = z.preprocess(
    migrateImageChannelsConfig,
    ImageChannelsObjectSchema
);

const EditTaskSchema = z.object({
    trigger: z.string().default('').describe('触发词|图片编辑触发词'),
    prompt: z.string().default('').describe('提示词|#textarea|图片编辑指令'),
});

export const EditImageSchema = z.object({
    imageChannel: z.string().default('').describe('生图渠道|#imageChannelSelect|从生图渠道管理中选择'),
    videoChannel: z.string().default('grok-video').describe('视频渠道|#videoChannelSelect|从视频渠道管理中选择'),
    tasks: z.array(EditTaskSchema).default([]).describe('编辑指令列表|配置自定义的图片编辑指令'),
}).describe('图片生成与编辑');

export const EmojiThiefSchema = z.object({
    Groups: z.array(z.number()).default([]).describe('启用群号|#groupSelect|在这些群中启用表情包学习'),
    rate: z.number().default(1).describe('回复概率|触发回复的概率'),
    vectorRate: z.number().default(0.1).describe('矢量概率|#step:0.01|学习表情的概率'),
}).describe('表情包学习');


const VoxCPMVoiceRoleSchema = z.object({
    name: z.string().default('少女').describe('角色名|触发方式：角色名说 内容，可加 # 前缀'),
    prompt: z.string().default('一个可爱的少女').describe('声音描述|#textarea|作为 VoxCPM 的 Control Instruction，可留空仅使用参考语音'),
    referenceAudioPath: z.string().default('').describe('参考语音路径|添加角色时可自动保存到 data/voxcpm-voice/roles'),
});

export const VoxCPMVoiceSchema = z.object({
    defaultRole: z.string().default('少女').describe('默认角色名|#voiceRoleSelect|未指定角色时使用，例如“说 内容”；从角色列表中读取同名配置'),
    aiDefaultRole: z.string().default('少女').describe('AI默认角色名|#voiceRoleSelect|AI工具发送语音时固定使用；从角色列表中读取同名配置'),
    roles: z.array(VoxCPMVoiceRoleSchema).default([
        { name: '少女', prompt: '一个可爱的少女', referenceAudioPath: '' },
    ]).describe('角色列表|#nameField:name|配置“角色名说 内容”的角色声音描述；未指定角色时可用“说 内容”'),
}).describe('VoxCPM 语音生成');

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
    chatDrawPrompt: z.string().default(`**[Visual Snapshot Instruction]**
Generate a strictly visual description tag <draw>...</draw> at the end of your response to represent your current visual state.

You must focus on describing your appearance, outfit, and current dynamic elements.

1. **Character Identity**: If you are a known character from an anime/game, you MUST start the tag with your English Danbooru character tag (e.g., izumi sagiri, hatsune miku). Otherwise, use 1girl or 1boy.
2. **Clothing**: What outfits or accessories are you wearing right now?
3. **Dynamic Action**: What are you doing right now? (e.g., reaching out, running, sitting with legs crossed)
4. **Expression**: Detailed facial emotion. (e.g., tears in eyes, wide grin, blushing)
5. **Camera & Composition**: How is the scene shot? (e.g., close-up, dutch angle, looking at viewer, cinematic lighting)
6. **Environment**: Immediate surroundings. (e.g., rain-soaked street, cozy bedroom, burning ruins)

**Format Constraint**:
- Use Danbooru-style tags or short descriptive English phrases, separated by commas. MUST be in English.
- **DO NOT** describe your basic physical traits (hair color, eye color) unless altered by the situation.

**Example**:
<draw>izumi sagiri, pink pajamas, leaning against the wall, arms crossed, skeptical expression, looking to the side, dimly lit bedroom, cowboy shot</draw>`).describe('聊天自动绘图指令|#textarea|角色开启NAI绘图时追加到系统提示词；留空则不追加'),
}).describe('NovelAI 绘画');

const CommandCostSchema = z.object({
    command: z.string().describe('指令名称'),
    cost: z.number().int().min(0).default(0).describe('消耗樱花币'),
});

const defaultCommandCosts = [
    { command: "来张涩图", cost: 5 },
    { command: "来张萝莉图", cost: 5 },
    { command: "视频生成", cost: 20 },
    { command: "B站UID分析", cost: 5 },
    { command: "添加词条", cost: 50 },
    { command: "删除词条", cost: 50 },
    { command: "表情包制作", cost: 5 },
    { command: "随机表情包", cost: 5 },
    { command: "pid（P站搜图）", cost: 5 },
    { command: "来张插画", cost: 5 },
    { command: "AI聊天", cost: 10 },
    { command: "AI图片编辑", cost: 20 },
    { command: "绘图", cost: 30 },
    { command: "拟态回复", cost: 10 },
    { command: "语音生成", cost: 5 },
    { command: "p站排行榜", cost: 20 },
    { command: "p站排行榜详情", cost: 5 },
    { command: "搜图", cost: 5 },
];

function migrateEconomyConfig(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.commandCosts)) return value;
    const hasCurrentVideoCost = value.commandCosts.some((item) => item?.command === '视频生成');
    const commandCosts = value.commandCosts
        .filter((item) => !(hasCurrentVideoCost && item?.command === 'gv（Grok视频生成）'))
        .map((item) => item?.command === 'gv（Grok视频生成）'
            ? { ...item, command: '视频生成' }
            : item);
    return { ...value, commandCosts };
}

const EconomyObjectSchema = z.object({
    enable: z.boolean().default(true).describe('启用经济系统'),
    Groups: z.array(z.number()).default([]).describe('经济群号|#groupSelect|启用后指令将消耗樱花币'),
    gamegroups: z.array(z.number()).default([]).describe('游戏群号|#groupSelect|启用经济游戏功能的群'),
    commandCosts: z.array(CommandCostSchema).default(defaultCommandCosts).describe('指令消耗配置|#commandCost|配置各指令消耗的樱花币数量'),
}).describe('经济系统');

export const EconomySchema = z.preprocess(migrateEconomyConfig, EconomyObjectSchema);

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
    route: z.string().default('default').describe('模型路由|#routeSelect'),
    toolGroup: z.string().default('').describe('工具组|#toolGroupSelect|选择此群使用的工具组'),
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
    route: z.string().default('default').describe('模型路由|#routeSelect'),
    toolGroup: z.string().default('').describe('工具组|#toolGroupSelect|选择伪人使用的工具组'),
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
    name: nonEmptyString('角色名称').describe('角色名称'),
    prompt: z.string().default('').describe('角色提示词|#textarea|定义此角色的系统提示词'),
});

export const RolesSchema = z.object({
    roles: z.array(RoleSchema).default([]).describe('角色列表|预设的AI角色模板'),
}).superRefine((config, ctx) => {
    addUniqueFieldIssues(config.roles, 'name', ctx, ['roles']);
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
    'GroupInsight': GroupInsightSchema,
    'AI': AISchema,
    'TavilyMCP': TavilyMCPSchema,
    'ActiveChat': ActiveChatSchema,
    'AutoCleanup': AutoCleanupSchema,
    'Providers': ProvidersSchema,
    'Routes': RoutesSchema,
    'CliProxyMedia': CliProxyMediaSchema,
    'ImageChannels': ImageChannelsSchema,
    'EditImage': EditImageSchema,
    'EmojiThief': EmojiThiefSchema,
    'VoxCPMVoice': VoxCPMVoiceSchema,
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
    'AI路由': ['Providers', 'Routes'],
    'AI角色': ['roles'],
    'AI设定': ['AI', 'TavilyMCP', 'mimic', 'ActiveChat'],
    '戳一戳': ['poke'],
    '图片功能': ['ImageChannels', 'CliProxyMedia', 'EditImage', 'nai', 'pixiv', 'r18', 'summary', 'SearchImage', 'cool', 'teatime', 'EmojiThief'],
    '经济系统': ['economy'],
    '其他功能': ['60sNews', 'GroupInsight', 'AutoCleanup', 'forwardMessage', 'groupnotice', 'repeat', 'recall', 'bilicookie', 'VoxCPMVoice', 'reminderTask'],
};

export const schemaLabels = {
    'TavilyMCP': 'Tavily MCP',
    'bot': '机器人基础设定',
    '60sNews': '60秒新闻推送',
    'GroupInsight': '群聊洞见',
    'AI': 'AI 对话设定',
    'ActiveChat': '主动聊天',
    'AutoCleanup': '自动清理',
    'Providers': 'AI 供应商管理',
    'Routes': 'AI 路由管理',
    'CliProxyMedia': '视频渠道管理',
    'ImageChannels': '生图渠道管理',
    'EditImage': '图片生成与编辑',
    'EmojiThief': '表情偷取',
    'VoxCPMVoice': 'VoxCPM 语音生成',
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
    routeSelect: {
        label: '模型路由',
        sources: [
            { module: 'Routes', path: 'routes', valueKey: 'id' },
        ],
    },
    providerSelect: {
        label: '供应商',
        sources: [
            { module: 'Providers', path: 'providers', valueKey: 'id' },
        ],
    },
    imageChannelSelect: {
        label: '生图渠道',
        sources: [
            { module: 'ImageChannels', path: 'openai', valueKey: 'name' },
            { module: 'ImageChannels', path: 'grok', valueKey: 'name' },
            { module: 'ImageChannels', path: 'gemini', valueKey: 'name' },
            { module: 'ImageChannels', path: 'vertex', valueKey: 'name' },
        ],
    },
    videoChannelSelect: {
        label: '视频渠道',
        sources: [
            { module: 'CliProxyMedia', path: 'grok', valueKey: 'name' },
            { module: 'CliProxyMedia', path: 'gemini', valueKey: 'name' },
        ],
    },
    toolGroupSelect: {
        label: '工具组',
        sources: [
            { module: 'AI', path: 'toolGroups', valueKey: 'name' },
        ],
    },
    voiceRoleSelect: {
        label: '语音角色',
        sources: [
            { module: 'VoxCPMVoice', path: 'roles', valueKey: 'name' },
        ],
    },
};
