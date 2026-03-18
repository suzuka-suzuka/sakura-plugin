import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
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
  "MessageContentAnalyzer": "MessageContentAnalyzer",
  "WebSearch": "WebSearch",
  "SearchMusic": "SearchMusic",
  "ImageGenerator": "ImageGenerator",
  "SendMusic": "SendMusic",
  "Illustration": "Illustration",
  "Reminder": "Reminder",
  "BlackList": "BlackList",
  "Economy": "Economy",
  "Emoji": "Emoji",
  "Nai": "Nai",
  "SearchFilesText": "SearchFiles",
  "RunCommand": "RunCommand",
  "RunPython": "RunPython",
  "ReadLog": "ReadLog",
  "Memory": "Memory",
  "ImageSearch": "ImageSearch",
};

// 仅主人可见/可执行的本地工具
const OWNER_ONLY_TOOLS = new Set(["SearchFilesText", "RunCommand", "ReadLog"]);

export async function getToolsSchema(e) {
  const isMaster = Boolean(e?.isMaster);
  const aiConfig = Setting.getConfig("AI") || {};
  const enabledTools = aiConfig.enabledTools || {};
  
  return availableTools
    .filter(tool => {
      // 主人权限检查
      if (OWNER_ONLY_TOOLS.has(tool.name) && !isMaster) {
        return false;
      }
      // 配置开关检查
      const configKey = TOOL_CONFIG_KEYS[tool.name];
      if (configKey && enabledTools.hasOwnProperty(configKey)) {
        return enabledTools[configKey];
      }
      // 默认启用
      return true;
    })
    .map(tool => tool.function());
}

// 需要可视化输出的工具集合（本地工具 + MCP 工具）
const FILE_TOOLS = new Set(["SearchFilesText", "RunCommand", "RunPython"]);

/**
 * 生成工具调用的"进行中"描述文本（用于 news 预览）
 */
function buildToolActionNews(toolName, toolArgs) {
  switch (toolName) {
    // ── 本地工具 ──────────────────────────────────────────
    case "SearchFilesText":
      return `🔍 全文搜索: "${toolArgs.keyword}"${toolArgs.path ? ` in ${toolArgs.path}` : ''}`;
    case "RunPython":
      return `🐍 执行 Python: ${(toolArgs.code || '').split('\n')[0].slice(0, 50)}`;
    case "RunCommand":
      return `⚡ 执行命令: ${toolArgs.command}`;

    // ── MCP filesystem ────────────────────────────────────
    case "read_file":
    case "read_text_file":
      return `📖 读取文件: ${toolArgs.path}`;
    case "write_file":
      return `💾 写入文件: ${toolArgs.path}`;
    case "edit_file":
      return `✏️ 修改文件: ${toolArgs.path}`;
    case "list_directory":
      return `📁 列出目录: ${toolArgs.path || '.'}`;
    case "search_files":
      return `🔍 文件名匹配: "${toolArgs.pattern}" in ${toolArgs.path || '.'}`;
    case "delete_file":
      return `🗑️ 删除文件: ${toolArgs.path}`;
    case "move_file":
      return `🚚 移动文件: ${toolArgs.source || '?'} -> ${toolArgs.destination || '?'}`;
    case "create_directory":
      return `📁 创建目录: ${toolArgs.path}`;

    // ── MCP fetch ─────────────────────────────────────────
    case "fetch":
      return `🌐 网络请求: ${toolArgs.url}`;

    // ── MCP memory ────────────────────────────────────────
    case "create_entities":
      return `🧠 记忆: 创建 ${toolArgs.entities?.length ?? 1} 个实体`;
    case "create_relations":
      return `🧠 记忆: 建立 ${toolArgs.relations?.length ?? 1} 条关系`;
    case "add_observations":
      return `🧠 记忆: 添加观察记录`;
    case "delete_entities":
      return `🧠 记忆: 删除实体`;
    case "delete_relations":
      return `🧠 记忆: 删除关系`;
    case "delete_observations":
      return `🧠 记忆: 删除观察记录`;
    case "read_graph":
      return `🧠 记忆: 读取知识图谱`;
    case "search_nodes":
      return `🧠 记忆: 搜索节点 "${toolArgs.query || ''}"`;
    case "open_nodes":
      return `🧠 记忆: 打开节点 ${Array.isArray(toolArgs.names) ? toolArgs.names.join(', ') : ''}`;

    // ── MCP github ────────────────────────────────────────
    case "get_file_contents":
      return `📖 GitHub 读取文件: ${toolArgs.owner || ''}/${toolArgs.repo || ''} ${toolArgs.path || ''}`;

    // ── MCP puppeteer ─────────────────────────────────────
    default:
      if (toolName.startsWith("puppeteer_")) return `🌐 网页交互: ${toolName.replace('puppeteer_', '')} ${toolArgs.url || ''}`;
      if (toolName.startsWith("github_")) return `🐱 GitHub操作: ${toolName.replace('github_', '')} ${toolArgs.repo || toolArgs.owner || ''}`;
      return `🔧 MCP 工具: ${toolName}`;
  }
}

