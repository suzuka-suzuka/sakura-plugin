import Setting from "../lib/setting.js"

export class AutoCleanup extends plugin {
  constructor() {
    super({
      name: "自动清理群成员",
      dsc: "每天0点自动清理半年未发言的人和进群超24小时但群等级为1级的号",
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
    if (!group) {
      logger.error(`[自动清理] 无法获取群 ${groupId}`)
      return
    }

    let botInfo
    try {
      botInfo = await group.pickMember(Bot.uin).getInfo(true)
    } catch (error) {
      logger.error(`[自动清理] 获取Bot信息失败 群${groupId}:`, error)
      return
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
      if (member.user_id === Bot.uin) {
        return
      }

      if (member.role !== "member") {
        return
      }

      const timeSinceLastSpoke = currentTime - member.last_sent_time
      const timeSinceJoin = currentTime - member.join_time

      if (timeSinceLastSpoke > sixMonthsInSeconds || 
          (timeSinceJoin > oneDayInSeconds && member.level === 1)) {
        toCleanup.push(member.user_id)
      }
    })

    if (toCleanup.length === 0) {
      return
    }

    try {
      await group.sendMsg("午夜时刻，开杀了喵")
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error) {
      logger.error(`[自动清理] 群 ${groupId} 发送提示消息失败:`, error)
    }

    for (const userId of toCleanup) {
      try {
        await group.kickMember(userId)
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        logger.error(`[自动清理] 群 ${groupId} 清理成员 ${userId} 失败:`, error)
      }
    }
  }
}
