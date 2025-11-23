import plugin from "../../../lib/plugins/plugin.js"
import { grokRequest } from "../lib/AIUtils/GrokClient.js"
import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"

export class GrokVideo extends plugin {
  constructor() {
    super({
      name: "Grok视频生成",
      dsc: "使用Grok生成视频",
      event: "message",
      priority: 1000,
      rule: [
        {
          reg: "^#?gv\\s*(.+)",
          fnc: "generateVideo",
          log: false,
        },
      ],
    })
  }

  async generateVideo(e) {
    const match = e.msg.match(/^#?gv\s*(.+)/)
    if (!match) return false

    const prompt = match[1].trim()
    if (!prompt) {
      await this.reply("请提供视频生成提示词", true, { recallMsg: 10 })
      return true
    }

    const imageUrls = await getImg(e, true)

    const channelsConfig = Setting.getConfig("Channels")
    const grokChannel = channelsConfig?.grok?.find(c => c.name === "video")

    if (!grokChannel || !grokChannel.sso) {
      return false
    }
    await this.reply("正在生成视频，请稍候...", true, { recallMsg: 10 })

    try {
      const content = []
      if (imageUrls && imageUrls.length > 0) {
        content.push({ type: "image_url", image_url: { url: imageUrls[0] } })
      }
      content.push({ type: "text", text: prompt })

      const messages = [
        {
          role: "user",
          content: content,
        },
      ]

      const grokConfig = {
        sso: grokChannel.sso,
        supersso: grokChannel.supersso,
        cf_clearance: grokChannel.cf_clearance,
        x_statsig_id: grokChannel.x_statsig_id,
        temporary: grokChannel.temporary !== false,
        dynamic_statsig: grokChannel.dynamic_statsig !== false,
      }

      const model = grokChannel.model

      const request = {
        model: model,
        messages: messages,
      }

      const result = await grokRequest(request, grokConfig, e)

      if (!result || typeof result === "string") {
        await this.reply(`视频生成失败: ${result || "未知错误"}`, true, { recallMsg: 10 })
        return true
      }

      if (result.videos && result.videos.length > 0) {
        const video = result.videos[0]
        if (video.localPath) {
          await e.reply(segment.video(video.localPath))
        } else {
          await this.reply("视频下载失败", true, { recallMsg: 10 })
        }
      } else {
        await this.reply("未返回视频", true, { recallMsg: 10 })
      }
    } catch (error) {
      logger.error("[GrokVideo] 生成视频时出错:", error)
      await e.reply(`视频生成出错: ${error.message}`, true)
    }

    return true
  }
}
