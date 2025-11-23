import plugin from "../../../lib/plugins/plugin.js"
import { grokRequest } from "../lib/AIUtils/GrokClient.js"
import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"

export class GrokImage extends plugin {
  constructor() {
    super({
      name: "Grok图片编辑",
      dsc: "使用Grok编辑或生成图片",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^#?gi\\s*(.+)",
          fnc: "editImage",
          log: false,
        },
      ],
    })
  }

  async editImage(e) {
    const match = e.msg.match(/^#?gi\s*(.+)/)
    if (!match) return false

    const prompt = match[1].trim()
    if (!prompt) {
      return false
    }

    const imageUrls = await getImg(e, true)

    const channelsConfig = Setting.getConfig("Channels")
    const grokChannel = channelsConfig?.grok?.find(c => c.name === "gork")

    if (!grokChannel || !grokChannel.sso) {
      return false
    }

    await this.reply("🎨 正在进行创作, 请稍候...", true, { recallMsg: 10 })

    try {
      let messages = []

      if (imageUrls && imageUrls.length > 0) {
        messages = [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrls[0] } },
              { type: "text", text: prompt },
            ],
          },
        ]
      } else {
        messages = [
          {
            role: "user",
            content: prompt,
          },
        ]
      }

      const grokConfig = {
        sso: grokChannel.sso,
        supersso: grokChannel.supersso,
        cf_clearance: grokChannel.cf_clearance,
        x_statsig_id: grokChannel.x_statsig_id,
        temporary: grokChannel.temporary !== false,
        dynamic_statsig: grokChannel.dynamic_statsig !== false,
      }

      const request = {
        model: "grok-image",
        messages: messages,
      }

      const result = await grokRequest(request, grokConfig, e)

      if (!result || typeof result === "string") {
        await this.reply(`图片处理失败: ${result || "未知错误"}`, true, { recallMsg: 10 })
        return true
      }

      const replyMessages = []

      if (result.text && result.text.trim()) {
        replyMessages.push(result.text)
      }

      if (result.images && result.images.length > 0) {
        for (const image of result.images) {
          if (image.localPath) {
            replyMessages.push(segment.image(image.localPath))
          } else if (image.url) {
            replyMessages.push(segment.image(image.url))
          }
        }
      }

      if (result.videos && result.videos.length > 0) {
        for (const video of result.videos) {
          if (video.localPath) {
            replyMessages.push(segment.video(video.localPath))
          } else if (video.url) {
            replyMessages.push(`视频: ${video.url}`)
          }
        }
      }

      if (replyMessages.length > 0) {
        await e.reply(replyMessages, true)
      } else {
        await this.reply("处理完成，但未返回有效内容", true, { recallMsg: 10 })
      }
    } catch (error) {
      logger.error("[GrokImage] 处理图片时出错:", error)
      await this.reply(`图片处理出错: ${error.message}`, true, { recallMsg: 10 })
    }

    return true
  }
}
