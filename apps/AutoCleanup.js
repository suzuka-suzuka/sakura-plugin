import Setting from "../lib/setting.js"

export class AutoCleanup extends plugin {
  constructor() {
    super({
      name: "自动清理群成员",
      dsc: "每天0点自动清理半年未发言的人和进群超24小时但群等级为1级及以下的号",
      priority: 1135,
    })
  }

  task = {
    name: "AutoCleanupTask",
    cron: "0 0 0 * * *",
    fnc: () => this.autoCleanupTask(),
    log: false,
  }

  get appconfig() {
    return Setting.getConfig("AutoCleanup")
  }

  async autoCleanupTask() {
    const config = this.appconfig
    const groups = config?.groups ?? []

    if (groups.length === 0) {
      return
    }

    for (const groupId of groups) {
      try {
        await this.cleanupGroup(groupId)
        await new Promise(resolve => setTimeout(resolve, 3000))
      } catch (error) {
        logger.error(`[自动清理] 处理群 ${groupId} 时出错:`, error)
      }
    }
  }

  async cleanupGroup(groupId) {
    const group = Bot.pickGroup(groupId)

    let botInfo
    try {
      botInfo = await group.pickMember(Bot.uin).getInfo(true)
    } catch (err) {
      try {
        botInfo = (await group.pickMember(Number(Bot.uin))).info
      } catch (e) {
        logger.error(`[自动清理] 获取群 ${groupId} Bot自身信息失败`)
        return
      }
    }

    if (botInfo.role === "member") {
      logger.warn(`[自动清理] Bot在群 ${groupId} 中不是管理员，跳过清理`)
      return
    }

    const memberMap = await group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[自动清理] 获取群 ${groupId} 成员列表失败`)
      return
    }

    const currentTime = Math.floor(Date.now() / 1000)
    const sixMonthsInSeconds = 180 * 24 * 60 * 60
    const oneDayInSeconds = 24 * 60 * 60

    const toCleanup = []

    memberMap.forEach(member => {
      if (member.user_id === Bot.uin) return

      if (member.role !== "member") return

      const lastSentTime = member.last_sent_time || 0

      let joinTime = member.join_time || 0
      if (joinTime > 1000000000000) {
        joinTime = Math.floor(joinTime / 1000)
      }

      const level = parseInt(member.level)

      const timeSinceLastSpoke = currentTime - lastSentTime
      const timeSinceJoin = currentTime - joinTime

      const isOldInactive = timeSinceLastSpoke > sixMonthsInSeconds

      const isLowLevel = !isNaN(level) && level <= 1

      const isNewJoiner = timeSinceJoin > oneDayInSeconds

      if (isOldInactive || (isNewJoiner && isLowLevel)) {
        toCleanup.push(member.user_id)
      }
    })

    if (toCleanup.length === 0) {
      return
    }

    await group.sendMsg(`午夜时刻，开杀了喵`)

    for (const userId of toCleanup) {
      await group.kickMember(userId)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
