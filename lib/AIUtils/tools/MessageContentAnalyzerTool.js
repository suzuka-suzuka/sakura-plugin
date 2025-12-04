import { AbstractTool } from "./AbstractTool.js"
import { getAI } from "../getAI.js"
import sharp from "sharp"
import Setting from "../../setting.js"
import fs from "node:fs"
import path from "node:path"
import { plugindata } from "../../path.js"
import axios from "axios"
import https from "https"
import adapter from "../../adapter.js"
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai"
import { Recall } from "../../utils.js"

const channelApiKeyIndex = new Map()

export class MessageContentAnalyzerTool extends AbstractTool {
  name = "messageContentAnalyzer"

  parameters = {
    properties: {
      seq: {
        type: "array",
        items: {
          type: "integer",
        },
        description: "需操作的消息seq",
      },
      url: {
        type: "array",
        items: {
          type: "string",
        },
        description: "图片或视频的URL",
      },
      type: {
        type: "string",
        enum: ["image", "video", "forward", "recall", "essence", "unessence"],
        description:
          "需要操作的类型：image(图片), video(视频), forward(聊天记录), recall(撤回消息), essence(设为精华), unessence(取消精华)",
      },
      query: {
        type: "string",
        description: "你希望对操作内容提出的问题（仅在分析图片或视频时需要）",
      },
    },
    required: ["type"],
  }

  description = "通过seq或url(仅限其一)分析内容，或通过seq撤回/加精/取消加精消息"

