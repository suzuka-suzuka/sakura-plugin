import { FlipImage } from "../lib/ImageUtils/ImageUtils.js"
import common from "../../../lib/common/common.js"
const DEFAULT_PROXY = "pixiv.manbomanbo.asia"

const REGEX_CONFIG = {
  lolisuki: "^#?来张萝莉图$",
  lolicon: "^#?来张涩图(。)?(.*)$",
}

export class setuPlugin extends plugin {
  constructor() {
    super({
      name: "setu",
      dsc: "获取图片",
      event: "message.group",
      priority: 1135,
      rule: [
        { reg: REGEX_CONFIG.lolisuki, fnc: "handleApiRequest" },
        { reg: REGEX_CONFIG.lolicon, fnc: "handleApiRequest" },
      ],
    })
  }
  async handleApiRequest(e) {
    let apiType,
      tag,
      isR18 = false

    if (new RegExp(REGEX_CONFIG.lolicon).test(e.msg)) {
      const match = e.msg.match(new RegExp(REGEX_CONFIG.lolicon))
      apiType = "lolicon"
      isR18 = !!match?.[1]
      tag = match?.[2]?.trim() || ""
    } else {
      apiType = "lolisuki"
      tag = ""
    }

    await this.reply("正在获取图片...", true, { recallMsg: 10 })

    try {
      const apiFunction =
        apiType === "lolicon" ? this.fetchLolicon.bind(this) : this.fetchLolisuki.bind(this)
      const imageInfo = await apiFunction(tag, isR18)

      if (!imageInfo?.url) {
        return this.reply(tag ? `标签「${tag}」找不到对应的图片。` : "未能找到图片。", true, {
          recallMsg: 10,
        })
      }

      const messageText = `${imageInfo.id ? "pid:" + imageInfo.id : ""}${imageInfo.tags?.length ? "\n标签: " + imageInfo.tags.join(", ") : ""}`

      await this.sendImageWithRetry(e, imageInfo.url, messageText, apiType === "lolicon" && isR18)
    } catch (err) {
      logger.error(`处理API请求时出错 (${apiType}): ${err.message}`)
      await this.reply(`获取图片时出错: ${err.message}`, true, { recallMsg: 10 })
    }
  }

  async sendImageWithRetry(e, imageUrl, messageText, shouldRecall) {
    const sendOptions = shouldRecall ? { recallMsg: 10 } : {}

    let sendResult
    try {
      sendResult = await this.reply(segment.image(imageUrl), false, sendOptions)
    } catch (err) {
      logger.error(`初次发送图片失败 (URL): ${err.message}`)
      sendResult = null
    }

    let finalSuccess = !!sendResult?.message_id

    if (!finalSuccess) {
      await this.reply("图片发送失败，可能被风控，正在尝试翻转后重发...", false, { recallMsg: 10 })

      const flippedImageBuffer = await FlipImage(imageUrl)

      if (flippedImageBuffer) {
        sendResult = await this.reply(segment.image(flippedImageBuffer), false, sendOptions).catch(
          err => {
            logger.error(`第二次尝试发送图片失败 (flipped): ${err.message}`)
            return null
          },
        )
        finalSuccess = !!sendResult?.message_id
      } else {
        logger.error("翻转图片失败，很可能是源图片链接已失效(404)。")
        await this.reply("图片链接已失效，无法获取。", true, { recallMsg: 10 })
        return false
      }
    }

    if (finalSuccess) {
      if (messageText) {
        await this.reply(messageText, false, { recallMsg: 60 })
      }
      await common.sleep(500)
      await this.reply("图片已发送", true, { recallMsg: 10 })
    } else {
      await this.reply(`图片发送仍然失败，请自行查看图片链接：\n${imageUrl}`, true, { recallMsg: 10 })
    }

    return finalSuccess
  }

  async fetchApi(url, apiName) {
    const response = await fetch(url).catch(err => {
      throw new Error(`${apiName} 网络错误: ${err.message}`)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => `HTTP status ${response.status}`)
      throw new Error(`${apiName} API 错误: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    if (data.error || !data.data?.length) {
      throw new Error(`${apiName} API 返回错误或无数据: ${data.error || "空数据数组"}`)
    }
    return data.data[0]
  }

  async fetchLolisuki(tag = "") {
    const params = new URLSearchParams({
      num: "1",
      size: "original",
      taste: "1",
      proxy: DEFAULT_PROXY,
      ...(tag && { tag }),
    })
    const apiUrl = `https://lolisuki.cn/api/setu/v1?${params}`
    const imageInfo = await this.fetchApi(apiUrl, "Lolisuki")

    return {
      url: imageInfo.urls?.original,
      id: imageInfo.pid,
      tags: imageInfo.tags?.slice(0, 5) || [],
    }
  }

  async fetchLolicon(tag = "", isR18 = false) {
    const params = new URLSearchParams({
      size: "original",
      r18: isR18 ? "1" : "0",
      proxy: DEFAULT_PROXY,
      excludeAI: "true",
    })

    if (tag) {
      tag
        .split(/\s+/)
        .filter(Boolean)
        .forEach(t => params.append("tag", t))
    }

    const apiUrl = `https://api.lolicon.app/setu/v2?${params}`
    const imageInfo = await this.fetchApi(apiUrl, "Lolicon")

    return {
      url: imageInfo.urls?.original,
      id: imageInfo.pid,
      tags: imageInfo.tags?.slice(0, 5) || [],
    }
  }
}
