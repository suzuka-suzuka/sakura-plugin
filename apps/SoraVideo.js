import plugin from "../../../lib/plugins/plugin.js"
import SoraClient from "../lib/AIUtils/SoraClient.js"
import { connect } from "puppeteer-real-browser"
import { getImg } from "../lib/utils.js"

export class SoraVideo extends plugin {
  constructor() {
    super({
      name: "Sora视频生成",
      dsc: "使用Sora生成视频",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#v(.+)",
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

      const client = new SoraClient(page)
      return { client, browser }
    } catch (error) {
      logger.error(`[SoraVideo] 初始化客户端失败: ${error.message}`)
      throw error
    }
  }

  async generateVideo(e) {
    let browser = null

    try {
      const prompt = e.msg.replace(/^#v/, "").trim()

      if (!prompt) {
        return false
      }

      const imgs = await getImg(e)
      const hasImage = imgs && imgs.length > 0

      await e.reply("🎬 开始生成视频...", false, { recallMsg: 10 })

      const { client, browser: browserInstance } = await this.initClient()
      browser = browserInstance

      let result

      if (hasImage) {
        const imageUrl = imgs[0]

        const imageBuffer = await this.downloadImage(imageUrl)

        result = await client.imageToVideo(prompt, imageBuffer, {
          orientation: "landscape",
          nFrames: 300,
          maxWaitTime: 1500,
          pollInterval: 5,
          filename: "input.png",
        })
      } else {
        result = await client.textToVideo(prompt, {
          orientation: "landscape",
          nFrames: 300,
          maxWaitTime: 1500,
          pollInterval: 5,
        })
      }

      if (!result || !result.url) {
        await e.reply("❌ 视频生成失败，未获取到视频链接", false, { recallMsg: 10 })
        return true
      }

      await e.reply(segment.video(result.url))

      return true
    } catch (error) {
      logger.error(`[SoraVideo] 生成视频失败: ${error.message}`)
      await e.reply(`❌ 视频生成失败: ${error.message}`, false, { recallMsg: 10 })
      return true
    } finally {
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
