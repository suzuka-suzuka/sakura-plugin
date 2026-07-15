import { ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import { buildGroupPrompt } from "./GroupContext.js";
import { getToolsSchema } from "./tools/tools.js";
import { mcpManager } from "./MCPManager.js";
import {
  createRouteExecutionPlan,
  formatRouteAttemptFailure,
  isRequestConfigComplete,
  modelSupportsDirectImageInput,
  prioritizeRouteAttempt,
} from "./providerRouter.js";
import { createGeminiClient } from "./vertexAuth.js";
import { prepareHistoryForGemini } from "./toolCallProtocol.js";
import { buildGeminiToolConfig } from "./geminiToolConfig.js";
import {
  buildOpenAIUserContent,
  processQueryParts,
} from "./messageParts.js";
import { buildOpenAICompatibleWebSearchTool } from "./openAIWebSearchTool.js";

const OPENAI_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const GEMINI_THINKING_LEVELS = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
function normalizeRequestError(error) {
  if (error?.isAIRequestError) return error;
  const status = Number(error?.status || error?.response?.status) || null;
  const wrapped = new Error(error?.message || String(error));
  wrapped.status = status;
  wrapped.isAIRequestError = true;
  return wrapped;
}

function normalizeOpenAIReasoningEffort(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return OPENAI_REASONING_EFFORTS.has(normalized) ? normalized : "";
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
  historyContents = []
) {
  if (!isRequestConfigComplete(channel, "openai")) {
    const errorMessage = "无效或不完整的渠道配置";
    logger.error(errorMessage);
    return errorMessage;
  }

  const openai = new OpenAI({
    apiKey: channel.apiKey,
    ...(channel.baseURL?.trim() && { baseURL: channel.baseURL.trim() }),
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
      for (let historyIndex = 0; historyIndex < historyContents.length; historyIndex++) {
        const item = historyContents[historyIndex];
        if (item.role === "user" || item.role === "model") {
          const role = item.role === "model" ? "assistant" : "user";
          const textParts = item.parts
            .filter((part) => part.text && part.thought !== true)
            .map((part) => part.text);
          const content = item.role === "user"
            ? buildOpenAIUserContent(item.parts)
            : textParts.join("");
          const tool_calls = item.parts
            .filter((part) => part.functionCall)
            .map((part, functionCallIndex) => ({
              id:
                part.functionCall.id ||
                item.toolCallIds?.[functionCallIndex] ||
                `call_history_${historyIndex}_${functionCallIndex}`,
              type: "function",
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
            }));
          let message = { role };
          if (Array.isArray(content) ? content.length > 0 : content) {
            message.content = content;
          }
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
      const openAICompatibleParts = buildOpenAIUserContent(queryParts);

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

    if (channel.openaiEnableThinking === true) {
      requestPayload.enable_thinking = true;
    }

    if (Number.isFinite(channel.temperature)) {
      requestPayload.temperature = channel.temperature;
    }
    if (Number.isFinite(channel.topP)) {
      requestPayload.top_p = channel.topP;
    }

    const reasoningEffort = normalizeOpenAIReasoningEffort(channel.openaiReasoningEffort);
    if (reasoningEffort) {
      requestPayload.reasoning_effort = reasoningEffort;
    } else if (typeof channel.openaiReasoningEffort === "string" && channel.openaiReasoningEffort.trim()) {
      logger.warn(`OpenAI target [${channel.name}] ignored invalid reasoning effort: ${channel.openaiReasoningEffort}`);
    }

    // 本地工具和 MCP 工具独立匹配，任一有结果就注入
    let allOpenAITools = [];
    if (channel.nativeWebSearch === true) {
      allOpenAITools.push(buildOpenAICompatibleWebSearchTool(channel));
    }
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
          const mcpTools = await mcpManager.getOpenAITools(Boolean(e?.isMaster), allowedMcpServerIds);
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
    throw normalizeRequestError(error);
  }
}

async function _getGeminiResponse(
  channel,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = []
) {
  if (!isRequestConfigComplete(channel, "gemini")) {
    const errorMessage = "无效或不完整的渠道配置。";
    logger.error(errorMessage);
    return errorMessage;
  }

  const { model: GEMINI_MODEL } = channel;

  let finalContentsForGemini = [];
  let fullSystemInstructionText = "";

  try {
    const ai = createGeminiClient(channel);
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
      finalContentsForGemini.push(...prepareHistoryForGemini(historyContents));
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
    };

    const requestConfig = {};

    if (Number.isFinite(channel.temperature)) {
      requestConfig.temperature = channel.temperature;
    }
    if (Number.isFinite(channel.topP)) {
      requestConfig.topP = channel.topP;
    }

    if (Number.isInteger(channel.geminiThinkingBudget) && channel.geminiThinkingBudget >= -1) {
      requestConfig.thinkingConfig = {
        thinkingBudget: channel.geminiThinkingBudget,
      };
    } else if (GEMINI_THINKING_LEVELS[channel.geminiThinkingLevel]) {
      requestConfig.thinkingConfig = {
        thinkingLevel: GEMINI_THINKING_LEVELS[channel.geminiThinkingLevel],
      };
    }

    if (fullSystemInstructionText.trim()) {
      requestConfig.systemInstruction = fullSystemInstructionText.trim();
    }

    requestConfig.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    ];

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
          const mcpTools = await mcpManager.listTools(Boolean(e?.isMaster), allowedMcpServerIds);
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

    Object.assign(requestConfig, buildGeminiToolConfig({
      functionDeclarations: allDeclarations,
      nativeWebSearch: channel.nativeWebSearch,
      vertex: channel.vertex,
    }));

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

    const responseParts = candidate.content.parts;
    const visibleParts = responseParts.filter(
      (part) => part?.thought !== true
    );

    const extractedText = visibleParts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join("");

    const extractedFunctionCalls = responseParts
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
      rawParts: responseParts,
    };
  } catch (error) {
    const errorMessage = `API 调用失败: ${error.message}`;
    logger.error(errorMessage);
    throw normalizeRequestError(error);
  }
}

export async function getAI(
  routeId,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = [],
  routingContext = null
) {
  let plan;
  try {
    const cachedPlan = routingContext?.plan;
    plan = cachedPlan?.route?.id === routeId
      ? cachedPlan
      : createRouteExecutionPlan(routeId, { selfId: e?.self_id });
    if (routingContext && typeof routingContext === "object") {
      routingContext.plan = plan;
    }
  } catch (error) {
    return `路由配置错误：${error.message}`;
  }

  if (plan.attempts.length === 0) {
    return `路由“${routeId}”没有可用的供应商目标或凭据。`;
  }

  let lastError = null;
  for (let index = 0; index < plan.attempts.length; index++) {
    const attempt = plan.attempts[index];
    const config = attempt.requestConfig;
    logger.info(
      `[AI Router] route=${routeId} target=${attempt.target.id} provider=${attempt.provider.id} credential=${attempt.credential.id} model=${config.model}`
    );

    try {
      const requestQueryParts =
        typeof routingContext?.prepareQueryPartsForAttempt === "function"
          ? await routingContext.prepareQueryPartsForAttempt(queryParts, config)
          : queryParts;
      const args = [
        config,
        e,
        requestQueryParts,
        presetPrompt,
        enableGroupContext,
        enableTools,
        historyContents,
      ];
      const result = config.channelType === "gemini"
        ? await _getGeminiResponse(...args)
        : await _getOpenAIResponse(...args);

      if (typeof result !== "string") {
        if (routingContext && typeof routingContext === "object") {
          routingContext.plan = prioritizeRouteAttempt(plan, attempt);
        }
        return {
          ...result,
          sourceProtocol: config.channelType,
          supportsImageInput: modelSupportsDirectImageInput(config.model),
          requestQueryParts,
        };
      }
      lastError = normalizeRequestError(new Error(result));
    } catch (error) {
      lastError = normalizeRequestError(error);
    }

    const nextAttempt = plan.attempts[index + 1] || null;
    logger.warn(formatRouteAttemptFailure({
      routeId,
      attempt,
      error: lastError,
      attemptNumber: index + 1,
      totalAttempts: plan.attempts.length,
      nextAttempt,
      retryDelayMs: plan.route.retryDelayMs,
    }));

    if (nextAttempt && plan.route.retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, plan.route.retryDelayMs));
    }
  }

  const errorMessage = `路由“${routeId}”请求失败：${lastError?.message || "未知错误"}`;
  logger.error(errorMessage);
  return errorMessage;
}