/**
 * 生成结果摘要（用于 news 预览）
 */
function buildResultNews(toolName, toolArgs, result) {
  const preview = typeof result === 'string' ? result.split('\n')[0].slice(0, 60) : '完成';
  const isError = preview.startsWith('错误') || preview.startsWith('失败');

  // 失败时直接显示错误原因，不用成功文案套叉
  if (isError) {
    return `❌ ${preview}`;
  }

  switch (toolName) {
    // ── 本地工具 ──────────────────────────────────────────
    case "SearchFilesText":
      return `✅ 内容检索 "${toolArgs.keyword}" 完成`;
    case "RunPython": {
      const firstLine = (toolArgs.code || '').split('\n')[0].slice(0, 40);
      return `✅ Python 执行完毕: ${firstLine}`;
    }
    case "RunCommand":
      return `✅ 命令完成: ${toolArgs.command?.slice(0, 40)}`;

    // ── MCP filesystem ────────────────────────────────────
    case "read_file":
    case "read_text_file":
      return `✅ 已读取 ${toolArgs.path}`;
    case "write_file":
    case "edit_file":
      return `✅ 已写入 ${toolArgs.path}`;
    case "list_directory":
      return `✅ 已列出 ${toolArgs.path || '.'}`;
    case "search_files":
      return `✅ 文件名搜索 "${toolArgs.pattern}" 完成`;
    case "delete_file":
      return `✅ 已删除 ${toolArgs.path}`;
    case "move_file":
      return `✅ 已移动 ${toolArgs.source || '文件'}`;

    // ── MCP fetch ─────────────────────────────────────────
    case "fetch":
      return `✅ 网络内容已获取: ${toolArgs.url?.slice(0, 50)}`;

    // ── MCP memory ────────────────────────────────────────
    case "create_entities":
      return `✅ 记忆: 实体已创建`;
    case "create_relations":
      return `✅ 记忆: 关系已建立`;
    case "add_observations":
      return `✅ 记忆: 观察已记录`;
    case "delete_entities":
    case "delete_relations":
    case "delete_observations":
      return `✅ 记忆: 已删除`;
    case "read_graph":
      return `✅ 记忆: 知识图谱已读取`;
    case "search_nodes":
      return `✅ 记忆: 节点搜索完成`;
    case "open_nodes":
      return `✅ 记忆: 节点已打开`;

    // ── MCP github ────────────────────────────────────────
    case "get_file_contents":
      return `✅ 已读取 ${toolArgs.owner || ''}/${toolArgs.repo || ''} ${toolArgs.path || ''}`;

    // ── MCP puppeteer ─────────────────────────────────────
    default:
      if (toolName.startsWith("puppeteer_")) return `✅ 网页动作 ${toolName.replace('puppeteer_', '')} 执行完毕`;
      if (toolName.startsWith("github_")) return `✅ GitHub ${toolName.replace('github_', '')} 响应完毕`;
      return `✅ 工具 ${toolName} 执行完毕`;
  }
}

// 使用 markdown 代码块展示的工具（三层嵌套）
const MARKDOWN_TOOLS = new Set([
  "SearchFilesText",
  "RunPython",
  "read_file", "read_text_file",
  "write_file", "edit_file",
  "fetch",
  "get_file_contents",
]);

