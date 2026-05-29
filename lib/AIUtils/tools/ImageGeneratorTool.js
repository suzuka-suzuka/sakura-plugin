import { AbstractTool } from "./AbstractTool.js"
import Setting from "../../setting.js"
import {
  fetchImageForGeneration,
  generateImageWithConfig,
} from "../ImageGenerationProvider.js"

export class ImageGeneratorTool extends AbstractTool {
  name = "ImageGenerator"

  parameters = {
    properties: {
      prompt: {
        type: "string",
        description: "用于生成或修改图片的英文描述性文字，请将描述性文字翻译为英文",
      },
      seq: {
        type: "array",
        items: {
          type: "integer",
        },
        description: "图片或动画表情的消息seq",
      },
      aspectRatio: {
        type: "string",
        description: "图片的宽高比，可选值: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9",
        enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
      },
      imageSize: {
        type: "string",
        description: "图片的分辨率，可选值: 1K, 2K, 4K",
        enum: ["1K", "2K", "4K"],
      },
    },
    required: ["prompt"],
  }

  description = "当你需要根据描述生成图片或者在提供一张图片的基础上生成新的内容时使用"

  func = async function (opts, e) {
    let { prompt, seq, aspectRatio, imageSize } = opts
    imageSize = imageSize || "1K"
    let imageUrls = []

    if (seq) {
      const seqList = Array.isArray(seq) ? seq : [seq]
      for (const s of seqList) {
        try {
          const history = await e.group.getChatHistory(s, 1)
          if (history && history.length > 0) {
            const targetMsg = history[0]
            let hasImage = false
            for (const msgPart of targetMsg.message) {
              if (msgPart.type === "image") {
                imageUrls.push(msgPart.url)
                hasImage = true
              }
            }
            if (hasImage && e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
              await e.group.setMsgEmojiLike(targetMsg.message_id, "128076")
            }
          }
        } catch (err) {
          logger.error(`获取消息 seq: ${s} 失败: ${err}`)
        }
      }
    }

    if (!prompt) {
      return "你必须提供一个用于生成图片的描述。"
    }

    try {
      const imageConfig = Setting.getConfig("EditImage")
      const imageInputs = []

      if (imageUrls && imageUrls.length > 0) {
        for (const imageUrl of imageUrls) {
          try {
            imageInputs.push(await fetchImageForGeneration(imageUrl))
          } catch (error) {
            logger.error(`处理图片 ${imageUrl} 时出错:`, error)
          }
        }
      }

      const result = await generateImageWithConfig({
        imageConfig,
        prompt,
        imageInputs,
        aspectRatio,
        imageSize,
        allowVertexFallback: true,
      })

      if (result.imageBase64) {
        e.reply(segment.image(`base64://${result.imageBase64}`))
        return `已成功生成并发送图片，禁止回复[图片]`
      } else if (result.imageUrl) {
        e.reply(segment.image(result.imageUrl))
        return `已成功生成并发送图片，禁止回复[图片]`
      } else {
        return `${result.text || "请求被拦截，请更换提示词或图片"}`
      }
    } catch (error) {
      logger.error("图片生成失败:", error)
      if (
        imageUrls &&
        imageUrls.length > 0 &&
        error.message &&
        error.message.includes("Could not load image")
      ) {
        return `图片生成失败，可能是由于提供的图片无法访问或格式不受支持。请检查图片URL或尝试其他图片。错误信息: ${error.message}`
      }
      return `图片生成失败，错误信息: ${error.message}`
    }
  }
}
