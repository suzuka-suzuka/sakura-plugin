import Setting from "../lib/setting.js"
import { getRankingOverview, buildRankingForwardParams } from "../lib/pixiv/ranking.js"

export class PixivTask extends plugin {
  constructor() {
    super({
      name: "pixiv排行榜定时任务",
      priority: 1135,
    })
  }

  get appconfig() {
    return Setting.getConfig("pixiv")
  }

  weeklyRankingTask = Cron("0 0 11 * * 0", async () => {
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
