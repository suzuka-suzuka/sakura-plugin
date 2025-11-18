import Setting from "../lib/setting.js"

export class News60s extends plugin {
  constructor() {
    super({
      name: "60sNews",
      priority: 1135,
    })
  }

  task = {
    name: "60sNews定时发送",
    cron: "0 0 9 * * *",
    fnc: () => this.dailyNewsTask(),
    log: false,
  }

  get appconfig() {
    return Setting.getConfig("60sNews")
  }

  async dailyNewsTask() {
    const config = this.appconfig
    if (!config) {
      return
    }

    const groups = config.Groups ?? []
    if (groups.length === 0) {
      return
    }

    const imageUrl = "https://60s.viki.moe/v2/60s?encoding=image-proxy"

    for (const groupId of groups) {
      try {
        await Bot.pickGroup(groupId).sendMsg(segment.image(imageUrl))
      } catch (error) {
        logger.error(`[60sNews] 向群 ${groupId} 发送新闻失败:`, error)
      }
    }
  }
}