/**
 * 生成 markdown 代码块内容（三层用）
 */
function buildMarkdownContent(toolName, toolArgs, result) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const sections = [];

  // 获取文件后缀决定按什么语言高亮
  const p = toolArgs.path || '';
  const ext = p.split('.').pop() || '';
  const lang = { js: 'javascript', ts: 'typescript', py: 'python', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown', css: 'css', html: 'html', sh: 'bash' }[ext] || ext;

  if (toolName === 'RunPython') {
    const codeLines = (toolArgs.code || '').split('\n').length;
    sections.push(`## 🐍 Python 沙箱执行\n**代码** (${codeLines} 行):`);
    sections.push(`\`\`\`python\n${toolArgs.code || ''}\n\`\`\``);
    if (toolArgs.packages) {
      sections.push(`> 📦 安装包: \`${toolArgs.packages}\``);
    }
    if (result) {
      const isError = result.startsWith('❌') || result.startsWith('⏱️');
      sections.push(`**输出结果:**\n\`\`\`${isError ? 'diff' : 'text'}\n${result.slice(0, 2000)}${result.length > 2000 ? '\n... (截断)' : ''}\n\`\`\``);
    }
  } else if (toolName === 'SearchFilesText') {
    sections.push(`## 🔍 内容检索\n**关键词**: \`${toolArgs.keyword}\``);
    if (result) {
      sections.push(`\`\`\`text\n${result.slice(0, 1500)}${result.length > 1500 ? '\n... (结果截断)' : ''}\n\`\`\``);
    }
  } else if (toolName === 'read_file' || toolName === 'read_text_file') {
    const { startLine, endLine } = toolArgs;
    const range = (startLine || endLine) ? ` L${startLine ?? 1}-${endLine ?? '?'}` : '';
    sections.push(`## 📖 读取文件\n\`${p}\`${range}`);
    if (result) {
      let codeText = result;
      if (typeof result === 'string' && result.includes('==== 文件读取结果 ====')) {
        const lines = result.split('\n');
        codeText = lines.slice(lines.findIndex(l => l.includes('====')) + 1).join('\n');
      }
      sections.push(`\`\`\`${lang}\n${codeText}\n\`\`\``);
    }
  } else if (toolName === 'write_file' || toolName === 'edit_file') {
    const { startLine, endLine, content, newContent, edits } = toolArgs;
    if (toolName === 'edit_file' && edits) {
      sections.push(`## ✏️ 修改文件 (diff)\n\`${p}\` — ${edits.length} 处修改`);
    } else if (startLine && endLine) {
      sections.push(`## ✏️ 修改文件\n\`${p}\` — 替换第 **${startLine}-${endLine}** 行`);
      if (newContent) {
        sections.push(`**新内容（${newContent.split('\n').length}行）：**\n\`\`\`${lang}\n${newContent}\n\`\`\``);
      }
    } else {
      const lc = (content || '').split('\n').length;
      sections.push(`## 💾 写入文件\n\`${p}\` — 整体覆盖（${lc}行）`);
      if (content) {
        sections.push(`\`\`\`${lang}\n${content}\n\`\`\``);
      }
    }
    if (result) {
      if (String(result).includes('---') && String(result).includes('+++')) {
        sections.push(`**执行结果 Diff:**\n\`\`\`diff\n${result}\n\`\`\``);
      } else {
        sections.push(`> ${result.split('\n')[0]}`);
      }
    }
  } else if (toolName === 'fetch') {
    const url = toolArgs.url || '';
    sections.push(`## 🌐 网络请求\n**URL**: \`${url}\``);
    if (toolArgs.maxLength) sections.push(`> 最大长度: ${toolArgs.maxLength}`);
    if (result) {
      sections.push(`\`\`\`text\n${result.slice(0, 2000)}${result.length > 2000 ? '\n... (内容截断)' : ''}\n\`\`\``);
    }
  } else if (toolName === 'get_file_contents') {
    const filePath = toolArgs.path || '';
    const repo = `${toolArgs.owner || ''}/${toolArgs.repo || ''}`;
    const ref = toolArgs.ref ? ` (${toolArgs.ref})` : '';
    const fileExt = filePath.split('.').pop() || '';
    const fileLang = { js: 'javascript', ts: 'typescript', py: 'python', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown', css: 'css', html: 'html', sh: 'bash', go: 'go', rs: 'rust', java: 'java', cpp: 'cpp', c: 'c', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', toml: 'toml', xml: 'xml', sql: 'sql' }[fileExt] || fileExt;

    if (result) {
      // 检测是否为目录列表（JSON 数组）
      let parsed = null;
      try { parsed = JSON.parse(result); } catch { }

      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type && parsed[0].name) {
        // 目录列表：格式化为文件树
        sections.push(`## 📁 GitHub 目录内容\n**仓库**: \`${repo}\`${ref}\n**路径**: \`${filePath || '/'}\``);
        const formatSize = (bytes) => {
          if (!bytes && bytes !== 0) return '';
          if (bytes < 1024) return `${bytes}B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
          return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
        };
        const lines = parsed.map(item => {
          const icon = item.type === 'dir' ? '📁' : '📄';
          const size = item.type === 'file' && item.size ? ` (${formatSize(item.size)})` : '';
          return `${icon} ${item.name}${size}`;
        });
        sections.push(lines.join('\n'));
        sections.push(`> 共 ${parsed.filter(i => i.type === 'dir').length} 个目录, ${parsed.filter(i => i.type === 'file').length} 个文件`);
      } else {
        // 文件内容：代码高亮显示
        sections.push(`## 📖 GitHub 文件内容\n**仓库**: \`${repo}\`${ref}\n**路径**: \`${filePath}\``);
        sections.push(`\`\`\`${fileLang}\n${result}\n\`\`\``);
      }
    } else {
      sections.push(`## 📖 GitHub 文件内容\n**仓库**: \`${repo}\`${ref}\n**路径**: \`${filePath}\``);
    }
  }

  sections.push(`---\n*[${ts}] 执行完毕*`);
  return sections.join('\n\n');
}

