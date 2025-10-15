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
    cron: "0 * * * * *", // 每分钟执行一次（测试用）
    fnc: () => this.autoCleanupTask(),
    log: true, // 开启日志
  }

  get appconfig() {
    return Setting.getConfig("AutoCleanup")
  }

  async autoCleanupTask() {
    logger.mark("[自动清理] 定时任务开始执行")
    logger.mark(`[自动清理] 当前时间: ${new Date().toLocaleString('zh-CN')}`)
    
    const config = this.appconfig
    logger.mark(`[自动清理] 读取配置: ${JSON.stringify(config)}`)
    
    const groups = config?.groups ?? []
    logger.mark(`[自动清理] 需要清理的群列表: ${JSON.stringify(groups)}`)

    if (groups.length === 0) {
      logger.warn("[自动清理] 配置中没有需要清理的群，任务结束")
      return
    }

    for (const groupId of groups) {
      try {
        logger.mark(`[自动清理] 开始处理群: ${groupId}`)
        await this.cleanupGroup(groupId)
        await new Promise(resolve => setTimeout(resolve, 3000))
      } catch (error) {
        logger.error(`[自动清理] 处理群 ${groupId} 时出错:`, error)
      }
    }
    
    logger.mark("[自动清理] 定时任务执行完成")
  }

  async cleanupGroup(groupId) {
    logger.mark(`[自动清理] 正在获取群 ${groupId} 信息`)
    const group = Bot.pickGroup(groupId)
    if (!group) {
      logger.error(`[自动清理] 无法获取群 ${groupId}`)
      return
    }

    let botInfo
    try {
      logger.mark(`[自动清理] 正在获取Bot在群 ${groupId} 的信息`)
      botInfo = await group.pickMember(Bot.uin).getInfo(true)
      logger.mark(`[自动清理] Bot角色: ${botInfo.role}`)
    } catch (error) {
      logger.error(`[自动清理] 获取Bot信息失败 群${groupId}:`, error)
      return
    }

    if (botInfo.role === "member") {
      logger.warn(`[自动清理] Bot在群 ${groupId} 中不是管理员，跳过清理`)
      return
    }

    logger.mark(`[自动清理] 正在获取群 ${groupId} 成员列表`)
    const memberMap = await group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[自动清理] 获取群 ${groupId} 成员列表失败`)
      return
    }
    
    logger.mark(`[自动清理] 群 ${groupId} 成员总数: ${memberMap.size}`)

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

    logger.mark(`[自动清理] 群 ${groupId} 需要清理的成员数: ${toCleanup.length}`)

    if (toCleanup.length === 0) {
      logger.mark(`[自动清理] 群 ${groupId} 没有需要清理的成员`)
      return
    }

    try {
      logger.mark(`[自动清理] 群 ${groupId} 发送清理提示消息`)
      await group.sendMsg("午夜时刻，开杀了喵")
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error) {
      logger.error(`[自动清理] 群 ${groupId} 发送提示消息失败:`, error)
    }

    for (const userId of toCleanup) {
      try {
        logger.mark(`[自动清理] 正在踢出群 ${groupId} 的成员 ${userId}`)
        await group.kickMember(userId)
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        logger.error(`[自动清理] 群 ${groupId} 清理成员 ${userId} 失败:`, error)
      }
    }
  }
}
