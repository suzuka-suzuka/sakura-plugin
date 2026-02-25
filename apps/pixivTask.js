import Setting from "../lib/setting.js"
import { getRankingOverview, buildRankingForwardParams } from "../lib/pixiv/ranking.js"
import {
  searchTagSubscription,
  searchArtistSubscription,
  markAsSent,
  isAlreadySent,
  getIllustImageUrls,
  buildIllustInfoText
} from "../lib/pixiv/subscription.js"
import { FlipImage } from "../lib/ImageUtils/ImageUtils.js"

export class PixivTask extends plugin {
  constructor() {
    super({
      name: "pixiv定时任务",
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


  subscribeTag = Command(/^#?订阅标签\s*(.+)$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }

    const match = e.msg.match(/^#?订阅标签\s*(.+)$/)
    if (!match) return false

    const tag = match[1].trim()
    if (!tag) {
      return e.reply("请输入要订阅的标签，例如：#订阅标签 白毛", 10)
    }

    const config = this.appconfig
    const groupId = Number(e.group_id)


    let tagSubscriptions = config.tagSubscriptions || []

    let groupSub = tagSubscriptions.find(s => s.groupId === groupId)

    if (!groupSub) {

      groupSub = { groupId, tags: [] }
      tagSubscriptions.push(groupSub)
    }


    if (groupSub.tags.includes(tag)) {
      return e.reply(`本群已订阅标签「${tag}」，无需重复订阅~`, 10, true)
    }


    groupSub.tags.push(tag)

    Setting.setConfig("pixiv", { ...config, tagSubscriptions })

    return e.reply(`✅ 成功订阅标签「${tag}」`, 10)
  });


  unsubscribeTag = Command(/^#?取消订阅标签\s*(.+)$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }
    const match = e.msg.match(/^#?取消订阅标签\s*(.+)$/)
    if (!match) return false

    const tag = match[1].trim()
    const config = this.appconfig
    const groupId = Number(e.group_id)

    let tagSubscriptions = config.tagSubscriptions || []


    const groupSub = tagSubscriptions.find(s => s.groupId === groupId)

    if (!groupSub || !groupSub.tags.includes(tag)) {
      return e.reply(`本群未订阅标签「${tag}」`, 10)
    }

    groupSub.tags = groupSub.tags.filter(t => t !== tag)


    if (groupSub.tags.length === 0) {
      tagSubscriptions = tagSubscriptions.filter(s => s.groupId !== groupId)
    }

    Setting.setConfig("pixiv", { ...config, tagSubscriptions })
    return e.reply(`✅ 已取消订阅标签「${tag}」`, 10)
  });


  subscribeArtist = Command(/^#?订阅画师\s*(\d+)$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }

    const match = e.msg.match(/^#?订阅画师\s*(\d+)$/)
    if (!match) return false
    const artistId = match[1].trim()
    const config = this.appconfig
    const groupId = Number(e.group_id)

    let artistSubscriptions = config.artistSubscriptions || []


    let groupSub = artistSubscriptions.find(s => s.groupId === groupId)

    if (!groupSub) {
      groupSub = { groupId, artistIds: [] }
      artistSubscriptions.push(groupSub)
    }

    if (groupSub.artistIds.includes(artistId)) {
      return e.reply(`本群已订阅画师「${artistId}」，无需重复订阅~`, 10)
    }

    groupSub.artistIds.push(artistId)
    Setting.setConfig("pixiv", { ...config, artistSubscriptions })

    return e.reply(`✅ 成功订阅画师「${artistId}」`, 10)
  });


  unsubscribeArtist = Command(/^#?取消订阅画师\s*(\d+)$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }

    const match = e.msg.match(/^#?取消订阅画师\s*(\d+)$/)
    if (!match) return false

    const artistId = match[1].trim()
    const config = this.appconfig
    const groupId = Number(e.group_id)
    let artistSubscriptions = config.artistSubscriptions || []


    const groupSub = artistSubscriptions.find(s => s.groupId === groupId)

    if (!groupSub || !groupSub.artistIds.includes(artistId)) {
      return e.reply(`本群未订阅画师「${artistId}」`, 10)
    }

    groupSub.artistIds = groupSub.artistIds.filter(a => a !== artistId)

    if (groupSub.artistIds.length === 0) {
      artistSubscriptions = artistSubscriptions.filter(s => s.groupId !== groupId)
    }
    Setting.setConfig("pixiv", { ...config, artistSubscriptions })

    return e.reply(`✅ 已取消订阅画师「${artistId}」`, 10)
  });


  listSubscriptions = Command(/^#?订阅列表$/, async (e) => {
    const config = this.appconfig
    const groupId = Number(e.group_id)


    const tagSubConfig = (config.tagSubscriptions || []).find(s => s.groupId === groupId)
    const artistSubConfig = (config.artistSubscriptions || []).find(s => s.groupId === groupId)

    const tagSubs = tagSubConfig?.tags || []
    const artistSubs = artistSubConfig?.artistIds || []

    if (tagSubs.length === 0 && artistSubs.length === 0) {
      return e.reply("本群暂无任何P站订阅~", 10)
    }
    let msg = "📋 本群P站订阅列表：\n"

    if (tagSubs.length > 0) {
      msg += "\n🏷️ 标签订阅：\n"
      tagSubs.forEach((tag, i) => {
        msg += `  ${i + 1}. ${tag}\n`
      })
    }

    if (artistSubs.length > 0) {
      msg += "\n🎨 画师订阅：\n"
      artistSubs.forEach((id, i) => {
        msg += `  ${i + 1}. ${id}\n`
      })
    }

    return e.sendForwardMsg(msg.trim(), {
      prompt: "本群P站订阅列表",
      source: "Pixiv订阅",
      news: [
        { text: `🏷️ 标签订阅：${tagSubs.length}个` },
        { text: `🎨 画师订阅：${artistSubs.length}个` }
      ]
    })
  });




  tagSubscriptionTask = Cron("*/30 * * * *", async () => {
    if (!bot) return

    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      logger.warn("[标签订阅定时] 未配置 Pixiv Cookie 或 RefreshToken，跳过")
      return
    }

    const tagSubscriptions = config.tagSubscriptions || []

    if (tagSubscriptions.length === 0) {
      logger.info("[标签订阅定时] 无订阅，跳过")
      return
    }
    const subConfig = {
      maxPages: config.tagSubMaxPages || 5,
      freshnessPeriod: config.tagSubFreshnessPeriod || 86400,
      minBookmark: config.tagSubMinBookmark || 300,
      minBookRate: config.tagSubMinBookRate || 0.09,
      minBookPerHour: config.tagSubMinBookPerHour || 50,
    }

    const tagToGroups = new Map()
    for (const groupSub of tagSubscriptions) {
      const groupId = String(groupSub.groupId)
      for (const tag of (groupSub.tags || [])) {
        if (!tagToGroups.has(tag)) tagToGroups.set(tag, [])
        tagToGroups.get(tag).push(groupId)
      }
    }

    logger.info(`[标签订阅定时] 共整理出 ${tagToGroups.size} 个标签订阅任务...`)

    for (const [tag, groupIds] of tagToGroups.entries()) {
      try {
        logger.info(`[标签订阅定时] 正在搜索标签「${tag}」...`)

        const isR18Enabled = groupIds.some(gid => this.r18Config.Groups?.includes(Number(gid)))
        const illusts = await searchTagSubscription(tag, groupIds, config, subConfig, isR18Enabled)

        if (illusts.length === 0) {
          logger.info(`[标签订阅定时] 标签「${tag}」无符合条件的新作品`)
          continue
        }

        logger.info(`[标签订阅定时] 标签「${tag}」找到 ${illusts.length} 个新作品，准备分发`)

        for (const illust of illusts) {
          let sentToAny = false
          for (const groupId of groupIds) {
            try {
              const sent = await isAlreadySent(groupId, illust.id, 'tag')
              if (sent) continue

              await this.sendSubscriptionIllust(groupId, illust, tag, 'tag')
              await markAsSent(groupId, illust.id, 'tag', subConfig.freshnessPeriod)
              sentToAny = true
            } catch (err) {
              logger.error(`[标签订阅定时] 向群 ${groupId} 推送标签「${tag}」的作品 ${illust.id} 失败: ${err.message}`)
            }
          }

          if (sentToAny) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      } catch (err) {
        logger.error(`[标签订阅定时] 处理标签「${tag}」失败: ${err.message}`)
      }

      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    logger.info("[标签订阅定时] 检查完成")
  });


  artistSubscriptionTask = Cron("10 * * * *", async () => {
    if (!bot) return

    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      logger.warn("[画师订阅定时] 未配置 Pixiv Cookie 或 RefreshToken，跳过")
      return
    }
    const artistSubscriptions = config.artistSubscriptions || []

    if (artistSubscriptions.length === 0) {
      logger.info("[画师订阅定时] 无订阅，跳过")
      return
    }

    const subConfig = {
      freshnessPeriod: config.artistSubFreshnessPeriod || 43200,
    }

    const artistToGroups = new Map()
    for (const groupSub of artistSubscriptions) {
      const groupId = String(groupSub.groupId)
      for (const artistId of (groupSub.artistIds || [])) {
        if (!artistToGroups.has(artistId)) artistToGroups.set(artistId, [])
        artistToGroups.get(artistId).push(groupId)
      }
    }

    logger.info(`[画师订阅定时] 共整理出 ${artistToGroups.size} 位画师订阅任务...`)

    for (const [artistId, groupIds] of artistToGroups.entries()) {
      try {
        logger.info(`[画师订阅定时] 正在检查群订阅的画师「${artistId}」...`)

        const illusts = await searchArtistSubscription(artistId, groupIds, config, subConfig)

        if (illusts.length === 0) {
          logger.info(`[画师订阅定时] 画师「${artistId}」无新作品`)
          continue
        }
        logger.info(`[画师订阅定时] 画师「${artistId}」找到 ${illusts.length} 个新作品，准备分发`)

        for (const illust of illusts) {
          let sentToAny = false
          for (const groupId of groupIds) {
            try {
              const sent = await isAlreadySent(groupId, illust.id, 'artist')
              if (sent) continue

              await this.sendSubscriptionIllust(groupId, illust, artistId, 'artist')
              await markAsSent(groupId, illust.id, 'artist', 86400)
              sentToAny = true
            } catch (err) {
              logger.error(`[画师订阅定时] 向群 ${groupId} 推送画师「${artistId}」的作品 ${illust.id} 失败: ${err.message}`)
            }
          }

          if (sentToAny) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      } catch (err) {
        logger.error(`[画师订阅定时] 处理画师「${artistId}」失败: ${err.message}`)
      }

      await new Promise(resolve => setTimeout(resolve, 5000))
    }

    logger.info("[画师订阅定时] 检查完成")
  });

  async sendSubscriptionIllust(groupId, illust, subscriptionName, type) {
    const config = this.appconfig
    const isR18 = illust.x_restrict !== 0


    if (isR18 && !this.r18Config.Groups?.includes(Number(groupId))) {
      logger.info(`[订阅推送] 群 ${groupId} 未开启R18，跳过作品 ${illust.id}`)
      return
    }

    const imageUrls = getIllustImageUrls(illust, config.proxy, 3)

    if (imageUrls.length === 0) {
      logger.warn(`[订阅推送] 作品 ${illust.id} 无图片链接`)
      return
    }

    const typeLabel = type === 'tag' ? '标签' : '画师'
    const infoText = buildIllustInfoText(illust)
    const newsText = `🔔「${subscriptionName}」有新作品`

    const msgNodes = [
      {
        type: "node",
        data: {
          user_id: bot.self_id,
          nickname: bot.nickname || "Pixiv小助手",
          content: infoText,
        },
      }
    ]

    await bot.sendForwardMsg({
      messages: msgNodes,
      group_id: Number(groupId),
      prompt: `🔔 有新作品更新`,
      source: `Pixiv${typeLabel}订阅`,
      news: [{ text: newsText }]
    })


    const sendImages = async (imgs) => bot.sendGroupMsg(groupId, imgs)

    const initialRecallTime = isR18 ? (config.recallTime ?? 10) : 0
    let imgSendResult = await sendImages(imageUrls.map(url => segment.image(url)))
    let recallTimeToUse = initialRecallTime

    if (!imgSendResult?.message_id) {
      const flippedBuffers = []
      for (const url of imageUrls) {
        const buf = await FlipImage(url)
        if (buf) flippedBuffers.push(buf)
      }

      if (flippedBuffers.length > 0) {
        recallTimeToUse = config.recallTime ?? 10
        imgSendResult = await sendImages(flippedBuffers.map(buf => segment.image(buf)))
      }

      if (!imgSendResult?.message_id) {
        imgSendResult = await bot.sendGroupMsg(groupId, "图片发送失败，请点击链接查看：\n" + imageUrls.join("\n"))
        recallTimeToUse = 60
      }
    }

    if (recallTimeToUse > 0 && imgSendResult?.message_id) {
      setTimeout(() => {
        bot.deleteMsg(imgSendResult.message_id).catch(() => { })
      }, recallTimeToUse * 1000)
    }
  }



  weeklyRankingTask = Cron("5 11 * * 0", async () => {
    if (!bot) return

    const config = this.appconfig
    if (!config.cookie || !config.refresh_token) {
      logger.warn("[P站排行榜定时] 未配置 Pixiv Cookie 或 RefreshToken，跳过推送")
      return
    }

    const pushGroups = config.rankingPushGroups ?? []
    if (pushGroups.length === 0) {
      logger.info("[P站排行榜定时] 未配置推送群，跳过")
      return
    }

    logger.info(`[P站排行榜定时] 开始推送周榜到 ${pushGroups.length} 个群...`)

    try {
      const result = await getRankingOverview("周榜")
      if (!result.images || result.images.length === 0) {
        logger.warn("[P站排行榜定时] 周榜无数据，跳过推送")
        return
      }

      for (const groupId of pushGroups) {

        try {
          const { nodes, prompt, news, source } = buildRankingForwardParams(result, "周榜", bot.self_id)
          await bot.sendGroupMsg(groupId, "周末愉快！来点P站周榜精选")
          const msgNodes = nodes.map(n => ({
            type: "node",
            data: {
              user_id: n.user_id ?? bot.self_id,
              nickname: n.nickname ?? "P站排行榜",
              content: Array.isArray(n.content)
                ? n.content
                : typeof n.content === "object" && n.content?.type
                  ? [n.content]
                  : [{ type: "text", data: { text: String(n.content) } }],
            },
          }))

          await bot.sendForwardMsg({
            messages: msgNodes,
            group_id: Number(groupId),
            prompt,
            news,
            source,
          })

          logger.info(`[P站排行榜定时] 已推送周榜到群 ${groupId}`)

          await new Promise(resolve => setTimeout(resolve, 1500))
        } catch (err) {
          logger.error(`[P站排行榜定时] 推送群 ${groupId} 失败: ${err.message}`)
        }
      }
    } catch (error) {
      logger.error(`[P站排行榜定时] 获取日榜失败: ${error.message}`)
    }
  })
}