/**
 * 生成其他工具的纯文本日志（两层用）
 */
function buildPlainContent(toolName, toolArgs, result) {
  const lines = [];
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  switch (toolName) {
    case "RunCommand": {
      const { command, cwd } = toolArgs;
      lines.push(`$ ${command}${cwd && cwd !== '.' ? `  (cwd: ${cwd})` : ''}`);
      break;
    }
    case "list_directory":
      lines.push(`$ list_directory "${toolArgs.path || '.'}"${toolArgs.depth != null ? ` --depth ${toolArgs.depth}` : ''}`);
      break;
    case "search_files": {
      const { pattern, path: p } = toolArgs;
      lines.push(`$ search_files "${pattern}"${p ? ` --path "${p}"` : ''}`);
      break;
    }
    case "delete_file":
      lines.push(`$ delete_file "${toolArgs.path}"`);
      break;
    case "move_file":
      lines.push(`$ move_file "${toolArgs.source}" -> "${toolArgs.destination}"`);
      break;
    case "create_directory":
      lines.push(`$ create_directory "${toolArgs.path}"`);
      break;
    // ── memory 工具 ────────────────────────────────────────
    case "create_entities": {
      const names = toolArgs.entities?.map(e => e.name).join(', ') || '';
      lines.push(`🧠 create_entities: ${names}`);
      break;
    }
    case "create_relations": {
      const rels = toolArgs.relations?.map(r => `${r.from} -[${r.relationType}]-> ${r.to}`).join('\n') || '';
      lines.push(`🧠 create_relations:\n${rels}`);
      break;
    }
    case "add_observations":
      lines.push(`🧠 add_observations`);
      break;
    case "delete_entities": {
      const names = Array.isArray(toolArgs.entityNames) ? toolArgs.entityNames.join(', ') : '';
      lines.push(`🧠 delete_entities: ${names}`);
      break;
    }
    case "delete_relations":
      lines.push(`🧠 delete_relations`);
      break;
    case "delete_observations":
      lines.push(`🧠 delete_observations`);
      break;
    case "read_graph":
      lines.push(`🧠 read_graph (完整知识图谱)`);
      break;
    case "search_nodes":
      lines.push(`🧠 search_nodes: "${toolArgs.query || ''}"`);
      break;
    case "open_nodes": {
      const names = Array.isArray(toolArgs.names) ? toolArgs.names.join(', ') : '';
      lines.push(`🧠 open_nodes: ${names}`);
      break;
    }
    default:
      lines.push(`$ ${toolName}`);
  }

  if (result) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const resultLines = resultStr.split('\n');
    lines.push('');
    lines.push(resultLines.slice(0, 30).join('\n') + (resultLines.length > 30 ? `\n... (共${resultLines.length}行，仅显示前30行)` : ''));
  }

  lines.push('');
  lines.push(`[${ts}] 执行完毕`);
  return lines.join('\n');
}

