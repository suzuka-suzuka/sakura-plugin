import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Setting from "../setting.js";
import {
    DEFAULT_TAVILY_MCP_URL,
    buildTavilyRawContentParameter,
    normalizeTavilyMaxResults,
    normalizeTavilySearchDepth,
} from "./tavilyConfig.js";

const BASE_SERVERS = [
    {
        id: "fetch",
        transport: "stdio",
        command: process.platform === "win32" ? "python" : "python3",
        args: ["-m", "mcp_server_fetch", "--ignore-robots-txt"],
        description: "网络请求 访问网页URL 抓取获取网页文本内容 爬取网站数据 查看在线文档",
    },
    {
        id: "memory",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        masterOnly: true,
        description: "记忆 知识图谱 存储实体关系 持久化记录信息 查找历史记忆 记住用户偏好 建立关联关系",
    },
];

function buildTavilyDefaultParameters(config = {}) {
    return {
        include_favicon: config.includeFavicon !== false,
        include_images: config.includeImages === true,
        include_raw_content: buildTavilyRawContentParameter(config.includeRawContent),
        search_depth: normalizeTavilySearchDepth(config.searchDepth),
        max_results: normalizeTavilyMaxResults(config.maxResults),
    };
}

function createTavilyServerConfig() {
    const tavilyConfig = Setting.getConfig("TavilyMCP") || {};
    const apiKey = String(tavilyConfig.apiKey || "").trim();

    if (!apiKey) {
        return null;
    }

    const rawBaseURL = String(tavilyConfig.baseURL || DEFAULT_TAVILY_MCP_URL).trim() || DEFAULT_TAVILY_MCP_URL;

    let url;
    try {
        url = new URL(rawBaseURL);
    } catch (error) {
        logger.warn(`[MCP] Tavily MCP URL 无效，已跳过连接: ${error.message}`);
        return null;
    }

    return {
        id: "tavily",
        transport: "http",
        url,
        requestInit: {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                DEFAULT_PARAMETERS: JSON.stringify(buildTavilyDefaultParameters(tavilyConfig)),
            },
        },
        description: "网页搜索 实时联网搜索 提取网页正文 抓取网站内容 搜索新闻与资料 Tavily",
    };
}

function getServerConfigs() {
    const servers = [...BASE_SERVERS];
    const tavilyServer = createTavilyServerConfig();

    if (tavilyServer) {
        servers.push(tavilyServer);
    }

    return servers;
}

function getServerConfigById(serverId) {
    return getServerConfigs().find((server) => server.id === serverId) || null;
}

function createTransport(serverConfig) {
    if (serverConfig.transport === "http") {
        return new StreamableHTTPClientTransport(serverConfig.url, {
            requestInit: serverConfig.requestInit,
        });
    }

    const env = { ...process.env };
    return new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env,
        stderr: "ignore",
    });
}

export async function initMcpServerEmbeddings() {}

export async function refreshMcpServerEmbeddings() {}

class MCPManager {
    constructor() {
        this.clients = new Map();
        this.clientTools = new Map();
        this.toolToClientId = new Map();
        this._connecting = null;
        this._connected = false;

        const cleanup = () => this.close().catch(() => {});
        process.once("exit", cleanup);
        process.once("SIGINT", cleanup);
        process.once("SIGTERM", cleanup);
    }

    async connectAll() {
        if (this._connecting) {
            await this._connecting;
            return;
        }

        this._connecting = (async () => {
            const serverConfigs = getServerConfigs();
            const serversToStart = serverConfigs.filter((serverConfig) => !this.clients.has(serverConfig.id));

            if (serversToStart.length > 0) {
                logger.info(`[MCP] 正在启动 ${serversToStart.length} 个 MCP servers...`);
            }

            await Promise.all(serversToStart.map(async (serverConfig) => {
                try {
                    const transport = createTransport(serverConfig);
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
                } catch (error) {
                    logger.error(`[MCP] 启动 ${serverConfig.id} 失败: ${error.message}`);
                }
            }));

            this._connected = true;
        })();

        await this._connecting;
        this._connecting = null;
    }

