import { fileURLToPath, pathToFileURL } from "url";
import { basename, dirname, join } from "path";
import chalk from "chalk";
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
import { SearchFilesTool } from "./SearchFilesTool.js";
import { RunCommandTool } from "./RunCommandTool.js";
import { RunPythonTool } from "./RunPythonTool.js";
import { ReadLogTool } from "./ReadLogTool.js";
import { MemoryTool } from "./MemoryTool.js";
import { ImageSearchTool } from "./ImageSearchTool.js";
import { mcpManager } from "../MCPManager.js";
import Setting from "../../setting.js";

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
  new SearchFilesTool(), // 用于按文本内容搜索
  new RunCommandTool(),  // 文件操作交由 MCP filesystem server 处理
  new RunPythonTool(),   // 沙箱执行 Python 代码
  new ReadLogTool(),     // 读取 Bot 运行日志
  new MemoryTool(),      // 主动写入用户长期记忆
  new ImageSearchTool(), // 统一搜图工具
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
  "SearchFilesText": "SearchFiles",
  "RunCommand": "RunCommand",
  "RunPython": "RunPython",
  "ReadLog": "ReadLog",
  "Memory": "Memory",
  "ImageSearch": "ImageSearch",
};

const OWNER_ONLY_TOOLS = new Set(["SearchFilesText", "RunCommand", "ReadLog"]);

function isLocalToolEnabled(toolName, e) {
  const isMaster = Boolean(e?.isMaster);
  if (OWNER_ONLY_TOOLS.has(toolName) && !isMaster) {
    return false;
  }

  const aiConfig = Setting.getConfig("AI") || {};
  const enabledTools = aiConfig.enabledTools || {};
  const configKey = TOOL_CONFIG_KEYS[toolName];
  if (configKey && Object.prototype.hasOwnProperty.call(enabledTools, configKey)) {
    return Boolean(enabledTools[configKey]);
  }

  // 配置缺失时默认启用
  return true;
}

export async function getToolsSchema(e) {
  return availableTools
    .filter(tool => isLocalToolEnabled(tool.name, e))
    .map(tool => tool.function());
}

function buildToolStartAction(toolName) {
  switch (toolName) {
    case "SearchFilesText":
      return "内容检索";
    case "RunPython":
      return "脚本运行";
    case "RunCommand":
      return "命令运行";
    case "read_file":
    case "read_text_file":
      return "文件读取";
    case "write_file":
      return "文件写入";
    case "edit_file":
      return "文件修改";
    case "list_directory":
      return "目录查看";
    case "search_files":
      return "文件搜索";
    case "delete_file":
      return "文件删除";
    case "move_file":
      return "文件移动";
    case "create_directory":
      return "目录创建";
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
    case "get_file_contents":
      return "仓库读取";
    default:
      if (toolName.startsWith("puppeteer_")) return "网页访问";
      if (toolName.startsWith("github_")) return "仓库访问";
      return null;
  }
}

function shortenToolText(text, maxLength = 80) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function getToolPathLabel(filePath) {
  if (!filePath) {
    return "";
  }

  const normalized = String(filePath).replace(/[\\/]+$/, "");
  if (!normalized || normalized === ".") {
    return ".";
  }

  return basename(normalized) || normalized;
}

function buildToolStartDetail(toolName, toolArgs = {}) {
  switch (toolName) {
    case "SearchFilesText":
      return shortenToolText(toolArgs.keyword || "内容检索");
    case "RunPython":
      return shortenToolText((toolArgs.code || "").split("\n").find(Boolean) || "Python");
    case "RunCommand":
      return shortenToolText(toolArgs.command || "命令");
    case "read_file":
    case "read_text_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
    case "create_directory":
      return shortenToolText(getToolPathLabel(toolArgs.path));
    case "list_directory":
      return shortenToolText(getToolPathLabel(toolArgs.path || "."));
    case "search_files":
      return shortenToolText(toolArgs.pattern || "文件搜索");
    case "move_file":
      return shortenToolText(getToolPathLabel(toolArgs.source) || getToolPathLabel(toolArgs.destination));
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
    case "get_file_contents":
      return shortenToolText(getToolPathLabel(toolArgs.path) || `${toolArgs.owner || ""}/${toolArgs.repo || ""}`);
    default:
      if (toolName.startsWith("puppeteer_")) {
        return shortenToolText(toolArgs.url || toolName.replace("puppeteer_", ""));
      }
      if (toolName.startsWith("github_")) {
        return shortenToolText(toolArgs.path || toolArgs.repo || toolArgs.owner || toolName.replace("github_", ""));
      }
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

    await e.sendForwardMsg(
      items.map((item) => ({
          user_id: e.self_id,
          nickname: "忙碌中",
          content: [{ type: "text", data: { text: item.detail } }],
        })),
      {
        source: items.map((item) => item.action).join("|"),
        prompt: items.map((item) => item.detail).join(" | "),
        news: items.map((item) => ({ text: item.detail })),
      }
    );
  } catch (err) {
    logger.warn(`[Tools] 发送开始态可视化消息失败: ${err.message}`);
  }
}

export async function executeToolCalls(e, initialFunctionCalls) {
  if (!initialFunctionCalls || initialFunctionCalls.length === 0) {
    return [];
  }

  await sendToolStartVisual(e, initialFunctionCalls);

  const toolResponseParts = await Promise.all(
    initialFunctionCalls.map(async (functionCall) => {
      const { name: toolName, args: toolArgs, id: toolCallId } = functionCall;

      let toolResultData = null;
      const toolToExecute = toolMap.get(toolName);

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
    })
  );

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
