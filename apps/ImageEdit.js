import { GoogleGenAI, Modality } from "@google/genai"
import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"
import sharp from "sharp"

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
        reg: "^#i(.*)$",
        fnc: "editImageHandler",
        log: false,
      },
    ]

    if (this.task && Array.isArray(this.task)) {
      for (const task of this.task) {
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
    const matchedTask = this.task.find(t => new RegExp(t.reg).test(e.msg))
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
      const GEMINI_MODEL = "gemini-2.5-flash-image-preview"
      const config = Setting.getConfig("Vertex")
      if (!config || !config.PROJECT_ID || !config.LOCATION) {
        throw new Error("配置错误：未找到 'Vertex' 配置文件或缺少 PROJECT_ID/LOCATION。")
      }
      const { PROJECT_ID, LOCATION } = config
      const ai = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: LOCATION,
      })

      const safetySettings = [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_IMAGE_HATE", threshold: "OFF" },
        { category: "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_IMAGE_HARASSMENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT", threshold: "OFF" },
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
      logger.error(`调用Vertex AI失败:`, error)
      await this.reply("创作失败，可能是网络问题", true, { recallMsg: 10 })
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
