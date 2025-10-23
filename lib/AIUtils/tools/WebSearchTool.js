import { AbstractTool } from "./AbstractTool.js"
import { GoogleGenAI } from "@google/genai"
import Setting from "../../setting.js"
const channelApiKeyIndex = new Map()
export class WebSearchTool extends AbstractTool {
  name = "Search"
  description
  parameters = {
    properties: {
      query: {
        type: "string",
        description: "用于搜索的问题或关键词",
      },
    },
    required: ["query"],
  }

  constructor() {
    super()
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, "0")
    const day = String(today.getDate()).padStart(2, "0")
    this.description = `当你需要搜索或回答需要外部数据的问题时可以使用此工具。今天是 ${year}年${month}月${day}日`
  }

  func = async function (opts) {
    const channelsConfig = Setting.getConfig("Channels")
    const Config = channelsConfig?.gemini?.find(c => c.name === Setting.getConfig("AI").toolschannel)

    if (!Config || !Config.api || !Config.model) {
      throw new Error(
        "配置错误：未在 'gemini' 配置中找到有效配置或缺少api/model。",
      )
    }

    let API_KEY
    const GEMINI_MODEL = Config.model
    let apiKeys = Config.api

    if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
      apiKeys = apiKeys
        .split("\n")
        .map(key => key.trim())
        .filter(key => key)
    }

    if (Array.isArray(apiKeys) && apiKeys.length > 0) {
      const channelName = Config.name
      let currentIndex = channelApiKeyIndex.get(channelName) || 0

      if (currentIndex >= apiKeys.length) {
        currentIndex = 0
      }

      API_KEY = apiKeys[currentIndex]

      const nextIndex = (currentIndex + 1) % apiKeys.length
      channelApiKeyIndex.set(channelName, nextIndex)

      logger.info(`渠道 [${channelName}] 正在使用第 ${currentIndex + 1} 个 API Key: ${API_KEY}`)
    } else if (typeof apiKeys === "string" && apiKeys.trim()) {
      API_KEY = apiKeys.trim()
    } else {
      throw new Error("渠道配置中的 API Key 无效。")
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY })
    let { query } = opts

    if (!query || query.trim() === "") {
      return "你必须提供一个搜索查询。"
    }

    try {
      const groundingTool = { googleSearch: {} }
      const config = {
        tools: [groundingTool],
      }

      const internalGeminiResponse = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: query }] }],
        config,
      })

      const searchResultText = internalGeminiResponse.text

      return `${searchResultText}`
    } catch (error) {
      return `执行 Google Search 工具时发生意外错误：${error.message}`
    }
  }
}
