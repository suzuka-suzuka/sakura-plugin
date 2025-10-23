import fs from "node:fs"
import path from "node:path"
import {plugindata} from "../../path.js"
import axios from "axios"
import https from "https"
import adapter from "../../adapter.js"
import { AbstractTool } from "./AbstractTool.js"
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai"
import Setting from "../../setting.js"
const channelApiKeyIndex = new Map()
export class VideoAnalyzerTool extends AbstractTool {
  name = "videoAnalyzer"

  parameters = {
    properties: adapter === 0
      ? {
          url: {
            type: "string",
            description: "视频URL",
          },
          query: {
            type: "string",
            description: "你希望对视频提出的问题，用中文描述。",
          },
        }
      : {
          file: {
            type: "string",
            description: "视频file字段",
          },
          query: {
            type: "string",
            description: "你希望对视频提出的问题，用中文描述。",
          },
        },
    required: adapter === 0 ? ["url", "query"] : ["file", "query"],
  }
  description = "当你需要分析或描述视频时使用"

  func = async function (opts, e) {
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
    let localVideoPath = null
    let query = null
    try {
      if (adapter === 0) {
        const { url: videoUrl, query: q } = opts
        query = q
        if (!videoUrl || !query) {
          return "错误：视频的 url 和 查询文本 (query) 不能为空。"
        }

        const downloadDir = path.join(plugindata, "video")
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true })
        }
        const response = await axios({
          method: "GET",
          url: videoUrl,
          responseType: "stream",
          httpsAgent: new https.Agent({
            rejectUnauthorized: false,
          }),
        })
        const fileName = path.join(downloadDir, `${Date.now()}.mp4`)
        const writer = fs.createWriteStream(fileName)
        response.data.pipe(writer)
        await new Promise((resolve, reject) => {
          writer.on("finish", resolve)
          writer.on("error", reject)
        })
        localVideoPath = fileName
      } else {
        const { file, query: q } = opts
        query = q
        if (!file || !query) {
          return "错误：视频的file标识 (file) 和 查询文本 (query) 不能为空。"
        }
        const fileResult = await e.bot.getFile(file)
        if (!fileResult || !fileResult.data || !fileResult.data.file) {
          return "抱歉，无法从服务器获取视频文件路径，请稍后重试。"
        }
        localVideoPath = fileResult.data.file
        if (!fs.existsSync(localVideoPath)) {
          return `错误：指定的视频文件不存在: ${localVideoPath}`
        }
      }

      const myfile = await ai.files.upload({
        file: localVideoPath,
        config: { mimeType: "video/mp4" },
      })

      await new Promise(resolve => setTimeout(resolve, 10000))

      const aiResponse = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: createUserContent([createPartFromUri(myfile.uri, myfile.mimeType), query]),
      })

      const description = aiResponse.text
      return description ? `视频AI描述:\n${description}` : "未能获取视频AI描述。"
    } catch (error) {
      console.error("[VideoAnalyzerTool] Error:", error)
      return `处理视频时发生错误: ${error?.message || error || '未知错误'}`
    }
  }
}
