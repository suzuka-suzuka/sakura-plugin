import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import Setting from "../setting.js";

const ALLOWED_ROOT = path.resolve(process.cwd());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

/**
 * description 用于连接前的向量匹配（中文描述，覆盖该 server 的功能范围）
 * masterOnly 表示仅主人触发时才会被匹配并连接
 */
const SERVERS = [
    {
        id: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", ALLOWED_ROOT],
        masterOnly: true,
        description: "文件系统操作 读取查看文件内容 写入修改保存文件 编辑代码 列出目录文件列表 按名称搜索文件 删除文件 移动重命名文件 创建目录文件夹",
    },
    {
        id: "puppeteer",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-puppeteer"],
        description: "网页自动化 控制浏览器 网页截图 点击页面元素 填写提交表单 网页交互操作 模拟用户行为",
    },
    {
        id: "github",
        command: path.resolve(PLUGIN_ROOT, "github-mcp-server", process.platform === "win32" ? "github-mcp-server.exe" : "github-mcp-server-linux"),
        args: ["stdio"],
        description: "GitHub 仓库操作 查看读取代码文件 搜索代码 查看提交记录 管理 issue PR 克隆仓库 获取开源项目信息",
    },
    {
        id: "fetch",
        command: process.platform === "win32" ? "python" : "python3",
        args: ["-m", "mcp_server_fetch", "--ignore-robots-txt"],
        description: "网络请求 访问网页URL 抓取获取网页文本内容 爬取网站数据 查看在线文档",
    },
    {
        id: "memory",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        masterOnly: true,
        description: "记忆 知识图谱 存储实体关系 持久化记录信息 查找历史记忆 记住用户偏好 建立关联关系",
    }
];

// 仅 GitHub server 需要关键词匹配（工具数量多，41个）
const GITHUB_KEYWORDS = /github|仓库|repo(?:sitory)?|issue|pull\s*request|commit|开源|代码库/i;

export async function initMcpServerEmbeddings() {}

export async function refreshMcpServerEmbeddings() {}

/**
 * MCP Client 单例管理器
 */
class MCPManager {
    constructor() {
        this.clients = new Map();           // serverId -> Client
        this.clientTools = new Map();       // serverId -> Array<Tool>
        this.toolToClientId = new Map();    // toolName -> serverId
        this._connecting = null;
        this._connected = false;

        const cleanup = () => this.close().catch(() => {});
        process.once("exit", cleanup);
        process.once("SIGINT", cleanup);
        process.once("SIGTERM", cleanup);
    }

    /**
     * 并行启动所有 MCP Servers（幂等，只连一次）
     */
    async connectAll() {
        if (this._connected) return;
        if (this._connecting) { await this._connecting; return; }

        this._connecting = (async () => {
            logger.info(`[MCP] 正在启动 ${SERVERS.length} 个 MCP servers...`);
            const aiConfig = Setting.getConfig("AI") || {};
            const githubToken = aiConfig.githubToken || "";
            const enabledMCPs = aiConfig.enabledMCPs || {};

            // 过滤被禁用的MCP服务器
            const serversToStart = SERVERS.filter(serverConfig => {
                if (enabledMCPs.hasOwnProperty(serverConfig.id)) {
                    return enabledMCPs[serverConfig.id];
                }
                // 默认启用
                return true;
            });

            await Promise.all(serversToStart.map(async (serverConfig) => {
                try {
                    const env = { ...process.env };
                    if (githubToken) env.GITHUB_PERSONAL_ACCESS_TOKEN = githubToken;

                    const transport = new StdioClientTransport({
                        command: serverConfig.command,
                        args: serverConfig.args,
                        env,
                        stderr: "ignore",
                    });
                    const client = new Client({ name: `sakura-bot-mcp-${serverConfig.id}`, version: "1.0.0" });
                    await client.connect(transport);
                    this.clients.set(serverConfig.id, client);

                    const result = await client.listTools();
                    const tools = result.tools || [];
                    this.clientTools.set(serverConfig.id, tools);
                    for (const tool of tools) {
                        this.toolToClientId.set(tool.name, serverConfig.id);
                    }
                    logger.info(`[MCP] ${serverConfig.id} 已连接（${tools.length} 个工具）`);
                } catch (err) {
                    logger.error(`[MCP] 启动 ${serverConfig.id} 失败: ${err.message}`);
                }
            }));

            this._connected = true;
        })();

        await this._connecting;
        this._connecting = null;
    }

