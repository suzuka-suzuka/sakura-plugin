import { GoogleGenAI } from "@google/genai"
import OpenAI from "openai"
import { buildGroupPrompt } from "./GroupContext.js"
import { ToolsSchema } from "./tools/tools.js"
import Setting from "../setting.js"
const channelApiKeyIndex = new Map()

async function _getOpenAIResponse(
  channel,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = [],
) {
  if (
    !channel ||
    !channel.baseURL ||
    !channel.api ||
    (Array.isArray(channel.api) && channel.api.length === 0) ||
    (typeof channel.api === "string" && !channel.api.trim()) ||
    !channel.model
  ) {
    const errorMessage = "无效或不完整的渠道配置"
    logger.error(errorMessage)
    return errorMessage
  }

  let API_KEY
  let apiKeys = channel.api
  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys
      .split("\n")
      .map(key => key.trim())
      .filter(key => key)
  }
  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const channelName = channel.name
    let currentIndex = channelApiKeyIndex.get(channelName) || 0
    if (currentIndex >= apiKeys.length) currentIndex = 0
    API_KEY = apiKeys[currentIndex]
    const nextIndex = (currentIndex + 1) % apiKeys.length
    channelApiKeyIndex.set(channelName, nextIndex)
    logger.info(`渠道 [${channelName}] 正在使用第 ${currentIndex + 1} 个 API Key`)
  } else if (typeof apiKeys === "string") {
    API_KEY = apiKeys
  } else {
    const errorMessage = "渠道配置中的 API Key 无效。"
    logger.error(errorMessage)
    return errorMessage
  }

  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: channel.baseURL,
  })

  try {
    let messages = []

    let fullSystemInstructionText = ""
    if (presetPrompt && presetPrompt.trim()) {
      fullSystemInstructionText += presetPrompt.trim()
    }
    if (enableGroupContext) {
      const systemPromptWithContext = await buildGroupPrompt(e)
      if (systemPromptWithContext.trim()) {
        if (fullSystemInstructionText) fullSystemInstructionText += "\n"
        fullSystemInstructionText += systemPromptWithContext.trim()
      }
    }
    if (fullSystemInstructionText) {
      messages.push({ role: "system", content: fullSystemInstructionText })
    }

    if (historyContents.length > 0) {
      for (const item of historyContents) {
        if (item.role === "user" || item.role === "model") {
          const role = item.role === "model" ? "assistant" : "user"
          const textParts = item.parts.filter(p => p.text).map(p => p.text)
          const content = textParts.join("")
          const tool_calls = item.parts
            .filter(part => part.functionCall)
            .map(part => ({
              id: part.functionCall.id,
              type: "function",
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
            }))
          let message = { role }
          if (content) message.content = content
          if (tool_calls.length > 0) message.tool_calls = tool_calls
          if (message.content || (message.tool_calls && message.tool_calls.length > 0)) {
            messages.push(message)
          }
        } else if (item.role === "function") {
          for (const part of item.parts) {
            if (part.functionResponse && part.functionResponse.id) {
              messages.push({
                role: "tool",
                tool_call_id: part.functionResponse.id,
                name: part.functionResponse.name,
                content: JSON.stringify(part.functionResponse.response),
              })
            }
          }
        }
      }
    }

    if (queryParts && queryParts.length > 0) {
      const userContent = queryParts.map(part => part.text || "").join("")
      if (userContent) {
        messages.push({ role: "user", content: userContent })
      }
    }

    if (
      messages.length === 0 ||
      (messages[messages.length - 1].role !== "user" &&
        messages[messages.length - 1].role !== "tool")
    ) {
      const errorMessage = "无有效查询或历史内容，无法发起请求。"
      logger.warn(errorMessage)
      return errorMessage
    }

    const requestPayload = {
      model: channel.model,
      messages: messages,
      stream: true,
    }
    if (enableTools && ToolsSchema && ToolsSchema.length > 0) {
      requestPayload.tools = ToolsSchema.map(tool => ({ type: "function", function: tool }))
      requestPayload.tool_choice = "auto"
    }

    const stream = await openai.chat.completions.create(requestPayload)
    let extractedText = ""
    let toolCallsArr = []
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) extractedText += delta.content
      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index
          if (!toolCallsArr[index]) toolCallsArr[index] = { function: {} }
          if (toolCallDelta.id) toolCallsArr[index].id = toolCallDelta.id
          if (toolCallDelta.type) toolCallsArr[index].type = toolCallDelta.type
          if (toolCallDelta.function) {
            if (toolCallDelta.function.name)
              toolCallsArr[index].function.name = toolCallDelta.function.name
            if (toolCallDelta.function.arguments) {
              if (!toolCallsArr[index].function.arguments)
                toolCallsArr[index].function.arguments = ""
              toolCallsArr[index].function.arguments += toolCallDelta.function.arguments
            }
          }
        }
      }
    }

    if (!extractedText && toolCallsArr.length === 0) {
      const errorMessage = "API 未返回任何内容。"
      logger.warn(errorMessage)
      return errorMessage
    }

    const functionCalls = toolCallsArr
      .map(tc => {
        try {
          return {
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          }
        } catch (err) {
          logger.error(`解析工具调用参数失败: ${err.message}`, tc.function.arguments)
          return null
        }
      })
      .filter(Boolean)

    return { text: extractedText, functionCalls: functionCalls }
  } catch (error) {
    const errorMessage = `API 调用失败: ${error.message}`
    logger.error(errorMessage, error)
    return errorMessage
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
) {
  if (
    !channel ||
    !channel.api ||
    (Array.isArray(channel.api) && channel.api.length === 0) ||
    (typeof channel.api === "string" && !channel.api.trim()) ||
    !channel.model
  ) {
    const errorMessage = "无效或不完整的渠道配置。"
    logger.error(errorMessage)
    return errorMessage
  }

  let API_KEY
  const { model: GEMINI_MODEL } = channel
  let apiKeys = channel.api

  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys
      .split("\n")
      .map(key => key.trim())
      .filter(key => key)
  }

  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const channelName = channel.name
    let currentIndex = channelApiKeyIndex.get(channelName) || 0

    if (currentIndex >= apiKeys.length) {
      currentIndex = 0
    }

    API_KEY = apiKeys[currentIndex]

    const nextIndex = (currentIndex + 1) % apiKeys.length
    channelApiKeyIndex.set(channelName, nextIndex)

    logger.info(`渠道 [${channelName}] 正在使用第 ${currentIndex + 1} 个 API Key: ${API_KEY}`)
  } else if (typeof apiKeys === "string") {
    API_KEY = apiKeys
  } else {
    const errorMessage = "渠道配置中的 API Key 无效。"
    logger.error(errorMessage)
    return errorMessage
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY })

  let finalContentsForGemini = []
  let fullSystemInstructionText = ""

  let extractedText = ""
  let extractedFunctionCalls = []

  try {
    if (presetPrompt && presetPrompt.trim()) {
      fullSystemInstructionText += presetPrompt.trim()
    }

    if (enableGroupContext) {
      const systemPromptWithContext = await buildGroupPrompt(e)
      if (systemPromptWithContext.trim()) {
        if (fullSystemInstructionText) {
          fullSystemInstructionText += "\n"
        }
        fullSystemInstructionText += systemPromptWithContext.trim()
      }
    }

    if (historyContents.length > 0) {
      finalContentsForGemini.push(...historyContents)
    }

    if (queryParts && queryParts.length > 0) {
      finalContentsForGemini.push({
        role: "user",
        parts: queryParts,
      })
    } else if (finalContentsForGemini.length === 0) {
      const errorMessage = "无查询或历史内容，无法请求。"
      logger.warn(errorMessage)
      return errorMessage
    }

    const requestOptions = {
      contents: finalContentsForGemini,
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: -1,
        },
      },
    }

    const requestConfig = {}

    if (fullSystemInstructionText.trim()) {
      requestConfig.systemInstruction = fullSystemInstructionText.trim()
    }

    requestConfig.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
    ]

    if (enableTools && ToolsSchema && ToolsSchema.length > 0) {
      requestConfig.toolConfig = {
        functionCallingConfig: {
          mode: "AUTO",
        },
      }
      requestConfig.tools = [{ functionDeclarations: ToolsSchema }]
    }

    const geminiRequestBody = {
      model: GEMINI_MODEL,
      ...requestOptions,
      config: requestConfig,
    }

    const streamingResult = await ai.models.generateContentStream(geminiRequestBody)

    for await (const chunk of streamingResult) {
      if (chunk && chunk.candidates && chunk.candidates.length > 0) {
        const candidate = chunk.candidates[0]
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              extractedText += part.text
            }
            if (part.functionCall) {
              extractedFunctionCalls.push(part.functionCall)
            }
          }
        }
      }
    }

    const response = await streamingResult.response

    if (!response) {
      if (extractedText || extractedFunctionCalls.length > 0) {
        return { text: extractedText, functionCalls: extractedFunctionCalls }
      }
      const errorMessage = "API 未返回有效的最终响应（可能被安全策略完全拦截）。"
      logger.warn(errorMessage)
      return errorMessage
    }

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0]
      if (candidate.content && candidate.content.parts) {
        if (!extractedText && extractedFunctionCalls.length === 0) {
          const blockReason = response.promptFeedback?.blockReason
          const errorMessage = `返回空内容或被安全策略拦截。${blockReason ? ` 原因: ${blockReason}` : ""}`
          logger.warn(errorMessage)
          return errorMessage
        } else {
          return { text: extractedText, functionCalls: extractedFunctionCalls }
        }
      } else {
        const finishReason = candidate.finishReason
        const errorMessage = `返回候选但无内容部分。${finishReason ? ` 结束原因: ${finishReason}` : ""}`
        logger.warn(errorMessage, JSON.stringify(response.candidates, null, 2))
        if (finishReason === "MALFORMED_FUNCTION_CALL") {
          logger.error(`返回 MALFORMED_FUNCTION_CALL。`)
        }
        return errorMessage
      }
    } else if (response.promptFeedback && response.promptFeedback.blockReason) {
      const errorMessage = `响应被拦截，原因: ${response.promptFeedback.blockReason}`
      logger.warn(errorMessage)
      return errorMessage
    } else {
      const errorMessage = "未返回有效响应或候选。"
      logger.warn(errorMessage, JSON.stringify(response, null, 2))
      return errorMessage
    }
  } catch (error) {
    const errorMessage = `API 调用失败: ${error.message}`
    logger.error(errorMessage)
    return errorMessage
  }
}

