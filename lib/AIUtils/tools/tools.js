import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import chalk from "chalk";
import fs from "fs";
import { watch } from "chokidar";
import { GroupAdminTool } from "./GroupAdminTool.js";
import { MessageContentAnalyzerTool } from "./MessageContentAnalyzerTool.js";
import { WebSearchTool } from "./WebSearchTool.js";
import { SearchMusicTool } from "./SearchMusicTool.js";
import { ImageGeneratorTool } from "./ImageGeneratorTool.js";
import { SendMusicTool } from "./SendMusicTool.js";
import { IllustrationTool } from "./IllustrationTool.js";
import { ReminderTool } from "./ReminderTool.js";
import { BlackListTool } from "./BlackListTool.js";
import { EconomyTool } from "./EconomyTool.js";
import { EmojiTool } from "./EmojiTool.js";
import { NaiTool } from "./NaiTool.js";
import { RunCommandTool } from "./RunCommandTool.js";
import { ReadLogTool } from "./ReadLogTool.js";
import { MemoryTool } from "./MemoryTool.js";
import { ImageSearchTool } from "./ImageSearchTool.js";
import { UploadFileTool } from "./UploadFileTool.js";
import { VoxCPMVoiceTool } from "./VoxCPMVoiceTool.js";
import { mcpManager } from "../MCPManager.js";
import Setting from "../../setting.js";
import { plugindata } from "../../path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const availableTools = [
  new GroupAdminTool(),
  new MessageContentAnalyzerTool(),
  new WebSearchTool(),
  new SearchMusicTool(),
  new ImageGeneratorTool(),
  new SendMusicTool(),
  new IllustrationTool(),
  new ReminderTool(),
  new BlackListTool(),
  new EconomyTool(),
  new EmojiTool(),
  new NaiTool(),
  new RunCommandTool(),  // 通用命令执行（包含文件搜索、Python 执行等）
  new ReadLogTool(),     // 读取 Bot 运行日志
  new MemoryTool(),      // 主动写入用户长期记忆
  new ImageSearchTool(), // 统一搜图工具
  new UploadFileTool(),
  new VoxCPMVoiceTool(),
];

const toolMap = new Map(availableTools.map((tool) => [tool.name, tool]));

// 工具显示名称映射到配置中的key
const TOOL_CONFIG_KEYS = {
  "GroupAdmin": "GroupAdmin",
  "messageContentAnalyzer": "MessageContentAnalyzer",
  "Search": "WebSearch",
  "searchMusic": "SearchMusic",
  "ImageGenerator": "ImageGenerator",
  "sendMusic": "SendMusic",
  "Illustration": "Illustration",
  "Reminder": "Reminder",
  "BlackList": "BlackList",
  "Economy": "Economy",
  "SendEmoji": "Emoji",
  "NaiPainting": "Nai",
  "RunCommand": "RunCommand",
  "ReadLog": "ReadLog",
  "Memory": "Memory",
  "ImageSearch": "ImageSearch",
  "UploadFile": "UploadFile",
  "SendVoice": "VoxCPMVoice",
};

const OWNER_ONLY_TOOLS = new Set(["RunCommand", "ReadLog", "UploadFile"]);

// ─── 工具执行确认机制 ──────────────────────────────────────

// 需要用户确认才能执行的工具
const CONFIRM_REQUIRED_TOOLS = new Set(["RunCommand"]);

// 命令前缀白名单（持久化到 JSON）
const WHITELIST_PATH = join(plugindata, "commandWhitelist.json");
let commandWhitelist = new Set();

function loadWhitelist() {
  try {
    const raw = fs.readFileSync(WHITELIST_PATH, "utf-8");
    const list = JSON.parse(raw);
    commandWhitelist = new Set(Array.isArray(list) ? list : []);
  } catch {
    commandWhitelist = new Set();
  }
}

function saveWhitelist() {
  try {
    fs.mkdirSync(dirname(WHITELIST_PATH), { recursive: true });
    fs.writeFileSync(WHITELIST_PATH, JSON.stringify([...commandWhitelist], null, 2), "utf-8");
  } catch (err) {
    logger.warn(`[Tools] 保存命令白名单失败: ${err.message}`);
  }
}

function getCommandPrefix(command) {
  return String(command || "").trim().split(/\s+/)[0].toLowerCase();
}