  func = async function (opts, e) {
    let { seq, url, type, query } = opts

    if (!seq && !url) return "需提供seq或url。"
    if (seq && typeof seq === "number") seq = [seq]
    if (url && typeof url === "string") url = [url]

    if (
      (type === "video" || type === "forward") &&
      ((seq && seq.length > 1) || (url && url.length > 1))
    ) {
      return `${type}仅支持单条分析。`
    }

    if (url && url.length > 0) {
      if (!query) return "分析图片/视频需query。"

      if (type === "image") {
        return await this.processImages(url, query, e)
      } else if (type === "video") {
        return await this.processVideo(url[0], query, e)
      } else {
        return "URL仅支持image/video分析。"
      }
    }

    let targetMsgs = []
    for (const s of seq) {
      try {
        const history = await e.group.getChatHistory(s, 1)
        if (history && history.length > 0) {
          targetMsgs.push(history[0])
        } else {
          logger.warn(`未找到 seq: ${s} 的消息`)
        }
      } catch (err) {
        logger.error(`获取消息 seq: ${s} 失败: ${err}`)
      }
    }

    if (targetMsgs.length === 0) {
      return "未找到有效消息。"
    }

    if (["image", "video", "forward"].includes(type)) {
      for (const msg of targetMsgs) {
        if (e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
          await e.group.setMsgEmojiLike(msg.message_id, "128076")
        }
      }
    }

    if (["recall", "essence", "unessence"].includes(type)) {
      let successCount = 0
      let failCount = 0

      for (const msg of targetMsgs) {
        try {
          if (type === "recall") {
            Recall(e, msg.message_id, 0)
          } else if (type === "essence") {
            await e.bot.setEssenceMessage(msg.message_id)
          } else if (type === "unessence") {
            await e.bot.removeEssenceMessage(msg.message_id)
          }
          successCount++
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (err) {
          logger.error(`操作消息 ${msg.seq || msg.message_seq} 失败: ${err}`)
          failCount++
        }
      }
      return `操作完成。成功${successCount},失败${failCount}。`
    }

    if (!query && (type === "image" || type === "video")) return "分析图片/视频需query。"

    let imgUrls = []
    let videoUrl = null
    let forwardResid = null

    for (const targetMsg of targetMsgs) {
      for (const msgPart of targetMsg.message) {
        if (type === "image" && msgPart.type === "image") {
          imgUrls.push(msgPart.url)
        } else if (type === "video" && msgPart.type === "video") {
          if (adapter === 0) {
            try {
              videoUrl = await e.group.getVideoUrl(msgPart)
            } catch (err) {
              videoUrl = await e.group.getNTVideoUrl(msgPart)
            }
          } else {
            videoUrl = msgPart.url
          }
          if (videoUrl) break
        } else if (type === "forward") {
          if (msgPart.type === "json") {
            try {
              const data = JSON.parse(msgPart.data)
              if (data?.meta?.detail?.resid) {
                forwardResid = data.meta.detail.resid
              }
            } catch (e) {}
          } else if (msgPart.type === "forward") {
            forwardResid = msgPart.id || msgPart.resid
          }
          if (forwardResid) break
        }
      }
      if ((type === "video" && videoUrl) || (type === "forward" && forwardResid)) {
        break
      }
    }

    if (type === "video") {
      if (videoUrl) return await this.processVideo(videoUrl, query, e)
      return "未找到视频。"
    }

    if (type === "image") {
      if (imgUrls.length > 0) return await this.processImages(imgUrls, query, e)
      return "未找到图片。"
    }

    if (type === "forward") {
      if (forwardResid) return await this.processForwardMsg(forwardResid, query, e)
      return "未找到转发记录。"
    }

    return "未知类型。"
  }

  async processImages(imgUrls, question, e) {
    try {
      let queryParts = [{ text: question }]

      for (const imgUrl of imgUrls) {
        if (typeof imgUrl !== "string" || imgUrl.trim() === "") {
          continue
        }

        const imageResponse = await fetch(imgUrl)
        if (!imageResponse.ok) {
          logger.warn(`从URL获取图片失败: ${imgUrl}`)
          continue
        }

        const contentType = imageResponse.headers.get("content-type")

        if (!contentType || !contentType.startsWith("image/")) {
          logger.warn(`因内容类型无效${contentType}，正在跳过此URL${imgUrl}`)
          continue
        }

        const originalBuffer = Buffer.from(await imageResponse.arrayBuffer())

        let finalBuffer
        let finalMimeType

        if (contentType === "image/gif") {
          finalBuffer = await sharp(originalBuffer).toFormat("png").toBuffer()
          finalMimeType = "image/png"
        } else {
          finalBuffer = originalBuffer
          finalMimeType = contentType
        }

        const base64Image = finalBuffer.toString("base64")

        queryParts.push({
          inlineData: {
            mimeType: finalMimeType,
            data: base64Image,
          },
        })
      }

      if (queryParts.length <= 1) {
        return "获取图片失败。"
      }
      const Channel = Setting.getConfig("AI").toolschannel
      const result = await getAI(Channel, e, queryParts, "", false, false)

      if (typeof result === "object" && result.text) {
        return result.text
      }
      return result
    } catch (err) {
      logger.error(`处理图片失败: ${err}`)
      return `处理图片错误: ${err.message}`
    }
  }

  async processVideo(videoTarget, query, e) {
    const channelsConfig = Setting.getConfig("Channels")
    const Config = channelsConfig?.gemini?.find(
      c => c.name === Setting.getConfig("AI").toolschannel,
    )

    if (!Config || !Config.api || !Config.model) {
      throw new Error("配置错误：未在 'gemini' 配置中找到有效配置或缺少api/model。")
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
    let isTempFile = false

    try {
      const downloadDir = path.join(plugindata, "video")
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true })
      }
      const response = await axios({
        method: "GET",
        url: videoTarget,
        responseType: "stream",
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      })

      const fileName = `video_${Date.now()}.mp4`
      localVideoPath = path.join(downloadDir, fileName)
      const writer = fs.createWriteStream(localVideoPath)

      response.data.pipe(writer)

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve)
        writer.on("error", reject)
      })
      isTempFile = true

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
      return description ? description : "未获取到描述。"
    } catch (error) {
      logger.error("Video analysis error:", error)
      return `视频分析失败: ${error.message}`
    } finally {
      if (isTempFile && localVideoPath && fs.existsSync(localVideoPath)) {
        fs.unlinkSync(localVideoPath)
      }
    }
  }

  async processForwardMsg(resid, query, e) {
    try {
      const forwardMsg = await e.group.getForwardMsg(resid)
      if (!forwardMsg) {
        return "无法获取转发内容。"
      }

      let contentStr = ""

      for (const msg of forwardMsg) {
        const date = new Date(msg.time * 1000)
        const timeStr = date.toLocaleTimeString("zh-CN", { hour12: false })

        const nickname = msg.nickname || msg.sender?.nickname || msg.sender?.card || "未知用户"
        const userId = msg.user_id || msg.sender?.user_id || 0

        let messageHeader = `【${nickname}】(QQ:${userId}, 时间:${timeStr})`

        let contentParts = []
        if (Array.isArray(msg.message)) {
          for (const msgPart of msg.message) {
            switch (msgPart.type) {
              case "text":
                contentParts.push(msgPart.text)
                break
              case "at":
                contentParts.push(`@${msgPart.qq}`)
                break
              case "image": {
                const imageUrl = msgPart.url
                const isAnimated = msgPart.asface === true || msgPart.sub_type === 1
                contentParts.push(
                  isAnimated ? `[动画表情URL:${imageUrl}]` : `[图片URL:${imageUrl}]`,
                )
                break
              }
              case "video": {
                let videoUrl = null
                if (adapter === 0) {
                  try {
                    videoUrl = await e.group.getVideoUrl(msgPart)
                  } catch (err) {
                    try {
                      videoUrl = await e.group.getNTVideoUrl(msgPart)
                    } catch (e) {}
                  }
                } else {
                  videoUrl = msgPart.url
                }

                contentParts.push(videoUrl ? `[视频URL:${videoUrl}]` : `[视频]`)
                break
              }
              case "bface":
                if (msgPart.text) contentParts.push(msgPart.text)
                else contentParts.push(`[动画表情]`)
                break
              case "forward":
                contentParts.push("[聊天记录]")
                break
              case "json":
                try {
                  const jsonData = JSON.parse(msgPart.data)
                  if (jsonData.desc === "[聊天记录]" || jsonData.prompt === "[聊天记录]") {
                    contentParts.push("[聊天记录]")
                  } else {
                    contentParts.push("[JSON卡片]")
                  }
                } catch (e) {
                  contentParts.push("[JSON卡片]")
                }
                break
            }
          }
        }
        if (contentParts.length > 0) {
          contentStr += `${messageHeader}: ${contentParts.join("")}\n`
        }
      }

      if (contentStr.includes("[视频URL:") || contentStr.includes("[图片URL:")) {
        contentStr += "\n\n提示：分析其中图片/视频请用url参数。"
      }

      return contentStr
    } catch (err) {
      logger.error(`处理转发消息失败: ${err}`)
      return `处理转发消息错误: ${err.message}`
    }
  }
}