    async close() {
        if (this.clients.size === 0) {
            return;
        }

        for (const client of this.clients.values()) {
            try {
                await client.close();
            } catch {
            }
        }

        this.clients.clear();
        this.clientTools.clear();
        this.toolToClientId.clear();
        this._connected = false;
        logger.info("[MCP] 所有 MCP server 连接已关闭");
    }

    async callTool(toolName, args, isMaster = false) {
        await this.connectAll();

        const serverId = this.toolToClientId.get(toolName);
        if (!serverId) {
            throw new Error(`未知的 MCP 工具: ${toolName}`);
        }

        const serverConfig = getServerConfigById(serverId);
        if (serverConfig?.masterOnly && !isMaster) {
            throw new Error(`权限不足，MCP 工具 ${toolName} 仅主人可用`);
        }

        const client = this.clients.get(serverId);
        if (!client) {
            throw new Error(`MCP client ${serverId} 未连接`);
        }

        const result = await client.callTool({ name: toolName, arguments: args });

        if (Array.isArray(result.content)) {
            const parts = [];
            for (const contentItem of result.content) {
                if (contentItem.type === "text" && contentItem.text) {
                    parts.push(contentItem.text);
                } else if (contentItem.type === "resource" && contentItem.resource) {
                    if (contentItem.resource.text) {
                        parts.push(contentItem.resource.text);
                    } else if (contentItem.resource.blob) {
                        try {
                            parts.push(Buffer.from(contentItem.resource.blob, "base64").toString("utf-8"));
                        } catch {
                            parts.push(`[二进制内容 ${contentItem.resource.mimeType || ""}]`);
                        }
                    }
                }
            }
            return parts.join("\n") || JSON.stringify(result.content);
        }

        return String(result.content || "");
    }

    async listTools(isMaster = false, vectorContext = null, allowedServerIds = null) {
        await this.connectAll();

        const allowedSet = allowedServerIds ? new Set(allowedServerIds) : null;
        const serverConfigs = getServerConfigs();

        const eligibleServers = serverConfigs.filter((serverConfig) =>
            this.clientTools.has(serverConfig.id) &&
            (allowedSet === null || allowedSet.has(serverConfig.id)) &&
            !(serverConfig.masterOnly && !isMaster)
        );

        if (eligibleServers.length === 0) {
            return [];
        }

        const allTools = [];
        for (const server of eligibleServers) {
            allTools.push(...(this.clientTools.get(server.id) || []));
        }

        logger.info(`[MCP] 注入 server: [${eligibleServers.map((server) => server.id).join(", ")}]`);
        return allTools;
    }

    getToolNames() {
        return new Set(this.toolToClientId.keys());
    }

    async getOpenAITools(isMaster = false, vectorContext = null, allowedServerIds = null) {
        const tools = await this.listTools(isMaster, vectorContext, allowedServerIds);

        const sanitizeSchema = (schema) => {
            if (!schema || typeof schema !== "object") {
                return schema;
            }
            if (Array.isArray(schema)) {
                return schema.map(sanitizeSchema);
            }

            const newSchema = {};
            if (
                Object.prototype.hasOwnProperty.call(schema, "const") &&
                !Object.prototype.hasOwnProperty.call(schema, "enum")
            ) {
                newSchema.enum = [sanitizeSchema(schema.const)];
            }
            for (const [key, value] of Object.entries(schema)) {
                if (key === "exclusiveMaximum" || key === "exclusiveMinimum" || key === "const") {
                    continue;
                }
                newSchema[key] = sanitizeSchema(value);
            }
            return newSchema;
        };

        return tools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.inputSchema ? sanitizeSchema(tool.inputSchema) : { type: "object", properties: {} },
            },
        }));
    }
}

export const mcpManager = new MCPManager();