function isCommandWhitelisted(command) {
  const prefix = getCommandPrefix(command);
  return prefix && commandWhitelist.has(prefix);
}

// 启动时加载
loadWhitelist();

// 等待确认中的 Promise：key -> { resolve }
const pendingConfirmations = new Map();

function getConfirmKey(e) {
  return e.group_id ? `${e.group_id}:${e.user_id}` : `private:${e.user_id}`;
}

/**
 * 供插件的 handleToolConfirmCallback 回调调用
 * @param {object} pluginInstance - 插件实例（this）
 */
export function resolveToolConfirmation(pluginInstance) {
  const e = pluginInstance.e;
  const key = getConfirmKey(e);
  const pending = pendingConfirmations.get(key);
  if (!pending) return;

  const input = e.raw_message?.trim();
  if (input === "1") {
    pendingConfirmations.delete(key);
    pluginInstance.finish("handleToolConfirmCallback", !!e.group_id);
    pending.resolve("confirm");
  } else if (input === "2") {
    pendingConfirmations.delete(key);
    pluginInstance.finish("handleToolConfirmCallback", !!e.group_id);
    pending.resolve("always");
  } else if (input === "3") {
    pendingConfirmations.delete(key);
    pluginInstance.finish("handleToolConfirmCallback", !!e.group_id);
    pending.resolve("cancel");
  }
  // 其他输入不处理，保持上下文等待
}

/**
 * 发送确认消息并等待用户回复
 */
async function waitForConfirmation(e, pluginInstance, command) {
  const key = getConfirmKey(e);

  await e.reply(
    `⚠️ 请求执行命令：\n> ${shortenToolText(command, 200)}\n\n` +
    `1️⃣ 确认执行\n2️⃣ 确认且以后不再提示同类命令（${getCommandPrefix(command)}）\n3️⃣ 取消\n\n` +
    `60秒内未回复自动取消`
  );

  return new Promise((resolve) => {
    pendingConfirmations.set(key, { resolve });
    pluginInstance.setContext("handleToolConfirmCallback", !!e.group_id, 60, true);

    // 兜底：setContext 超时自动 finish 后 Promise 可能悬挂
    setTimeout(() => {
      if (pendingConfirmations.has(key)) {
        pendingConfirmations.delete(key);
        resolve("cancel");
      }
    }, 62000);
  });
}

// MCP config key → server ID 映射
const MCP_KEY_TO_SERVER = {
  "McpFetch": "fetch",
  "McpMemory": "memory",
  "McpTavily": "tavily",
};

// 所有可选工具（本地 + MCP）的 key 和中文 label，供前端和 API 使用
export const AVAILABLE_TOOL_OPTIONS = [
  { key: "McpTavily", label: "Tavily搜索(MCP)" },
  { key: "GroupAdmin", label: "群组管理" },
  { key: "MessageContentAnalyzer", label: "消息分析" },
  { key: "WebSearch", label: "网页搜索" },
  { key: "SearchMusic", label: "音乐搜索" },
  { key: "ImageGenerator", label: "图片生成" },
  { key: "SendMusic", label: "音乐发送" },
  { key: "Illustration", label: "插画工具" },
  { key: "Reminder", label: "提醒工具" },
  { key: "BlackList", label: "黑名单" },
  { key: "Economy", label: "经济系统" },
  { key: "Emoji", label: "表情包" },
  { key: "Nai", label: "NAI绘画" },
  { key: "RunCommand", label: "命令执行" },
  { key: "ReadLog", label: "日志读取" },
  { key: "Memory", label: "记忆工具" },
  { key: "ImageSearch", label: "图片搜索" },
  { key: "McpFetch", label: "网络请求(MCP)" },
  { key: "McpMemory", label: "知识图谱(MCP)" },
  { key: "UploadFile", label: "发送文件" },
  { key: "VoxCPMVoice", label: "语音发送" },
];

/**
 * 根据工具组名从配置中获取允许的工具 key 集合
 * @param {string} toolGroupName 工具组名
 * @returns {{ allowedTools: Set<string>, allowedMcpServerIds: string[] }}
 */
