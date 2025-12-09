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
    cron: "0 27 16 * * *",
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
    } catch {
      botInfo = (await group.pickMember(Number(Bot.uin))).info
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

      if (
        timeSinceLastSpoke > sixMonthsInSeconds ||
        (timeSinceJoin > oneDayInSeconds && member.level == 1)
      ) {
        toCleanup.push(member.user_id)
      }
    })

    if (toCleanup.length === 0) {
      return
    }

    await group.sendMsg("午夜时刻，开杀了喵")

    for (const userId of toCleanup) {
      let retry = 0
      let success = false
      while (retry < 3 && !success) {
        const waitTime = 2000 * (retry + 1)
        const result = await group.kickMember(userId)
        if (result && result.status === "ok") {
          success = true
        } else {
          logger.warn(
            `[自动清理] 群 ${groupId} 踢出成员 ${userId} 失败: ${JSON.stringify(result)}，正在重试...`,
          )
          retry++
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
