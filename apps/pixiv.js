import Setting from "../lib/setting.js"
import PixivHistory from "../lib/pixiv/history.js"
import { Recall } from "../lib/utils.js"
import { requestApi } from "../lib/pixiv/api.js"
import { FlipImage } from "../lib/ImageUtils/ImageUtils.js"
export class pixivSearch extends plugin {
  constructor() {
    super({
      name: "pixiv搜图",
      dsc: "Ppxiv搜图",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: `^#涩图(\。)?(.*)$`,
          fnc: "searchPixiv",
          log: false,
        },
        {
          reg: `^#?pid(.*)$`,
          fnc: "getPixivByPid",
          log: false,
        },
      ],
    })
  }
  get appconfig() {
    return Setting.getConfig("pixiv")
  }

  get r18Config() {
    return Setting.getConfig("r18")
  }

  async getPixivByPid(e) {
    const match = e.msg.match(/^#?pid\s*(\d+)(?:\s*[pP]\s*(\d+))?/)
    if (!match) {
      return false
    }

    const pid = match[1]
    const pageNum = parseInt(match[2]) || 1

    await this.reply(`正在获取P站作品ID: ${pid} (第${pageNum}页)...`, true, { recallMsg: 10 })

    try {
      const detailUrl = `https://www.pixiv.net/ajax/illust/${pid}`
      const detailRes = await requestApi(detailUrl)

      if (!detailRes.body) {
        await this.reply(`获取作品详情失败: 作品可能已被删除或为私密作品`, false, { recallMsg: 10 })
        return true
      }
      const illust = detailRes.body

      const pagesUrl = `https://www.pixiv.net/ajax/illust/${pid}/pages`
      const pagesRes = await requestApi(pagesUrl)

      if (!pagesRes.body || pagesRes.body.length === 0) {
        await this.reply(`获取作品图片列表失败: 未找到图片页面信息`, false, { recallMsg: 10 })
        return true
      }
      const pages = pagesRes.body

      const isR18 = illust.xRestrict !== 0
      if (isR18 && !this.r18Config.enable.includes(e.group_id)) {
        return this.reply("本群未开启r18功能哦~", true, { recallMsg: 10 })
      }
      await this.sendIllustMessage(e, illust, pages, isR18, pageNum)
    } catch (error) {
      logger.error(`[P站搜图][PID:${pid}] 请求API时发生错误: ${error}`)
      let replyMsg = "哎呀，网络似乎出了点问题，请稍后再试吧~"
      if (error.status) {
        if (error.status == 429) {
          replyMsg = `P站API请求过于频繁，已被临时拒绝。请稍后再试！`
        } else {
          replyMsg = `请求P站API失败，HTTP状态码: ${error.status}。可能是Cookie失效或作品不存在。`
        }
      } else {
        replyMsg = `请求P站API时出错: ${error.message}`
      }
      await this.reply(replyMsg, false, { recallMsg: 10 })
    }
    return true
  }

  async searchPixiv(e) {
    const match = e.msg.match(/^#涩图(\。)?(.*)$/)
    if (!match) return false

    const config = this.appconfig

    const isR18Search = !!match[1]
    let tag = match[2].trim()

    if (isR18Search && !this.r18Config.enable_group.includes(e.group_id)) {
      return this.reply("根据插件设置，本群不可使用r18功能。", true)
    }

    if (!tag) {
      const defaultTags = config.defaultTags
      if (Array.isArray(defaultTags) && defaultTags.length > 0) {
        const randomIndex = Math.floor(Math.random() * defaultTags.length)
        tag = defaultTags[randomIndex]
      } else {
        return false
      }
    }

    const minBookmarks = 500
    tag += ` 500users入り`

    await this.reply("获取中...请稍等", true, { recallMsg: 10 })

    try {
      let illust = null
      let pages = null

      for (let page = 1; ; page++) {
        const searchUrl = `https://www.pixiv.net/ajax/search/illustrations/${encodeURIComponent(tag)}?word=${encodeURIComponent(tag)}&order=date_d&mode=all&p=${page}&s_mode=s_tag_full&type=illust_and_ugoira&lang=zh`
        const searchRes = await requestApi(searchUrl)

        const pageIllustsData = searchRes.body?.illust?.data
        if (!pageIllustsData || pageIllustsData.length === 0) {
          break
        }
        let pageIllusts = pageIllustsData
        pageIllusts = pageIllusts.filter(i => i.illustType !== 2)

        if (isR18Search) {
          pageIllusts = pageIllusts.filter(i => i.xRestrict !== 0)
        } else {
          pageIllusts = pageIllusts.filter(i => i.xRestrict === 0)
        }

        if (config.excludeAI) {
          pageIllusts = pageIllusts.filter(i => i.aiType !== 2)
        }

        if (pageIllusts.length === 0) {
          continue
        }

        const minBookmarkViewRatio = config.minBookmarkViewRatio

        for (const tempIllust of pageIllusts) {
          if (await PixivHistory.isInHistory(e, tempIllust.id)) {
            continue
          }

          await new Promise(resolve => setTimeout(resolve, 500))

          let detailRes
          try {
            const detailUrl = `https://www.pixiv.net/ajax/illust/${tempIllust.id}`
            detailRes = await requestApi(detailUrl)
          } catch (err) {
            logger.warn(`[P站搜图] 获取作品[${tempIllust.id}]详情失败: ${err.message}`)
            continue
          }
          if (!detailRes.body) {
            continue
          }

          const fullIllustData = detailRes.body
          const bookmarkCount = fullIllustData.bookmarkCount
          const viewCount = fullIllustData.viewCount
          const ratio = viewCount > 0 ? bookmarkCount / viewCount : 0

          const isHighQuality = bookmarkCount >= minBookmarks && ratio >= minBookmarkViewRatio

          if (!isHighQuality) {
            continue
          }

          let pagesRes
          try {
            const pagesUrl = `https://www.pixiv.net/ajax/illust/${tempIllust.id}/pages`
            pagesRes = await requestApi(pagesUrl)
          } catch (err) {
            logger.warn(`[P站搜图] 获取作品[${tempIllust.id}]页面信息失败: ${err.message}`)
            continue
          }
          if (pagesRes.body && pagesRes.body.length > 0) {
            illust = fullIllustData
            pages = pagesRes.body
            break
          }
        }

        if (illust) break
      }

      if (!illust) {
        await this.reply(`未能找到符合条件的图片，请换个标签再试。`, false, { recallMsg: 10 })

        return true
      }

      await PixivHistory.addHistory(e, illust.id)

      const isR18 = illust.xRestrict !== 0
      await this.sendIllustMessage(e, illust, pages, isR18)
    } catch (error) {
      logger.error(`[P站搜图] 请求API时发生错误: ${error}`)
      let replyMsg = "哎呀，网络似乎出了点问题，请稍后再试吧~"
      if (error.status) {
        if (error.status == 429) {
          replyMsg = `P站API请求过于频繁，已被临时拒绝。请稍后再试！`
        } else {
          replyMsg = `搜索失败，API返回错误: ${error.status}，可能是Cookie失效了。`
        }
      } else {
        replyMsg = `搜索失败: ${error.message}`
      }
      await this.reply(replyMsg, false, { recallMsg: 10 })
    }

    return true
  }

  async sendIllustMessage(e, illust, pages, isR18 = false, pageNum = 1) {
    const config = this.appconfig
    const imagesPerPage = 3
    const totalPages = pages.length
    const totalImagePages = Math.ceil(totalPages / imagesPerPage)

    if (totalPages > 0 && pageNum > totalImagePages) {
      await this.reply(`该作品只有 ${totalImagePages} 页图片哦~ (共${totalPages}张)`, false, {
        recallMsg: 10,
      })
      return true
    }

    const startIndex = (pageNum - 1) * imagesPerPage
    const imagesToSend = pages.slice(startIndex, startIndex + imagesPerPage)

    let caption = "找到图片啦！"
    const pidMatch = e.msg.match(/^#?pid\s*(\d+)/)

    if (totalPages > 1) {
      if (pidMatch && totalPages > imagesPerPage) {
        caption += ` (第${pageNum}/${totalImagePages}页, 共${totalPages}张)`
      } else {
        caption += ` (共${totalPages}张`
        if (totalPages > imagesToSend.length) {
          caption += `，展示前${imagesToSend.length}张`
        }
        caption += `)`
      }
    }

    const tags =
      illust.tags?.tags
        ?.slice(0, 5)
        .map(t => `#${t.tag}`)
        .join(" ") || "无"

    let dateStr = ""
    if (illust.createDate) {
      const createDate = new Date(illust.createDate)
      const currentYear = new Date().getFullYear()
      const illustYear = createDate.getFullYear()
      const month = String(createDate.getMonth() + 1).padStart(2, "0")
      const day = String(createDate.getDate()).padStart(2, "0")
      dateStr = illustYear === currentYear ? `${month}-${day}` : `${illustYear}-${month}-${day}`
    }

    const textMsg = [
      `${caption}\n`,
      `标题: ${illust.title}\n`,
      `作者: ${illust.userName}\n`,
      `P站ID: ${illust.id}\n标签: ${tags}\n日期: ${dateStr}`,
    ]

    const imageUrls = []
    for (const page of imagesToSend) {
      const selectedUrl = page.urls.original
      let proxiedUrl = selectedUrl
      if (config.proxy) {
        const url = new URL(selectedUrl)
        url.hostname = config.proxy
        proxiedUrl = url.href
      }
      imageUrls.push(proxiedUrl)
    }

    const initialMsg = [...textMsg, ...imageUrls.map(url => segment.image(url))]
    const sendResult = await this.reply(initialMsg, true)
    if (sendResult?.message_id) {
      if (isR18) {
        Recall(e, sendResult.message_id)
      }
      return true
    }

    this.reply("图片发送失败，正在尝试翻转后重发...", false, { recallMsg: 10 })

    const processedImageBuffers = []
    for (const url of imageUrls) {
      const flippedBuffer = await FlipImage(url)
      if (flippedBuffer) {
        processedImageBuffers.push(flippedBuffer)
      }
    }

    if (processedImageBuffers.length > 0) {
      const retryMsg = [...textMsg, ...processedImageBuffers.map(buf => segment.image(buf))]
      const retrySendResult = await this.reply(retryMsg, true)
      if (retrySendResult?.message_id) {
        if (isR18) {
          Recall(e, retrySendResult.message_id)
        }
        return true
      }
      logger.warn(`[P站搜图] 图片翻转后发送仍然失败，将以链接形式发送。`)
    } else {
      logger.error(`[P站搜图] 所有图片翻转失败，无法重发。将以链接形式发送。`)
    }

    const linkMsg = [
      ...textMsg,
      "\n\n图片最终发送失败，请点击链接查看图片：\n" + imageUrls.join("\n"),
    ]
    const finalSendResult = await this.reply(linkMsg, true)
    if (finalSendResult?.message_id) {
      Recall(e, finalSendResult.message_id)
    }

    return true
  }
}