function resolveToolGroup(toolGroupName) {
  const aiConfig = Setting.getConfig("AI") || {};
  const toolGroups = aiConfig.toolGroups || [];
  const group = toolGroups.find(g => g.name === toolGroupName);
  if (!group) return { allowedTools: new Set(), allowedMcpServerIds: [] };

  const allowedTools = new Set(group.tools || []);
  const allowedMcpServerIds = [];
  for (const [mcpKey, serverId] of Object.entries(MCP_KEY_TO_SERVER)) {
    if (allowedTools.has(mcpKey)) {
      allowedMcpServerIds.push(serverId);
    }
  }
  return { allowedTools, allowedMcpServerIds };
}

export async function getToolsSchema(e, toolGroupName) {
  if (!toolGroupName) return { localTools: [], allowedMcpServerIds: [] };

  const { allowedTools, allowedMcpServerIds } = resolveToolGroup(toolGroupName);
  if (allowedTools.size === 0) return { localTools: [], allowedMcpServerIds: [] };

  const isMaster = Boolean(e?.isMaster);
  const localTools = availableTools
    .filter(tool => {
      if (OWNER_ONLY_TOOLS.has(tool.name) && !isMaster) return false;
      const configKey = TOOL_CONFIG_KEYS[tool.name];
      return configKey && allowedTools.has(configKey);
    })
    .map(tool => tool.function());

  return { localTools, allowedMcpServerIds };
}

function shortenToolText(text, maxLength = 80) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function normalizeToolAlias(toolName) {
  return String(toolName || "").replace(/-/g, "_");
}

const TAVILY_TOOL_META = {
  tavily_search: {
    action: "网页搜索",
    detail: (toolArgs = {}) => shortenToolText(toolArgs.query || toolArgs.topic || "网页搜索"),
  },
  tavily_extract: {
    action: "网页提取",
    detail: (toolArgs = {}) => shortenToolText(toolArgs.url || toolArgs.urls?.[0] || toolArgs.website || "网页"),
  },
  tavily_map: {
    action: "网站结构发现",
    detail: (toolArgs = {}) => shortenToolText(toolArgs.url || toolArgs.urls?.[0] || toolArgs.website || "网站"),
  },
  tavily_crawl: {
    action: "网站抓取",
    detail: (toolArgs = {}) => shortenToolText(toolArgs.url || toolArgs.urls?.[0] || toolArgs.website || "网站"),
  },
  tavily_research: {
    action: "深度研究",
    detail: (toolArgs = {}) => shortenToolText(toolArgs.query || toolArgs.topic || "深度研究"),
  },
  tavily_skill: {
    action: "技能搜索",
    detail: (toolArgs = {}) => shortenToolText(toolArgs.query || toolArgs.topic || "技能搜索"),
  },
};

function buildToolStartAction(toolName) {
  const tavilyTool = TAVILY_TOOL_META[normalizeToolAlias(toolName)];
  if (tavilyTool) {
    return tavilyTool.action;
  }

  switch (toolName) {
    case "RunCommand":
      return "命令运行";
    case "fetch":
      return "网络访问";
    case "create_entities":
      return "记忆写入";
    case "create_relations":
      return "记忆关联";
    case "add_observations":
      return "记忆补充";
    case "delete_entities":
    case "delete_relations":
    case "delete_observations":
      return "记忆清理";
    case "read_graph":
      return "记忆读取";
    case "search_nodes":
      return "记忆检索";
    case "open_nodes":
      return "记忆查看";
    default:
      return null;
  }
}

function buildToolStartDetail(toolName, toolArgs = {}) {
  const tavilyTool = TAVILY_TOOL_META[normalizeToolAlias(toolName)];
  if (tavilyTool) {
    return tavilyTool.detail(toolArgs);
  }

  switch (toolName) {
    case "RunCommand":
      return shortenToolText(toolArgs.command || "命令");
    case "fetch":
      return shortenToolText(toolArgs.url || "网络请求");
    case "create_entities": {
      const names = Array.isArray(toolArgs.entities) ? toolArgs.entities.map(item => item?.name).filter(Boolean) : [];
      return shortenToolText(names[0] || "实体");
    }
    case "create_relations": {
      const relation = Array.isArray(toolArgs.relations) ? toolArgs.relations[0] : null;
      const label = relation ? `${relation.from || "节点"} -> ${relation.to || "节点"}` : "关系";
      return shortenToolText(label);
    }
    case "add_observations":
      return shortenToolText(toolArgs.observations?.[0]?.content || toolArgs.observations?.[0] || "观察记录");
    case "delete_entities":
      return shortenToolText(toolArgs.entityNames?.[0] || "实体");
    case "delete_relations":
      return shortenToolText("关系");
    case "delete_observations":
      return shortenToolText("观察记录");
    case "read_graph":
      return "知识图谱";
    case "search_nodes":
      return shortenToolText(toolArgs.query || "节点");
    case "open_nodes":
      return shortenToolText(toolArgs.names?.[0] || "节点");
    default:
      return "";
  }
}

