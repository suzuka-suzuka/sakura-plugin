import Setting from "../lib/setting.js"
import { getPixivClient } from "../lib/pixiv/api.js"
import { searchPixivImage } from "../lib/pixiv/search.js"
import { FlipImage } from "../lib/ImageUtils/ImageUtils.js"

const processingUsers = new Set()

export class pixivSearch extends plugin {
  constructor() {
    super({
      name: "pixiv搜图",
      event: "message",
      priority: 1135,
    })
  }

  get appconfig() {
    return Setting.getConfig("pixiv")
  }

  get r18Config() {
    return Setting.getConfig("r18")
  }

  getPixivByPid = Command(/^#?pid(.*)$/, async (e) => {
    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      return e.reply("未配置 Pixiv Cookie 或 RefreshToken，请先在插件设置中填写。", 10, true)
    }

    const match = e.msg.match(/^#?pid\s*(\d+)(?:\s*[pP]\s*(\d+))?/)
    if (!match) return false

    const lockKey = `pid:${e.user_id}`
    if (processingUsers.has(lockKey)) return false
    processingUsers.add(lockKey)

    const pid = match[1]
    const pageNum = parseInt(match[2]) || 1

    await e.reply(`正在获取P站作品ID: ${pid} (第${pageNum}页)...`, 10, false)

    try {
      const pixivCli = await getPixivClient()
      const detailRes = await pixivCli.illustDetail({ illustId: parseInt(pid) })

      if (!detailRes || detailRes.status !== 200 || !detailRes.data?.illust) {
        await e.reply(`获取作品详情失败: 作品可能已被删除或为私密作品`, 10, true)
        return true
      }
      const illust = detailRes.data.illust

      let pages = []
      if (illust.meta_pages && illust.meta_pages.length > 0) {
        pages = illust.meta_pages.map(page => ({ urls: { original: page.image_urls.original } }))
      } else if (illust.meta_single_page) {
        pages.push({ urls: { original: illust.meta_single_page.original_image_url } })
      }

      const isR18 = illust.x_restrict !== 0
      if (isR18 && !this.r18Config.Groups.includes(e.group_id)) {
        return e.reply("本群未开启r18功能哦~", 10, false)
      }
      await this.sendIllustMessage(e, illust, pages, isR18, pageNum)
    } catch (error) {
      logger.error(`[P站搜图][PID:${pid}] 请求API时发生错误: ${error}`)
      let replyMsg = "哎呀，网络似乎出了点问题，请稍后再试吧~"
      if (error.status === 429) {
        replyMsg = `P站API请求过于频繁，已被临时拒绝。请稍后再试！`
      } else if (error.status) {
        replyMsg = `请求P站API失败，HTTP状态码: ${error.status}。可能是Token失效或作品不存在。`
      } else {
        replyMsg = `请求P站API时出错: ${error.message}`
      }
      await e.reply(replyMsg, 10, true)
    } finally {
      processingUsers.delete(lockKey)
    }
    return true
  });

  searchPixiv = Command(/^#?来张插画(。)?(.*)$/, async (e) => {
    const match = e.msg.match(/^#?来张插画(。)?(.*)$/)
    if (!match) return false

    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      return e.reply("未配置 Pixiv Cookie 或 RefreshToken，请先在插件设置中填写。", 10, true)
    }

    const isR18Search = !!match[1]
    let tag = match[2].trim()

    if (isR18Search && !this.r18Config.Groups.includes(e.group_id)) {
      return e.reply("根据插件设置，本群不可使用r18功能。", 10, false)
    }
    if (!tag) {
      const defaultTags = config.defaultTags
      if (Array.isArray(defaultTags) && defaultTags.length > 0) {
        tag = defaultTags[Math.floor(Math.random() * defaultTags.length)]
      } else {
        return false
      }
    }

    const lockKey = `search:${e.user_id}`
    if (processingUsers.has(lockKey)) return false
    processingUsers.add(lockKey)

    await e.react(124)

    try {
      const result = await searchPixivImage(tag, isR18Search)

      if (!result) {
        await e.reply(`未能找到符合条件的图片，请换个标签再试。`, 10, true)
        return true
      }

      const { illust, imageUrls } = result
      const pages = imageUrls.map(url => ({ urls: { original: url } }))
      const isR18 = illust.x_restrict !== 0
      await this.sendIllustMessage(e, illust, pages, isR18)
    } catch (error) {
      logger.error(`[P站搜图] 请求API时发生错误: ${error}`)
      let replyMsg = "哎呀，网络似乎出了点问题，请稍后再试吧~"
      if (error.status === 429) {
        replyMsg = `P站API请求过于频繁，已被临时拒绝。请稍后再试！`
      } else if (error.status) {
        replyMsg = `搜索失败，API返回错误: ${error.status}，可能是Token失效了。`
      } else {
        replyMsg = `搜索失败: ${error.message}`
      }
      await e.reply(replyMsg, 10, true)
    } finally {
      processingUsers.delete(lockKey)
    }

    return true
  });

  async sendIllustMessage(e, illust, pages, isR18 = false, pageNum = 1) {
    const config = this.appconfig
    const imagesPerPage = 3
    const totalPages = pages.length
    const totalImagePages = Math.ceil(totalPages / imagesPerPage)

    if (totalPages > 0 && pageNum > totalImagePages) {
      await e.reply(`该作品只有 ${totalImagePages} 页图片哦~ (共${totalPages}张)`, 10, false)
      return true
    }

    const startIndex = (pageNum - 1) * imagesPerPage
    const imagesToSend = pages.slice(startIndex, startIndex + imagesPerPage)

    const imageUrls = imagesToSend.map(page => {
      let proxiedUrl = page.urls.original
      if (config.proxy) {
        const u = new URL(page.urls.original)
        u.hostname = config.proxy
        proxiedUrl = u.href
      }
      return proxiedUrl
    })

    const tags = illust.tags?.slice(0, 5).map(t => `#${t.name}`).join(" ") || "无"

    const sendImages = async (imgs) => e.reply(imgs, 0, false)

    let imgSendResult = await sendImages(imageUrls.map(url => segment.image(url)))
    if (imgSendResult?.message_id) {
      if (isR18) e.recall(imgSendResult.message_id, 10)
    } else {
      e.reply("图片发送失败，正在尝试翻转后重发...", 10, true)
      const flippedBuffers = []
      for (const url of imageUrls) {
        const buf = await FlipImage(url)
        if (buf) flippedBuffers.push(buf)
      }

      if (flippedBuffers.length > 0) {
        imgSendResult = await sendImages(flippedBuffers.map(buf => segment.image(buf)))
        if (imgSendResult?.message_id && isR18) e.recall(imgSendResult.message_id, 10)
      }

      if (!imgSendResult?.message_id) {
        const linkResult = await e.reply("图片最终发送失败，请点击链接查看：\n" + imageUrls.join("\n"), 0, false)
        if (linkResult?.message_id && isR18) e.recall(linkResult.message_id, 10)
      }
    }

    await e.reply(`pid:${illust.id}\n标签：${tags}`, 60, false)

    await e.reply("图片已发送", 10, true)

    return true
  }
}
