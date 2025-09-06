import fs from "node:fs"
import { AbstractTool } from "./AbstractTool.js"
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai"

export class VideoAnalyzerTool extends AbstractTool {
  name = "videoAnalyzer"

  parameters = {
    properties: {
      file: {
        type: "STRING",
        description: "视频file字段",
      },
      query: {
        type: "STRING",
        description: "你希望对视频提出的问题，用中文描述。",
      },
    },
    required: ["file", "query"],
  }
  description = "当你需要分析或描述视频时使用"

  func = async function (opts, e) {
    const API_KEY = "AIzaSyBJTT0KDn0_wPEJ2O6T8605968SIB9Qm_w"
    const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20"
    const ai = new GoogleGenAI({ apiKey: API_KEY })
    const { file, query } = opts

    if (!file || !query) {
      return "错误：视频的file标识 (file) 和 查询文本 (query) 不能为空。"
    }

    try {
      const fileResult = await e.bot.getFile(file)

      if (!fileResult || !fileResult.data || !fileResult.data.file) {
        return "抱歉，无法从服务器获取视频文件路径，请稍后重试。"
      }

      const localVideoPath = fileResult.data.file

      if (!fs.existsSync(localVideoPath)) {
        return `错误：指定的视频文件不存在: ${localVideoPath}`
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
      console.error(`[VideoAnalyzerTool] Error: ${error.stack}`)
      return `处理视频时发生错误: ${error.message}`
    }
  }
}