function buildToolStartVisualItem(toolName, toolArgs = {}) {
  const action = buildToolStartAction(toolName);
  if (!action) {
    return null;
  }

  return {
    action,
    detail: buildToolStartDetail(toolName, toolArgs) || action,
  };
}

async function sendToolStartVisual(e, functionCalls = []) {
  try {
    if (!e?.sendForwardMsg) {
      return;
    }

    const items = functionCalls
      .map(({ name, args }) => buildToolStartVisualItem(name, args))
      .filter(Boolean);

    if (items.length === 0) {
      return;
    }

    const sourceActions = [...new Set(items.map((item) => item.action))];

    await e.sendForwardMsg(
      items.map((item) => ({
          user_id: e.self_id,
          nickname: "忙碌中",
          content: [{ type: "text", data: { text: item.detail } }],
        })),
      {
        source: sourceActions.join("|"),
        prompt: items.map((item) => item.detail).join(" | "),
        news: items.map((item) => ({ text: item.detail })),
      }
    );
  } catch (err) {
    logger.warn(`[Tools] 发送开始态可视化消息失败: ${err.message}`);
  }
}

/**
 * 执行单个工具调用
 */
async function executeSingleTool(functionCall, e, pluginInstance) {
  const { name: toolName, args: toolArgs, id: toolCallId } = functionCall;

  let toolResultData = null;
  const toolToExecute = toolMap.get(toolName);

  // ── 确认拦截 ──
  if (
    CONFIRM_REQUIRED_TOOLS.has(toolName) &&
    pluginInstance
  ) {
    const aiConfig = Setting.getConfig('AI') || {};
    const isTrustAICommand = aiConfig.trustAICommand === true;

    const commandText = toolArgs?.command || JSON.stringify(toolArgs);

    // 检查是否开启完全信任AI，或命令前缀是否已在白名单中
    if (!isTrustAICommand && !isCommandWhitelisted(commandText)) {
      const decision = await waitForConfirmation(e, pluginInstance, commandText);

      if (decision === "always") {
        const prefix = getCommandPrefix(commandText);
        commandWhitelist.add(prefix);
        saveWhitelist();
        logger.info(`[Tools] 命令前缀 "${prefix}" 已加入白名单`);
      } else if (decision === "cancel") {
        logger.info(`[Tools] 用户取消了工具 "${toolName}" 的执行`);
        toolResultData = { message: "用户取消了命令执行。" };

        const part = {
          functionResponse: { name: String(toolName), response: toolResultData },
        };
        if (toolCallId) part.functionResponse.id = toolCallId;
        return part;
      }
      // confirm / always → 继续执行
    }
  }

  if (toolToExecute) {
    logger.info(`正在执行工具："${toolName}" ${JSON.stringify(toolArgs)}`);
    try {
      const rawResult = await toolToExecute.func(toolArgs, e);

      if (typeof rawResult === "string") {
        toolResultData = { message: rawResult };
      } else {
        toolResultData = JSON.parse(JSON.stringify(rawResult || {}));
      }
    } catch (toolError) {
      logger.error(`工具 "${toolName}" 执行失败:`, toolError);
      toolResultData = {
        error: `工具执行失败: ${toolError.message || "未知错误"}`,
      };
    }
  } else {
    // 尝试通过 MCP 执行
    logger.info(`尝试通过 MCP 执行工具："${toolName}"`);
    try {
      const rawResult = await mcpManager.callTool(toolName, toolArgs, Boolean(e?.isMaster));
      toolResultData = { message: rawResult };
    } catch (mcpError) {
      logger.warn(`MCP 工具 "${toolName}" 执行失败: ${mcpError.message}`);
      toolResultData = { error: `MCP 工具执行失败: ${mcpError.message}` };
    }
  }

  const functionResponsePart = {
    functionResponse: {
      name: String(toolName),
      response: toolResultData,
    },
  };

  if (toolCallId) {
    functionResponsePart.functionResponse.id = toolCallId;
  }

  logger.info(
    `${toolName}工具执行结果: ${JSON.stringify(
      functionResponsePart,
      null,
      2
    )}`
  );

  return functionResponsePart;
}

