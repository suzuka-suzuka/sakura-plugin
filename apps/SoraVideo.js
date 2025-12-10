import plugin from "../../../lib/plugins/plugin.js"
import SoraClient from "../lib/AIUtils/SoraClient.js"
import { connect } from "puppeteer-real-browser"
import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"

let isGenerating = false

export class SoraVideo extends plugin {
  constructor() {
    super({
      name: "Sora视频生成",
      dsc: "使用Sora生成视频",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^([lps])?\\s*#v(\\+)?(.+)",
          fnc: "generateVideo",
          log: false,
        },
      ],
    })
  }

  async initClient() {
    let browser
    try {
      const isLinux = process.platform === "linux"

      const { page, browser: realBrowser } = await connect({
        headless: false,
        args: isLinux
          ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
          : [],
        turnstile: true,
        customConfig: {},
        connectOption: {},
        disableXvfb: false,
        ignoreAllFlags: false,
        ...(isLinux && {
          xvfbsession: true,
        }),
      })

      browser = realBrowser

      const config = Setting.getConfig("SoraVideo")
      const accessToken = config.access_token

      const client = new SoraClient(page, accessToken)
      return { client, browser }
    } catch (error) {
      logger.error(`[SoraVideo] 初始化客户端失败: ${error.message}`)
      throw error
    }
  }

  async generateVideo(e) {
    let browser = null

    try {
      if (isGenerating) {
        await this.reply("⏳ 当前有视频生成任务正在进行中，请稍后再试...", false, { recallMsg: 10 })
        return true
      }

      const match = e.msg.match(/^([lps])?\s*#v(\+)?(.+)/s)
      if (!match) {
        return false
      }

      const orientationPrefix = match[1]
      const isLongVideo = match[2] === "+"
      const prompt = match[3].trim()
      const nFrames = isLongVideo ? 450 : 300

      let orientation = "portrait"
      if (orientationPrefix === "l") {
        orientation = "landscape"
      } else if (orientationPrefix === "s") {
        orientation = "square"
      }

      if (!prompt) {
        return false
      }

      const imgs = await getImg(e, true)
      const hasImage = imgs && imgs.length > 0

      isGenerating = true

      if (e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
        await e.group.setMsgEmojiLike(e.message_id, "124")
      } else {
        await this.reply("正在生成视频，请稍候...", false, { recallMsg: 10 })
      }

      const { client, browser: browserInstance } = await this.initClient()
      browser = browserInstance

      let result

      const videoOptions = { orientation, nFrames }

      if (hasImage) {
        const imageUrl = imgs[0]

        const imageBuffer = await this.downloadImage(imageUrl)

        result = await client.imageToVideo(prompt, imageBuffer, {
          ...videoOptions,
          filename: "input.png",
        })
      } else {
        result = await client.textToVideo(prompt, videoOptions)
      }

      await e.reply(segment.video(result.url))

      return true
    } catch (error) {
      logger.error(`[SoraVideo] 生成视频失败: ${error.message}`)
      await this.reply(`❌ 视频生成失败: ${error.message}`, true, { recallMsg: 10 })
      return true
    } finally {
      isGenerating = false

      if (browser) {
        try {
          await browser.close()
        } catch (error) {
          logger.error(`[SoraVideo] 关闭浏览器失败: ${error.message}`)
        }
      }
    }
  }

  async downloadImage(url) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`下载图片失败: ${response.statusText}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (error) {
      logger.error(`[SoraVideo] 下载图片失败: ${error.message}`)
      throw error
    }
  }
}
