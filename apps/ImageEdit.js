import { GoogleGenAI, Modality } from "@google/genai"
import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"
import sharp from "sharp"

const channelApiKeyIndex = new Map()

export class EditImage extends plugin {
  constructor() {
    super({
      name: "AI图像编辑",
      dsc: "使用AI模型修改或生成图片",
      event: "message",
      priority: 1135,
      rule: [],
    })
    this.task = Setting.getConfig("EditImage")
    this.generateRules()
  }

  generateRules() {
    const rules = [
      {
        reg: "^#i([\\s\\S]*)$",
        fnc: "editImageHandler",
        log: false,
      },
    ]

    let tasks = this.task?.tasks || (Array.isArray(this.task) ? this.task : []);
    if (tasks && Array.isArray(tasks)) {
      for (const task of tasks) {
        if (task.reg && task.prompt) {
          rules.push({
            reg: task.reg,
            fnc: "dynamicImageHandler",
            log: false,
          })
        }
      }
    }
    this.rule = rules
  }

  async dynamicImageHandler(e) {
    let tasks = this.task?.tasks || (Array.isArray(this.task) ? this.task : []);
    if (!tasks || !Array.isArray(tasks)) return false
    
    const matchedTask = tasks.find(t => new RegExp(t.reg).test(e.msg))
    if (!matchedTask) return false

    let imageUrls = await getImg(e)
    if (!imageUrls || imageUrls.length === 0) {
      if (Array.isArray(e.message)) {
        const atMsg = e.message.find(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
        if (atMsg) {
          imageUrls = [`https://q1.qlogo.cn/g?b=qq&s=640&nk=${atMsg.qq}`]
        }
      }
    }

    if (!imageUrls || imageUrls.length === 0) {
      const commandName = e.msg.replace(/\^|\$/g, "")
      await this.reply(`请上传需要${commandName}的图片哦~`, true, { recallMsg: 10 })
      return true
    }

    const promptText = matchedTask.prompt
    return this._processAndCallAPI(e, promptText, imageUrls)
  }

  async editImageHandler(e) {
    const promptText = e.msg.replace(/^#i/, "").trim()
    let imageUrls = await getImg(e)

    if (!imageUrls || imageUrls.length === 0) {
      if (Array.isArray(e.message)) {
        const atMsg = e.message.find(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
        if (atMsg) {
          imageUrls = [`https://q1.qlogo.cn/g?b=qq&s=640&nk=${atMsg.qq}`]
        }
      }
    }

    if (!promptText) {
      await this.reply("请告诉我你想如何修改图片哦~ ", true, {
        recallMsg: 10,
      })
      return true
    }

    return this._processAndCallAPI(e, promptText, imageUrls)
  }

  async _processAndCallAPI(e, promptText, imageUrls) {
    await this.reply("🎨 正在进行创作, 请稍候...", true, { recallMsg: 10 })

    const contents = []
    const hasImage = imageUrls && imageUrls.length > 0

    if (promptText) {
      contents.push({ text: promptText })
    }

    if (hasImage) {
      for (const imageUrl of imageUrls) {
        try {
          const { base64Data, finalMimeType } = await this._processImage(imageUrl)
          contents.push({
            inlineData: {
              mimeType: finalMimeType,
              data: base64Data,
            },
          })
        } catch (error) {
          logger.error("处理其中一张图片时出错:", error)
          await this.reply("处理图片时失败，请重试", true, {
            recallMsg: 10,
          })
          return true
        }
      }
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
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ]

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
        await this.reply(segment.image(`base64://${imageData}`))
      } else {
        const textPart = response.candidates?.[0]?.content?.parts?.find(part => part.text)
        const textResponse = textPart ? textPart.text : "创作失败"
        await this.reply(`${textResponse}`, true, { recallMsg: 10 })
      }
    } catch (error) {
      logger.error(`调用 Gemini API 失败:`, error)
      await this.reply("创作失败，可能是配置或网络问题", true, { recallMsg: 10 })
    }

    return true
  }

  async _processImage(imageUrl) {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`图片下载失败: ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    let buffer = Buffer.from(arrayBuffer)
    const contentType = response.headers.get("content-type") || "image/jpeg"
    let finalMimeType = contentType

    if (contentType === "image/gif") {
      buffer = await sharp(buffer).toFormat("png").toBuffer()
      finalMimeType = "image/png"
    }

    const base64Data = buffer.toString("base64")
    return { base64Data, finalMimeType }
  }
}