export async function executeToolCalls(e, initialFunctionCalls, pluginInstance = null) {
  if (!initialFunctionCalls || initialFunctionCalls.length === 0) {
    return [];
  }

  await sendToolStartVisual(e, initialFunctionCalls);

  // 如果有需要确认的工具（且命令不在白名单），改为顺序执行
  const needsConfirm = pluginInstance && initialFunctionCalls.some(
    fc => CONFIRM_REQUIRED_TOOLS.has(fc.name) && toolMap.has(fc.name) && !isCommandWhitelisted(fc.args?.command)
  );

  let toolResponseParts;
  if (needsConfirm) {
    toolResponseParts = [];
    for (const fc of initialFunctionCalls) {
      toolResponseParts.push(await executeSingleTool(fc, e, pluginInstance));
    }
  } else {
    toolResponseParts = await Promise.all(
      initialFunctionCalls.map(fc => executeSingleTool(fc, e, pluginInstance))
    );
  }

  if (toolResponseParts.length > 0) {
    return [
      {
        role: "function",
        parts: toolResponseParts,
      },
    ];
  }

  return [];
}

// ─── 热重载 ──────────────────────────────────────────────

const IGNORED_FILES = new Set(["tools.js", "AbstractTool.js"]);

/**
 * 动态重载单个工具文件
 * 利用 import() 的 query-string 绕过 ESM 模块缓存
 */
async function reloadTool(filename) {
  const filePath = join(__dirname, filename);
  const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;

  const mod = await import(fileUrl);

  // 约定：每个文件导出一个名称以 Tool 结尾的类
  const ToolClass = Object.values(mod).find(
    (v) => typeof v === "function" && /Tool$/.test(v.name)
  );
  if (!ToolClass) {
    logger.warn(chalk.yellow(`[Tools] ${filename} 中未找到 *Tool 类，跳过`));
    return;
  }

  const instance = new ToolClass();
  if (!instance.name) {
    logger.warn(chalk.yellow(`[Tools] ${filename} 实例缺少 name 属性，跳过`));
    return;
  }

  const idx = availableTools.findIndex((t) => t.name === instance.name);
  if (idx !== -1) {
    availableTools[idx] = instance;
    toolMap.set(instance.name, instance);
    logger.info(
      chalk.green(`[Tools] 🔄 已重载: ${chalk.bold(instance.name)} (${filename})`)
    );
  } else {
    availableTools.push(instance);
    toolMap.set(instance.name, instance);
    logger.info(
      chalk.cyan(`[Tools] ➕ 新工具已加载: ${chalk.bold(instance.name)} (${filename})`)
    );
  }
}

/**
 * 启动热重载 —— 使用 chokidar 监听当前 tools 目录，自动刷新变更的工具
 */
function setupTools() {
  try {
    const debounceMap = new Map();

    const handleChange = (filePath) => {
      const filename = filePath.split(/[\\/]/).pop();
      if (!filename?.endsWith(".js") || IGNORED_FILES.has(filename)) return;

      // 防抖 500ms，编辑器连续保存时只触发一次
      if (debounceMap.has(filename)) clearTimeout(debounceMap.get(filename));

      debounceMap.set(
        filename,
        setTimeout(async () => {
          debounceMap.delete(filename);
          try {
            await reloadTool(filename);
          } catch (err) {
            logger.error(
              chalk.red(`[Tools] ❌ 重载失败 ${filename}: ${err.message}`)
            );
          }
        }, 500)
      );
    };

    const watcher = watch(join(__dirname, "*.js"), {
      ignoreInitial: true,
      persistent: false,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
    });

    watcher
      .on("change", handleChange)
      .on("add", handleChange);

  } catch (err) {
    logger.warn(chalk.red("[Tools] 启动失败: " + err.message));
  }
}

setupTools();
