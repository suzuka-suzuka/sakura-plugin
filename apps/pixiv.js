import Setting from "../lib/setting.js"
import { getPixivClient } from "../lib/pixiv/api.js"
import { searchPixivImage } from "../lib/pixiv/search.js"
import { FlipImage } from "../lib/ImageUtils/ImageUtils.js"
import {
  getRankingItemFromRedis,
  getRankingOverview,
  buildRankingForwardParams,
} from "../lib/pixiv/ranking.js"

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
    await e.react(124)
    const pid = match[1]
    const pageNum = parseInt(match[2]) || 1

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

    const sendImages = async (imgs, recallTime = 0) => e.reply(imgs, recallTime, false)

    const initialRecallTime = isR18 ? (config.recallTime ?? 10) : 0
    let imgSendResult = await sendImages(imageUrls.map(url => segment.image(url)), initialRecallTime)

    if (!imgSendResult?.message_id) {
      e.reply("图片发送失败，正在尝试翻转后重发...", 10, true)
      const flippedBuffers = []
      for (const url of imageUrls) {
        const buf = await FlipImage(url)
        if (buf) flippedBuffers.push(buf)
      }

      if (flippedBuffers.length > 0) {
        const fallbackRecallTime = config.recallTime ?? 10
        imgSendResult = await sendImages(flippedBuffers.map(buf => segment.image(buf)), fallbackRecallTime)
      }

      if (!imgSendResult?.message_id) {
        imgSendResult = await e.reply("图片最终发送失败，请点击链接查看：\n" + imageUrls.join("\n"), 60, false)
      }
    }

    const bookmarks = illust.total_bookmarks || 0
    const views = illust.total_view || 0
    const bookRate = views > 0 ? ((bookmarks / views) * 100).toFixed(2) : '0.00'
    const pageCount = illust.page_count || illust.meta_pages?.length || 1
    const pageStr = pageCount > 3 ? ` (共${pageCount}张)` : ''

    await e.reply(`PID: ${illust.id}${pageStr}\n收藏: ${bookmarks} | 浏览: ${views} | 收藏率: ${bookRate}%\n标签: ${tags}`, 60, false)

    await e.reply("图片已发送", 10, true)

    return true
  }

  // ============ 排行榜功能 ============

  /**
   * 查看排行榜一览（没有缓存则自动拉取）
   * 触发: #日榜 / #周榜 / #月榜 等
   */
  viewRanking = Command(/^#?(日榜|周榜|月榜|男性日榜|女性日榜|原创日榜|新人日榜|r18日榜|r18周榜)$/, async (e) => {
    const match = e.msg.match(/^#?(日榜|周榜|月榜|男性日榜|女性日榜|原创日榜|新人日榜|r18日榜|r18周榜)$/)
    if (!match) return false

    const modeKey = match[1]

    // R18排行榜检查
    if (modeKey.includes("r18") && !this.r18Config.Groups.includes(e.group_id)) {
      return e.reply("本群未开启R18功能，无法查看R18排行榜~", 10, false)
    }

    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      return e.reply("未配置 Pixiv Cookie 或 RefreshToken，请先在插件设置中填写。", 10, true)
    }

    const lockKey = `ranking:view:${e.user_id}`
    if (processingUsers.has(lockKey)) return false
    processingUsers.add(lockKey)

    await e.react(124)

    try {
      const result = await getRankingOverview(modeKey)

      if (result.images && result.images.length > 0) {
        const sendResult = await this.sendRankingForward(e, result, modeKey)
        if (!sendResult || !sendResult.message_id) {
          await e.reply(`${modeKey}已经发送过了，请往上翻翻~，${modeKey}每天11刷新哦~`, 10, true)
        }
      } else {
        await e.reply(`${modeKey}暂无数据，请稍后再试~`, 10, true)
      }
    } catch (error) {
      logger.error(`[P站排行榜] 查看${modeKey}失败: ${error}`)
      await e.reply(`获取${modeKey}失败: ${error.message}`, 10, true)
    } finally {
      processingUsers.delete(lockKey)
    }

    return true
  });

  /**
   * 以合并转发形式发送排行榜一览图
   */
  async sendRankingForward(e, result, modeKey) {
    const { nodes, prompt, news, source } = buildRankingForwardParams(result, modeKey, e.self_id)
    const sendResult = await e.sendForwardMsg(nodes, { prompt, news, source })
    return sendResult
  }

  /**
   * 获取指定排名的作品
   * 触发: 日榜#1 / 周榜#5 / 月榜#10 或 日榜1 / 周榜5 等
   */
  getRankingItem = Command(/^#?(日榜|周榜|月榜|男性日榜|女性日榜|原创日榜|新人日榜|r18日榜|r18周榜)#?(\d+)$/, async (e) => {
    const match = e.msg.match(/^#?(日榜|周榜|月榜|男性日榜|女性日榜|原创日榜|新人日榜|r18日榜|r18周榜)#?(\d+)$/)
    if (!match) return false

    const modeKey = match[1]
    const rank = parseInt(match[2])

    // R18排行榜检查
    const isR18 = modeKey.includes("r18")
    if (isR18 && !this.r18Config.Groups.includes(e.group_id)) {
      return e.reply("本群未开启R18功能，无法查看R18排行榜~", 10, false)
    }

    if (rank < 1) {
      return e.reply("排名必须大于0哦~", 10, true)
    }

    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      return e.reply("未配置 Pixiv Cookie 或 RefreshToken，请先在插件设置中填写。", 10, true)
    }

    const lockKey = `ranking:item:${e.user_id}`
    if (processingUsers.has(lockKey)) return false
    processingUsers.add(lockKey)
    await e.react(124)
    try {
      const modeMap = {
        "日榜": "daily",
        "周榜": "weekly",
        "月榜": "monthly",
        "男性日榜": "daily_male",
        "女性日榜": "daily_female",
        "原创日榜": "daily_original",
        "新人日榜": "daily_rookie",
        "r18日榜": "daily_r18",
        "r18周榜": "weekly_r18",
      }
      const mode = modeMap[modeKey] || "daily"

      const item = await getRankingItemFromRedis(mode, rank)

      if (!item) {
        return e.reply(`${modeKey}第${rank}名不存在，请先发送"${modeKey}"或检查排名是否超出范围~`, 10, true)
      }

      // 直接从 Redis 缓存中取原图链接，无需再调 API
      let pages = []
      if (item.meta_pages && item.meta_pages.length > 0) {
        pages = item.meta_pages.map(page => ({ urls: { original: page.image_urls.original } }))
      } else if (item.meta_single_page?.original_image_url) {
        pages.push({ urls: { original: item.meta_single_page.original_image_url } })
      }

      if (pages.length === 0) {
        return e.reply(`${modeKey}第${rank}名缓存中无图片链接，请先发送"${modeKey}"重新获取~`, 10, true)
      }

      // 构造 illust 对象（复用缓存数据）
      const illust = {
        id: item.id,
        title: item.title,
        user: { name: item.user_name },
        total_bookmarks: item.total_bookmarks,
        total_view: item.total_view,
        tags: item.tags || [],
      }

      // 发送图片和信息
      await this.sendRankingIllustMessage(e, illust, pages, isR18, rank, modeKey, item)

    } catch (error) {
      logger.error(`[P站排行榜] 获取${modeKey}第${rank}名失败: ${error}`)
      await e.reply(`获取作品失败: ${error.message}`, 10, true)
    } finally {
      processingUsers.delete(lockKey)
    }

    return true
  });

  /**
   * 发送排行榜作品消息
   */
  async sendRankingIllustMessage(e, illust, pages, isR18 = false, rank, modeKey, rankInfo) {
    const config = this.appconfig
    const imagesPerPage = 3
    const totalPages = pages.length

    const startIndex = 0
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

    const sendImages = async (imgs, recallTime = 0) => e.reply(imgs, recallTime, false)

    const initialRecallTime = isR18 ? (config.recallTime ?? 10) : 0
    let imgSendResult = await sendImages(imageUrls.map(url => segment.image(url)), initialRecallTime)

    if (!imgSendResult?.message_id) {
      e.reply("图片发送失败，正在尝试翻转后重发...", 10, true)
      const flippedBuffers = []
      for (const url of imageUrls) {
        const buf = await FlipImage(url)
        if (buf) flippedBuffers.push(buf)
      }

      if (flippedBuffers.length > 0) {
        const fallbackRecallTime = config.recallTime ?? 10
        imgSendResult = await sendImages(flippedBuffers.map(buf => segment.image(buf)), fallbackRecallTime)
      }

      if (!imgSendResult?.message_id) {
        imgSendResult = await e.reply("图片最终发送失败，请点击链接查看：\n" + imageUrls.join("\n"), 60, false)
      }
    }
    const pageStr = totalPages > imagesPerPage ? `(共${totalPages}张)` : ''
    const infoMsg = [
      `【${modeKey}第${rank}名】`,
      `PID: ${illust.id} ${pageStr}`,
      `点赞率: ${((rankInfo?.likeRate || 0) * 100).toFixed(2)}% | 收藏率: ${((rankInfo?.bookmarkRate || 0) * 100).toFixed(2)}%`,
      `收藏: ${illust.total_bookmarks || 0} | 浏览: ${illust.total_view || 0}`,
      `标签: ${tags}`,
    ].filter(Boolean).join("\n")

    await e.reply(infoMsg, 60, false)

    return true
  }
}
