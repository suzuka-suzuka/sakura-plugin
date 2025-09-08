import { GoogleGenAI, Modality } from "@google/genai"
import { AbstractTool } from "./AbstractTool.js"
import Setting from "../../setting.js"
import sharp from "sharp"
export class ImageGeneratorTool extends AbstractTool {
  name = "ImageGenerator"

  parameters = {
    properties: {
      prompt: {
        type: "string",
        description: "用于生成或修改图片的英文描述性文字，请将描述性文字翻译为英文",
      },
      imageUrl: {
        type: "string",
        description: "图片的URL",
      },
    },
    required: ["prompt"],
  }

  description = "当你需要根据描述生成图片或者在提供一张图片的基础上生成新的内容时使用"

  func = async function (opts, e) {
    let { prompt, imageUrl } = opts

    if (!prompt) {
      return "你必须提供一个用于生成图片的描述。"
    }

    try {
      const channelsConfig = Setting.getConfig("Channels")
      const imageConfig = channelsConfig?.gemini?.find(c => c.name === "image")

      if (!imageConfig || !imageConfig.api || !imageConfig.model) {
        throw new Error(
          "配置错误：未在 'gemini' 配置中找到名称为 'image' 的有效配置或缺少api/model。",
        )
      }

      let API_KEY
      const GEMINI_MODEL = imageConfig.model
      let apiKeys = imageConfig.api

      if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
        apiKeys = apiKeys
          .split("\n")
          .map(key => key.trim())
          .filter(key => key)
      }

      if (Array.isArray(apiKeys) && apiKeys.length > 0) {
        const channelName = imageConfig.name
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
      const safetySettings = [
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "OFF",
        },
      ]
      const contents = []
      contents.push({ text: prompt })

      if (imageUrl) {
        const imageResponse = await fetch(imageUrl)
        if (!imageResponse.ok) {
          return `无法访问提供的图片URL，状态码: ${imageResponse.status}`
        }

        const contentType = imageResponse.headers.get("content-type")
        if (!contentType || !contentType.startsWith("image/")) {
          return `提供的URL内容不是有效的图片格式。 Content-Type: ${contentType}`
        }

        const arrayBuffer = await imageResponse.arrayBuffer()
        let buffer = Buffer.from(arrayBuffer)
        let finalMimeType = contentType

        if (contentType === "image/gif") {
          buffer = await sharp(buffer).toFormat("png").toBuffer()
          finalMimeType = "image/png"
        }

        const base64Image = buffer.toString("base64")

        contents.push({
          inlineData: {
            mimeType: finalMimeType,
            data: base64Image,
          },
        })
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: contents,
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          safetySettings: safetySettings,
        },
      })

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        part => part.inlineData && part.inlineData.mimeType.startsWith("image/"),
      )

      if (imagePart) {
        const imageData = imagePart.inlineData.data
        e.reply(segment.image(`base64://${imageData}`))
        return `已成功生成并发送图片。`
      } else {
        const textPart = response.candidates?.[0]?.content?.parts?.find(part => part.text)
        const textResponse = textPart ? textPart.text : "图片生成失败"
        return `${textResponse}`
      }
    } catch (error) {
      console.error("图片生成失败:", error)
      if (imageUrl && error.message && error.message.includes("Could not load image")) {
        return `图片生成失败，可能是由于提供的图片无法访问或格式不受支持。请检查图片URL或尝试其他图片。错误信息: ${error.message}`
      }
      return `图片生成失败，错误信息: ${error.message}`
    }
  }
}