    /**
     * 关闭所有 MCP 连接
     */
    async close() {
        if (this.clients.size === 0) return;
        for (const client of this.clients.values()) {
            try { await client.close(); } catch { }
        }
        this.clients.clear();
        this.clientTools.clear();
        this.toolToClientId.clear();
        this._connected = false;
        logger.info("[MCP] 所有 MCP server 连接已关闭");
    }

    /**
     * 调用 MCP 工具
     * @param {string} toolName MCP 工具名
     * @param {object} args 参数
     * @param {boolean} isMaster 是否主人
     * @returns {Promise<string>}
     */
    async callTool(toolName, args, isMaster = false) {
        await this.connectAll();

        const serverId = this.toolToClientId.get(toolName);
        if (!serverId) throw new Error(`未知的 MCP 工具: ${toolName}`);

        const serverConfig = SERVERS.find((s) => s.id === serverId);
        if (serverConfig?.masterOnly && !isMaster) {
            throw new Error(`权限不足：MCP 工具 ${toolName} 仅主人可用`);
        }

        const client = this.clients.get(serverId);
        if (!client) throw new Error(`MCP client ${serverId} 未连接`);

        const result = await client.callTool({ name: toolName, arguments: args });

        // MCP result.content 是数组，取里面的文本和资源信息
        if (Array.isArray(result.content)) {
            const parts = [];
            for (const c of result.content) {
                if (c.type === "text" && c.text) {
                    parts.push(c.text);
                } else if (c.type === "resource" && c.resource) {
                    // 新版 GitHub MCP server 将文件内容放在 resource 中
                    if (c.resource.text) {
                        parts.push(c.resource.text);
                    } else if (c.resource.blob) {
                        // base64 编码的二进制内容，尝试解码为文本
                        try {
                            parts.push(Buffer.from(c.resource.blob, "base64").toString("utf-8"));
                        } catch {
                            parts.push(`[二进制内容 ${c.resource.mimeType || ''}]`);
                        }
                    }
                }
            }
            return parts.join("\n") || JSON.stringify(result.content);
        }
        return String(result.content || "");
    }

    /**
     * 按权限 + server 描述向量筛选，返回要注入到本次请求的工具列表
     * 连接在 connectAll() 时已全部建立，这里只做注入过滤
     * @param {boolean} isMaster 是否主人
     * @param {object|null} vectorContext { currentInput, previousInput }
     * @returns {Promise<Array>} 工具列表
     */
    async listTools(isMaster = false, vectorContext = null) {
        await this.connectAll();

        // 1. 权限过滤
        const eligibleServers = SERVERS.filter(s =>
            this.clientTools.has(s.id) && !(s.masterOnly && !isMaster)
        );
        if (eligibleServers.length === 0) return [];

        // 2. 关键词筛选：github 工具数量多（41个），仅在提到相关关键词时注入
        const queryText = [
            vectorContext?.currentInput,
            vectorContext?.previousInput,
        ].filter(s => typeof s === "string" && s.trim()).join("\n");

        const selectedServers = eligibleServers.filter(s => {
            if (s.id === "github") {
                const hit = GITHUB_KEYWORDS.test(queryText);
                if (!hit) logger.info("[MCP] github server 未命中关键词，跳过注入");
                return hit;
            }
            return true;
        });

        const allTools = [];
        for (const server of selectedServers) {
            allTools.push(...(this.clientTools.get(server.id) || []));
        }
        if (selectedServers.length > 0) {
            logger.info(`[MCP] 注入 server: [${selectedServers.map(s => s.id).join(", ")}]`);
        }
        return allTools;
    }

    /**
     * 获取所有已连接 MCP 工具名的 Set 集合
     * @returns {Set<string>}
     */
    getToolNames() {
        return new Set(this.toolToClientId.keys());
    }

    /**
     * 获取 MCP 工具列表并转换为 OpenAI function calling 格式
     * @param {boolean} isMaster 是否为主人
     * @param {object|null} vectorContext { currentInput, previousInput }
     * @returns {Promise<Array>} OpenAI tools 数组
     */
    async getOpenAITools(isMaster = false, vectorContext = null) {
        const tools = await this.listTools(isMaster, vectorContext);

        const sanitizeSchema = (schema) => {
            if (!schema || typeof schema !== 'object') return schema;
            if (Array.isArray(schema)) return schema.map(sanitizeSchema);
            const newSchema = {};
            for (const [key, value] of Object.entries(schema)) {
                if (key === 'exclusiveMaximum' || key === 'exclusiveMinimum') continue;
                newSchema[key] = sanitizeSchema(value);
            }
            return newSchema;
        };

        return tools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.inputSchema ? sanitizeSchema(tool.inputSchema) : { type: "object", properties: {} },
            },
        }));
    }
}

// 单例导出
export const mcpManager = new MCPManager();