async function _getVertexAIResponse(
  channel,
  e,
  queryParts,
  presetPrompt,
  enableGroupContext,
  enableTools,
  historyContents = [],
) {
  const config = Setting.getConfig("Vertex")
  const { PROJECT_ID, LOCATION } = config

  if (!channel || !channel.model) {
    const errorMessage = "无效或不完整的渠道配置。"
    logger.error(errorMessage)
    return errorMessage
  }
  const { model: VERTEX_GEMINI_MODEL } = channel

  const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION,
  })

  let finalContentsForGemini = []
  let fullSystemInstructionText = ""
  let extractedText = ""
  let extractedFunctionCalls = []

  try {
    if (presetPrompt && presetPrompt.trim()) {
      fullSystemInstructionText += presetPrompt.trim()
    }

    if (enableGroupContext) {
      const systemPromptWithContext = await buildGroupPrompt(e)
      if (systemPromptWithContext.trim()) {
        if (fullSystemInstructionText) {
          fullSystemInstructionText += "\n"
        }
        fullSystemInstructionText += systemPromptWithContext.trim()
      }
    }

    if (historyContents.length > 0) {
      finalContentsForGemini.push(...historyContents)
    }

    if (queryParts && queryParts.length > 0) {
      finalContentsForGemini.push({
        role: "user",
        parts: queryParts,
      })
    } else if (finalContentsForGemini.length === 0) {
      const errorMessage = "无查询或历史内容，无法发起请求。"
      logger.warn(errorMessage)
      return errorMessage
    }

    const generationConfig = {
      maxOutputTokens: 65535,
      temperature: 0.9,
      topP: 1,
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    }

    if (fullSystemInstructionText.trim()) {
      generationConfig.systemInstruction = {
        parts: [{ text: fullSystemInstructionText.trim() }],
      }
    }

    if (enableTools && ToolsSchema && ToolsSchema.length > 0) {
      generationConfig.tools = [{ functionDeclarations: ToolsSchema }]
    }

    const vertexRequestBody = {
      model: VERTEX_GEMINI_MODEL,
      contents: finalContentsForGemini,
      config: generationConfig,
    }

    const streamingResult = await ai.models.generateContentStream(vertexRequestBody)

    for await (const chunk of streamingResult) {
      if (chunk.candidates && chunk.candidates.length > 0) {
        const candidate = chunk.candidates[0]
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              extractedText += part.text
            }
            if (part.functionCall) {
              extractedFunctionCalls.push(part.functionCall)
            }
          }
        }
      }
    }

    const response = await streamingResult.response

    if (!extractedText && extractedFunctionCalls.length === 0) {
      if (!response) {
        const errorMessage = "未返回有效的最终响应（可能被提前拦截）。"
        logger.warn(errorMessage)
        return errorMessage
      }
      if (response.promptFeedback && response.promptFeedback.blockReason) {
        const errorMessage = `响应被拦截，原因: ${response.promptFeedback.blockReason}`
        logger.warn(errorMessage)
        return errorMessage
      }

      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0]
        const finishReason = candidate.finishReason
        const errorMessage = `返回空内容。${finishReason ? ` 结束原因: ${finishReason}` : ""}`
        logger.warn(errorMessage, JSON.stringify(response.candidates, null, 2))
        return errorMessage
      }

      const errorMessage = "未返回有效响应或候选。"
      logger.warn(errorMessage, JSON.stringify(response, null, 2))
      return errorMessage
    } else {
      return { text: extractedText, functionCalls: extractedFunctionCalls }
    }
  } catch (error) {
    const errorMessage = `调用 API 失败: ${error.message}`
    logger.error(errorMessage, error)
    return errorMessage
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
) {
  const channelsConfig = Setting.getConfig("Channels")
  if (!channelsConfig || typeof channelsConfig !== "object") {
    return "配置错误：未找到 'Channels' 配置文件或其格式不正确。"
  }

  let channelConfig = null
  let channelType = null

  for (const type in channelsConfig) {
    if (Array.isArray(channelsConfig[type])) {
      const foundChannel = channelsConfig[type].find(c => c.name === channelName)
      if (foundChannel) {
        channelConfig = foundChannel
        channelType = type
        break
      }
    }
  }

  if (!channelConfig) {
    if (channelName !== "default") {
      logger.warn(`渠道 "${channelName}" 未找到，尝试回退到 'default' 渠道。`)
      return getAI(
        "default",
        e,
        queryParts,
        presetPrompt,
        enableGroupContext,
        enableTools,
        historyContents,
      )
    }
    return `渠道错误：未找到名为 "${channelName}" 的可用渠道。`
  }
  logger.info(`正在使用渠道 "${channelName}"，类型: ${channelType}`)
  const requestArgs = [
    channelConfig,
    e,
    queryParts,
    presetPrompt,
    enableGroupContext,
    enableTools,
    historyContents,
  ]

  let result
  if (channelType === "gemini") {
    result = await _getGeminiResponse(...requestArgs)
  } else if (channelType === "vertex") {
    result = await _getVertexAIResponse(...requestArgs)
  } else if (channelType === "openai") {
    result = await _getOpenAIResponse(...requestArgs)
  }

  if (typeof result === "string" && channelName !== "default") {
    logger.info("尝试使用 'default' 渠道进行重试...")
    return getAI(
      "default",
      e,
      queryParts,
      presetPrompt,
      enableGroupContext,
      enableTools,
      historyContents,
    )
  }
  return result
}