/**
 * 向群/私聊发送工具执行可视化转发消息
 * - MARKDOWN_TOOLS：三层嵌套 markdown 代码块
 * - 其他工具：两层普通文本
 */
async function sendToolVisual(e, toolName, toolArgs, result) {
  try {
    const actionNews = buildToolActionNews(toolName, toolArgs);
    const resultNews = buildResultNews(toolName, toolArgs, result);
    const botId = e.self_id;

    if (MARKDOWN_TOOLS.has(toolName)) {
      // 三层嵌套：外层节点 → 内层节点 → markdown
      const markdownText = buildMarkdownContent(toolName, toolArgs, result);
      const layer3 = {
        type: 'node',
        data: {
          user_id: botId,
          nickname: '📄 文件内容',
          content: [{ type: 'markdown', data: { content: markdownText } }],
        },
      };
      const outerNodes = [
        {
          user_id: botId,
          nickname: '🛠️ 工具执行日志',
          content: [layer3],
        },
      ];
      await e.sendForwardMsg(outerNodes, {
        source: '工具执行',
        prompt: actionNews,
        news: [{ text: actionNews }, { text: resultNews }],
      });
    } else {
      // 两层：外层节点 → 纯文本
      const plainText = buildPlainContent(toolName, toolArgs, result);
      const nodes = [
        {
          user_id: botId,
          nickname: '🛠️ 工具执行日志',
          content: [{ type: 'text', data: { text: plainText } }],
        },
      ];
      await e.sendForwardMsg(nodes, {
        source: '工具执行',
        prompt: actionNews,
        news: [{ text: actionNews }, { text: resultNews }],
      });
    }
  } catch (err) {
    logger.warn(`[Tools] 发送工具可视化消息失败: ${err.message}`);
  }
}

export async function executeToolCalls(e, initialFunctionCalls) {
  if (!initialFunctionCalls || initialFunctionCalls.length === 0) {
    return [];
  }

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

          // 本地工具：发送可视化转发消息
          if (FILE_TOOLS.has(toolName) && e?.sendForwardMsg) {
            const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            await sendToolVisual(e, toolName, toolArgs, resultStr);
          }
        } catch (toolError) {
          logger.error(`工具 "${toolName}" 执行失败:`, toolError);
          toolResultData = {
            error: `工具执行失败: ${toolError.message || "未知错误"}`,
          };
          if (FILE_TOOLS.has(toolName) && e?.sendForwardMsg) {
            await sendToolVisual(e, toolName, toolArgs, `错误: ${toolError.message}`);
          }
        }
      } else {
        // 尝试通过 MCP 执行
        logger.info(`尝试通过 MCP 执行工具："${toolName}"`);
        try {
          const rawResult = await mcpManager.callTool(toolName, toolArgs, Boolean(e?.isMaster));
          toolResultData = { message: rawResult };

          // MCP 工具也触发可视化
          if (e?.sendForwardMsg) {
            await sendToolVisual(e, toolName, toolArgs, rawResult);
          }
        } catch (mcpError) {
          logger.warn(`MCP 工具 "${toolName}" 执行失败: ${mcpError.message}`);
          toolResultData = { error: `MCP 工具执行失败: ${mcpError.message}` };
          if (e?.sendForwardMsg) {
            await sendToolVisual(e, toolName, toolArgs, `错误: ${mcpError.message}`);
          }
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
