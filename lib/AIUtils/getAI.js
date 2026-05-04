import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { buildGroupPrompt } from "./GroupContext.js";
import { getToolsSchema } from "./tools/tools.js";
import { mcpManager } from "./MCPManager.js";
import Setting from "../setting.js";
import { grokRequest } from "./GrokClient.js";

const channelApiKeyIndex = new Map();
const OPENAI_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function normalizeOpenAIReasoningEffort(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return OPENAI_REASONING_EFFORTS.has(normalized) ? normalized : "";
}

/**
 * 处理 queryParts，将 inlineData 格式转换为对应渠道格式
 * @param {Array} queryParts - 原始查询部分
 * @param {string} channelType - 渠道类型 (gemini/openai/grok)
 * @returns {Array} 处理后的查询部分
 */
function processQueryParts(queryParts, channelType) {
  if (!queryParts || queryParts.length === 0) return queryParts;

  return queryParts.map((part) => {
    if (part.text) {
      return part;
    }
    if (part.inlineData) {
      if (channelType === "gemini") {
        return part;
      } else {
        const { mimeType, data } = part.inlineData;
        return {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${data}`,
          },
        };
      }
    }
    return part;
  });
}

function sanitizeFunctionSchema(schema, toUpper = false) {
  const visit = (node) => {
    if (Array.isArray(node)) {
      return node.map(visit);
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    const sanitized = {};

    if (
      Object.prototype.hasOwnProperty.call(node, "const") &&
      !Object.prototype.hasOwnProperty.call(node, "enum")
    ) {
      sanitized.enum = [visit(node.const)];
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "exclusiveMaximum" || key === "exclusiveMinimum" || key === "const") {
        continue;
      }

      if (key === "type" && typeof value === "string") {
        sanitized[key] = toUpper ? value.toUpperCase() : value.toLowerCase();
      } else {
        sanitized[key] = visit(value);
      }
    }

    return sanitized;
  };

  return visit(schema);
}

function adjustSchemaCase(schema, toUpper = false) {
  const copied = JSON.parse(JSON.stringify(schema));
  return copied.map((tool) => ({
    ...tool,
    parameters: sanitizeFunctionSchema(tool.parameters, toUpper),
  }));
}

function extractTextFromParts(parts = []) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function parseOpenAICompletionIfNeeded(rawCompletion) {
  if (!rawCompletion) return rawCompletion;

  if (typeof rawCompletion === "string") {
    try {
      return JSON.parse(rawCompletion);
    } catch {
      return rawCompletion;
    }
  }

  if (
    typeof rawCompletion === "object" &&
    rawCompletion !== null &&
    typeof rawCompletion.data === "string"
  ) {
    try {
      return JSON.parse(rawCompletion.data);
    } catch {
      return rawCompletion;
    }
  }

  return rawCompletion;
}

function normalizeOpenAIMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part?.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

export function getCurrentAndPreviousUserText(queryParts = [], historyContents = []) {
  const currentInput = extractTextFromParts(queryParts);
  let previousInput = "";

  for (let i = historyContents.length - 1; i >= 0; i--) {
    const item = historyContents[i];
    if (item?.role === "user") {
      previousInput = extractTextFromParts(item.parts || []);
      if (previousInput) break;
    }
  }

  return { currentInput, previousInput };
}

async function _getOpenAIResponse(
  channel,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = [],
  lockedVectorContext = null
) {
  if (
    !channel ||
    !channel.baseURL ||
    !channel.api ||
    (Array.isArray(channel.api) && channel.api.length === 0) ||
    (typeof channel.api === "string" && !channel.api.trim()) ||
    !channel.model
  ) {
    const errorMessage = "无效或不完整的渠道配置";
    logger.error(errorMessage);
    return errorMessage;
  }

  let API_KEY;
  let apiKeys = channel.api;
  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys
      .split("\n")
      .map((key) => key.trim())
      .filter((key) => key);
  }
  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const channelName = channel.name;
    let currentIndex = channelApiKeyIndex.get(channelName) || 0;
    if (currentIndex >= apiKeys.length) currentIndex = 0;
    API_KEY = apiKeys[currentIndex];
    const nextIndex = (currentIndex + 1) % apiKeys.length;
    channelApiKeyIndex.set(channelName, nextIndex);
    logger.info(
      `渠道 [${channelName}] 正在使用第 ${currentIndex + 1} 个 API Key`
    );
  } else if (typeof apiKeys === "string") {
    API_KEY = apiKeys;
  } else {
    const errorMessage = "渠道配置中的 API Key 无效。";
    logger.error(errorMessage);
    return errorMessage;
  }

  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: channel.baseURL,
    maxRetries: 0,
  });

  try {
    let messages = [];

    let fullSystemInstructionText = "";
    if (presetPrompt && presetPrompt.trim()) {
      fullSystemInstructionText += presetPrompt.trim();
    }

    let groupContextOptions = {};
    let shouldEnableGroupContext = false;

    if (typeof enableGroupContext === "object" && enableGroupContext !== null) {
      shouldEnableGroupContext = true;
      if (!enableGroupContext.noHeader && e?.sender) {
        groupContextOptions.sender = e.sender;
      }
    } else if (enableGroupContext === true) {
      shouldEnableGroupContext = true;
      if (e?.sender) {
        groupContextOptions.sender = e.sender;
      }
    }

    if (shouldEnableGroupContext && e?.group_id) {
      const systemPromptWithContext = await buildGroupPrompt(
        e.group_id,
        groupContextOptions
      );
      if (systemPromptWithContext.trim()) {
        if (fullSystemInstructionText) fullSystemInstructionText += "\n";
        fullSystemInstructionText += systemPromptWithContext.trim();
      }
    }
    if (fullSystemInstructionText) {
      messages.push({ role: "system", content: fullSystemInstructionText });
    }

    if (historyContents.length > 0) {
      for (const item of historyContents) {
        if (item.role === "user" || item.role === "model") {
          const role = item.role === "model" ? "assistant" : "user";
          const textParts = item.parts.filter((p) => p.text).map((p) => p.text);
          const content = textParts.join("");
          const tool_calls = item.parts
            .filter((part) => part.functionCall)
            .map((part) => ({
              id: part.functionCall.id,
              type: "function",
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
            }));
          let message = { role };
          if (content) message.content = content;
          if (tool_calls.length > 0) message.tool_calls = tool_calls;
          if (
            message.content ||
            (message.tool_calls && message.tool_calls.length > 0)
          ) {
            messages.push(message);
          }
        } else if (item.role === "function") {
          for (const part of item.parts) {
            if (part.functionResponse && part.functionResponse.id) {
              messages.push({
                role: "tool",
                tool_call_id: part.functionResponse.id,
                name: part.functionResponse.name,
                content: JSON.stringify(part.functionResponse.response),
              });
            }
          }
        }
      }
    }

    if (queryParts && queryParts.length > 0) {
      const processedParts = processQueryParts(queryParts, "openai");
      const openAICompatibleParts = processedParts.map((part) => {
        if (part.text && !part.type) {
          return { type: "text", text: part.text };
        }
        if (part.image_url && !part.type) {
          return { type: "image_url", image_url: part.image_url };
        }
        return part;
      });

      messages.push({ role: "user", content: openAICompatibleParts });
    }

    if (
      messages.length === 0 ||
      (messages[messages.length - 1].role !== "user" &&
        messages[messages.length - 1].role !== "tool")
    ) {
      const errorMessage = "无有效查询或历史内容，无法发起请求。";
      logger.warn(errorMessage);
      return errorMessage;
    }

    const requestPayload = {
      model: channel.model,
      messages: messages,
      stream: false,
    };

    if (channel.enable_thinking === true) {
      requestPayload.enable_thinking = true;
    }

    const reasoningEffort = normalizeOpenAIReasoningEffort(channel.reasoning_effort);
    if (reasoningEffort) {
      requestPayload.reasoning_effort = reasoningEffort;
    } else if (typeof channel.reasoning_effort === "string" && channel.reasoning_effort.trim()) {
      logger.warn(`OpenAI channel [${channel.name}] ignored invalid reasoning_effort: ${channel.reasoning_effort}`);
    }

    const vectorContext = lockedVectorContext ?? getCurrentAndPreviousUserText(queryParts, historyContents);

    // 本地工具和 MCP 工具独立匹配，任一有结果就注入
    let allOpenAITools = [];
    if (enableTools) {
      const { localTools: toolsSchema, allowedMcpServerIds } = await getToolsSchema(e, enableTools);
      if (toolsSchema && toolsSchema.length > 0) {
        const adjustedSchema = adjustSchemaCase(toolsSchema, false);
        allOpenAITools.push(...adjustedSchema.map((tool) => ({
          type: "function",
          function: tool,
        })));
      }

      if (allowedMcpServerIds && allowedMcpServerIds.length > 0) {
        try {
          const mcpTools = await mcpManager.getOpenAITools(Boolean(e?.isMaster), vectorContext, allowedMcpServerIds);
          if (mcpTools && mcpTools.length > 0) {
            allOpenAITools.push(...mcpTools);
          }
        } catch (mcpErr) {
          logger.warn(`[MCP] 注入 MCP 工具失败，跳过: ${mcpErr.message}`);
        }
      }
    }

    if (allOpenAITools.length > 0) {
      requestPayload.tools = allOpenAITools;
      requestPayload.tool_choice = "auto";
    }

    const rawCompletion = await openai.chat.completions.create(requestPayload);
    const completion = parseOpenAICompletionIfNeeded(rawCompletion);
    
    if (!completion || !completion.choices || !Array.isArray(completion.choices)) {
      const debugMsg = `API 节点返回了异常格式(${typeof completion}): ${JSON.stringify(completion)}`;
      logger.error(debugMsg);
      return debugMsg; 
    }

    const message = completion.choices[0]?.message;
    const extractedText = normalizeOpenAIMessageContent(message?.content);
    const toolCallsArr = message?.tool_calls || [];

    if (!extractedText && toolCallsArr.length === 0) {
      const errorMessage = "API 未返回任何内容。";
      logger.warn(errorMessage);
      return errorMessage;
    }

    const functionCalls = toolCallsArr
      .map((tc) => {
        try {
          return {
            id: tc.id,
            name: tc.function.name,
            args:
              typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments || {},
          };
        } catch (err) {
          logger.error(
            `解析工具调用参数失败: ${err.message}`,
            tc.function.arguments
          );
          return null;
        }
      })
      .filter(Boolean);

    return { text: extractedText, functionCalls: functionCalls };
  } catch (error) {
    const errorMessage = `API 调用失败: ${error.message}`;
    logger.error(errorMessage, error);
    return errorMessage;
  }
}

async function _getGrokResponse(
  channel,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = []
) {
  if (!channel || !channel.model) {
    const errorMessage = "无效或不完整的渠道配置";
    logger.error(errorMessage);
    return errorMessage;
  }

  if (!channel.sso && !channel.supersso) {
    const errorMessage = "Grok渠道缺少sso或supersso认证配置";
    logger.error(errorMessage);
    return errorMessage;
  }

  try {
    let messages = [];

    let fullSystemInstructionText = "";
    if (presetPrompt && presetPrompt.trim()) {
      fullSystemInstructionText += presetPrompt.trim();
    }

    let groupContextOptions = {};
    let shouldEnableGroupContext = false;

    if (typeof enableGroupContext === "object" && enableGroupContext !== null) {
      shouldEnableGroupContext = true;
      if (!enableGroupContext.noHeader && e?.sender) {
        groupContextOptions.sender = e.sender;
      }
    } else if (enableGroupContext === true) {
      shouldEnableGroupContext = true;
      if (e?.sender) {
        groupContextOptions.sender = e.sender;
      }
    }

    if (shouldEnableGroupContext && e?.group_id) {
      const systemPromptWithContext = await buildGroupPrompt(
        e.group_id,
        groupContextOptions
      );
      if (systemPromptWithContext.trim()) {
        if (fullSystemInstructionText) fullSystemInstructionText += "\n";
        fullSystemInstructionText += systemPromptWithContext.trim();
      }
    }
    if (fullSystemInstructionText) {
      messages.push({ role: "system", content: fullSystemInstructionText });
    }

    if (historyContents.length > 0) {
      for (const item of historyContents) {
        if (item.role === "user" || item.role === "model") {
          const role = item.role === "model" ? "assistant" : "user";
          const textParts = item.parts.filter((p) => p.text).map((p) => p.text);
          const content = textParts.join("");
          if (content) {
            messages.push({ role, content });
          }
        }
      }
    }

    if (queryParts && queryParts.length > 0) {
      const processedParts = processQueryParts(queryParts, "grok");
      const openAICompatibleParts = processedParts.map((part) => {
        if (part.text && !part.type) {
          return { type: "text", text: part.text };
        }
        if (part.image_url && !part.type) {
          return { type: "image_url", image_url: part.image_url };
        }
        return part;
      });

      messages.push({ role: "user", content: openAICompatibleParts });
    }

    if (
      messages.length === 0 ||
      (messages[messages.length - 1].role !== "user" &&
        messages[messages.length - 1].role !== "tool")
    ) {
      const errorMessage = "无有效查询或历史内容，无法发起请求。";
      logger.warn(errorMessage);
      return errorMessage;
    }

    const grokConfig = {
      sso: channel.sso,
      supersso: channel.supersso,
      cf_clearance: channel.cf_clearance,
      x_statsig_id: channel.x_statsig_id,
      temporary: channel.temporary !== false,
      dynamic_statsig: channel.dynamic_statsig !== false,
    };

    const request = {
      model: channel.model,
      messages: messages,
    };

    const result = await grokRequest(request, grokConfig, e);

    return {
      text: result.text || "",
      functionCalls: [],
      images: result.images || [],
      videos: result.videos || [],
    };
  } catch (error) {
    const errorMessage = `Grok API 调用失败: ${error.message}`;
    logger.error(errorMessage, error);
    return errorMessage;
  }
}

async function _getGeminiResponse(
  channel,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = [],
  lockedVectorContext = null
) {
  const isVertex = channel.vertex === true;
  if (
    !channel ||
    !channel.api ||
    (Array.isArray(channel.api) && channel.api.length === 0) ||
    (typeof channel.api === "string" && !channel.api.trim()) ||
    !channel.model
  ) {
    const errorMessage = "无效或不完整的渠道配置。";
    logger.error(errorMessage);
    return errorMessage;
  }

  let API_KEY;
  const { model: GEMINI_MODEL } = channel;

  let apiKeys = channel.api;

  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys
      .split("\n")
      .map((key) => key.trim())
      .filter((key) => key);
  }

  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const channelName = channel.name;
    let currentIndex = channelApiKeyIndex.get(channelName) || 0;

    if (currentIndex >= apiKeys.length) {
      currentIndex = 0;
    }

    API_KEY = apiKeys[currentIndex];

    const nextIndex = (currentIndex + 1) % apiKeys.length;
    channelApiKeyIndex.set(channelName, nextIndex);

    logger.info(
      `渠道 [${channelName}] 正在使用第 ${currentIndex + 1
      } 个 API Key: ${API_KEY.slice(0, 6)}****${API_KEY.slice(-4)}`
    );
  } else if (typeof apiKeys === "string") {
    API_KEY = apiKeys;
  } else {
    const errorMessage = "渠道配置中的 API Key 无效。";
    logger.error(errorMessage);
    return errorMessage;
  }

  let ai;
  const geminiOptions = { apiKey: API_KEY };

  if (isVertex) {
    geminiOptions.vertexai = true;
  }

  if (channel.baseURL) {
    geminiOptions.httpOptions = {
      baseUrl: channel.baseURL,
    };
  }

  ai = new GoogleGenAI(geminiOptions);

  let finalContentsForGemini = [];
  let fullSystemInstructionText = "";

  try {
    if (presetPrompt && presetPrompt.trim()) {
      fullSystemInstructionText += presetPrompt.trim();
    }

    let groupContextOptions = {};
    let shouldEnableGroupContext = false;

    if (typeof enableGroupContext === "object" && enableGroupContext !== null) {
      shouldEnableGroupContext = true;
      if (!enableGroupContext.noHeader && e?.sender) {
        groupContextOptions.sender = e.sender;
      }
    } else if (enableGroupContext === true) {
      shouldEnableGroupContext = true;
      if (e?.sender) {
        groupContextOptions.sender = e.sender;
      }
    }

    if (shouldEnableGroupContext && e?.group_id) {
      const systemPromptWithContext = await buildGroupPrompt(
        e.group_id,
        groupContextOptions
      );
      if (systemPromptWithContext.trim()) {
        if (fullSystemInstructionText) {
          fullSystemInstructionText += "\n";
        }
        fullSystemInstructionText += systemPromptWithContext.trim();
      }
    }

    if (historyContents.length > 0) {
      finalContentsForGemini.push(...historyContents);
    }

    if (queryParts && queryParts.length > 0) {
      const processedParts = processQueryParts(queryParts, "gemini");
      finalContentsForGemini.push({
        role: "user",
        parts: processedParts,
      });
    } else if (finalContentsForGemini.length === 0) {
      const errorMessage = "无查询或历史内容，无法请求。";
      logger.warn(errorMessage);
      return errorMessage;
    }

    const requestOptions = {
      contents: finalContentsForGemini,
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: -1,
        },
      },
    };

    const requestConfig = {};

    if (fullSystemInstructionText.trim()) {
      requestConfig.systemInstruction = fullSystemInstructionText.trim();
    }

    requestConfig.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    ];

    const vectorContext = lockedVectorContext ?? getCurrentAndPreviousUserText(queryParts, historyContents);

    // 本地工具和 MCP 工具独立匹配，任一有结果就注入
    let allDeclarations = [];
    if (enableTools) {
      const { localTools: toolsSchema, allowedMcpServerIds } = await getToolsSchema(e, enableTools);
      if (toolsSchema && toolsSchema.length > 0) {
        const adjustedSchema = adjustSchemaCase(toolsSchema, true);
        allDeclarations.push(...adjustedSchema);
      }

      if (allowedMcpServerIds && allowedMcpServerIds.length > 0) {
        try {
          const mcpTools = await mcpManager.listTools(Boolean(e?.isMaster), vectorContext, allowedMcpServerIds);
          if (mcpTools && mcpTools.length > 0) {
            const mcpDeclarations = mcpTools.map(tool => {
              return {
                name: tool.name,
                description: tool.description || "",
                parameters: sanitizeFunctionSchema(
                  tool.inputSchema || { type: "object", properties: {} },
                  true
                ),
              };
            });
            allDeclarations.push(...mcpDeclarations);
          }
        } catch (mcpErr) {
          logger.warn(`[MCP] 注入 MCP 工具失败，跳过: ${mcpErr.message}`);
        }
      }
    }

    if (allDeclarations.length > 0) {
      requestConfig.toolConfig = {
        functionCallingConfig: {
          mode: "AUTO",
        },
      };
      requestConfig.tools = [{ functionDeclarations: allDeclarations }];
    } else {
      requestConfig.tools = [{ googleSearch: {} }];
    }

    const geminiRequestBody = {
      model: GEMINI_MODEL,
      ...requestOptions,
      config: requestConfig,
    };

    const response = await ai.models.generateContent(geminiRequestBody);

    if (!response) {
      const errorMessage = "API 未返回有效的响应。";
      logger.warn(errorMessage);
      return errorMessage;
    }

    if (response.promptFeedback?.blockReason) {
      const errorMessage = `响应被拦截，原因: ${response.promptFeedback.blockReason}`;
      logger.warn(errorMessage);
      return errorMessage;
    }

    if (!response.candidates || response.candidates.length === 0) {
      const errorMessage = "响应中未包含候选内容。";
      logger.warn(errorMessage, JSON.stringify(response, null, 2));
      return errorMessage;
    }

    const candidate = response.candidates[0];

    if (
      candidate.finishReason &&
      !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)
    ) {
      const errorMessage = `生成因 ${candidate.finishReason} 而中止。`;
      logger.warn(errorMessage, JSON.stringify(candidate, null, 2));
      return errorMessage;
    }

    if (!candidate.content || !candidate.content.parts) {
      const errorMessage = "候选内容为空。";
      logger.warn(errorMessage, JSON.stringify(candidate, null, 2));
      return errorMessage;
    }

    const visibleParts = candidate.content.parts.filter(
      (part) => part?.thought !== true
    );

    const extractedText = visibleParts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join("");

    const extractedFunctionCalls = visibleParts
      .filter((part) => part.functionCall)
      .map((part) => part.functionCall);

    if (!extractedText && extractedFunctionCalls.length === 0) {
      const errorMessage = "返回内容为空。";
      logger.warn(errorMessage);
      return errorMessage;
    }

    return {
      text: extractedText,
      functionCalls: extractedFunctionCalls,
      rawParts: visibleParts,
    };
  } catch (error) {
    const errorMessage = `API 调用失败: ${error.message}`;
    logger.error(errorMessage);
    return errorMessage;
  }
}

export async function getAI(
  channelName,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = [],
  lockedVectorContext = null,
  _retryCount = 0
  // _retryCount >= 0：当前渠道正常重试计数
  // _retryCount < 0 ：已回退至默认渠道，不再继续重试
) {
  const channelsConfig = Setting.getConfig("Channels");
  const aiConfig = Setting.getConfig("AI");
  const defaultChannelName = aiConfig?.defaultchannel;
  const maxRetries = Number.isInteger(aiConfig?.retryCount) ? aiConfig.retryCount : 1;
  // 负数表示「最终回退」状态，不允许再次重试或再次回退
  const isFinalFallback = _retryCount < 0;

  if (!channelsConfig || typeof channelsConfig !== "object") {
    return "配置错误：未找到 'Channels' 配置文件或其格式不正确。";
  }

  let channelConfig = null;
  let channelType = null;

  for (const type in channelsConfig) {
    if (Array.isArray(channelsConfig[type])) {
      const foundChannel = channelsConfig[type].find(
        (c) => c.name === channelName
      );
      if (foundChannel) {
        channelConfig = foundChannel;
        channelType = type;
        break;
      }
    }
  }

  if (!channelConfig) {
    if (!isFinalFallback && channelName !== defaultChannelName && defaultChannelName) {
      logger.warn(`渠道 "${channelName}" 未找到，尝试回退到默认渠道 '${defaultChannelName}'。`);
      return getAI(defaultChannelName, e, queryParts, presetPrompt, enableGroupContext, enableTools, historyContents, null, -1);
    }
    return `渠道错误：未找到名为 "${channelName}" 的可用渠道。`;
  }

  const retryLabel = _retryCount > 0 ? `（第 ${_retryCount} 次重试）` : isFinalFallback ? "（默认渠道回退）" : "";
  logger.info(`正在使用渠道 "${channelName}"，类型: ${channelType}${retryLabel}`);
  channelConfig.channelType = channelType;
  const requestArgs = [
    channelConfig,
    e,
    queryParts,
    presetPrompt,
    enableGroupContext,
    enableTools,
    historyContents,
    lockedVectorContext,
  ];

  let result;
  if (channelType === "gemini") {
    result = await _getGeminiResponse(...requestArgs);
  } else if (channelType === "openai") {
    result = await _getOpenAIResponse(...requestArgs);
  } else if (channelType === "grok") {
    result = await _getGrokResponse(...requestArgs);
  }

  if (typeof result === "string") {
    // 仍有重试次数且不处于最终回退状态
    if (!isFinalFallback && _retryCount < maxRetries) {
      const waitMs = (_retryCount + 1) * 5 * 1000; 
      logger.warn(`渠道 "${channelName}" 出错，${waitMs / 1000}s 后进行第 ${_retryCount + 1} 次重试...`);
      await new Promise((r) => setTimeout(r, waitMs));
      return getAI(channelName, e, queryParts, presetPrompt, enableGroupContext, enableTools, historyContents, lockedVectorContext, _retryCount + 1);
    }

    // 当前渠道重试耗尽，回退默认渠道（仅当不处于最终回退且不是默认渠道本身时）
    if (!isFinalFallback && channelName !== defaultChannelName && defaultChannelName) {
      logger.warn(`渠道 "${channelName}" 已重试 ${maxRetries} 次仍失败，回退到默认渠道 '${defaultChannelName}'...`);
      return getAI(defaultChannelName, e, queryParts, presetPrompt, enableGroupContext, enableTools, historyContents, null, -1);
    }

    // 已无可用回退，返回错误
    logger.error(`渠道 "${channelName}" 请求最终失败，已无可用回退渠道。`);
    return result;
  }

  return result;
}
