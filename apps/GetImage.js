import { connect } from "puppeteer-real-browser"
import { FlipImage } from "../lib/ImageUtils/ImageUtils.js"
import { randomEmojiLike } from "../lib/utils.js"
import _ from "lodash"

const IMAGE_SOURCES = {
  yande: {
    url: "https://yande.re/post.json?tags=loli+-rating:e+-nipples&limit=500",
    usePuppeteer: false,
  },
  konachan: {
    url: "https://konachan.com/post.json?tags=loli+-rating:e+-nipples&limit=500",
    usePuppeteer: true,
  },
}

export class GetImagePlugin extends plugin {
  constructor() {
    super({
      name: "GetImage",
      dsc: "获取 yande/konachan 的图片",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^#?图(y|k)$",
          fnc: "handleImage",
          log: false,
        },
      ],
    })
  }

  async handleImage(e) {
    const sourceMap = {
      y: "yande",
      k: "konachan",
    }
    const match = e.msg.match(/^#?图(y|k)$/)
    if (!match) return false
    const sourceKey = sourceMap[match[1]]
    return await this.fetchAndSendImage(e, sourceKey)
  }

  async fetchAndSendImage(e, sourceKey) {
    const sourceConfig = IMAGE_SOURCES[sourceKey]

    await randomEmojiLike(e, 124)

    let jsonData

    try {
      if (sourceConfig.usePuppeteer) {
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

          await page.goto(sourceConfig.url, {
            waitUntil: "networkidle2",
            timeout: 20000,
          })

          await new Promise(resolve => setTimeout(resolve, 20000))

          const jsonText = await page.evaluate(() => document.body.innerText)
          jsonData = JSON.parse(jsonText)
        } finally {
          if (browser) {
            await browser.close()
          }
        }
      } else {
        const response = await fetch(sourceConfig.url)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        jsonData = await response.json()
      }

      if (Array.isArray(jsonData) && jsonData.length > 0) {
        const imageUrls = jsonData.map(item => item?.file_url).filter(url => url)

        if (imageUrls.length > 0) {
          const imageUrl = _.sample(imageUrls)
          const sendResult = await e.reply(segment.image(imageUrl))

          if (!sendResult?.message_id) {
            logger.warn(`图片URL发送失败 (${sourceKey}): ${imageUrl}，尝试备用方案...`)
            await this.reply("图片发送失败，正在尝试翻转图片...", true, { recallMsg: 10 })
 
            const flippedBuffer = await FlipImage(imageUrl)
            if (flippedBuffer) {
              const finalSendResult = await e.reply(segment.image(flippedBuffer))
              if (!finalSendResult?.message_id) {
                await this.reply("翻转后图片也发送失败，可能图片太色了", true, { recallMsg: 10 })
              }
            } else {
              await this.reply("图片翻转失败", true, { recallMsg: 10 })
            }
          }
        } else {
          logger.warn("没有获取到有效的图片URL", true, { recallMsg: 10 })
          await this.reply("获取失败,没有有效的图片URL", true, { recallMsg: 10 })
        }
      } else {
        await this.reply("获取失败,没有获取到有效的图片数据", true, { recallMsg: 10 })
      }
    } catch (error) {
      logger.error(`整体处理流程出错:`, error)
      await this.reply("获取失败,发生错误，请稍后再试", true, { recallMsg: 10 })
    }
  }
}
