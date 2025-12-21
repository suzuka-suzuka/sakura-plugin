import Setting from "../lib/setting.js";

export class AutoCleanup extends plugin {
  constructor() {
    super({
      name: "自动清理群成员",
      priority: 1135,
    });
  }

  get appconfig() {
    return Setting.getConfig("AutoCleanup");
  }

  autoCleanupTask = Cron("0 0 0 * * *", async () => {
    const config = this.appconfig;
    const groups = config?.groups ?? [];

    if (groups.length === 0) {
      return;
    }

    for (const groupId of groups) {
      try {
        await this.cleanupGroup(groupId);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (error) {
        logger.error(`[自动清理] 处理群 ${groupId} 时出错:`, error);
      }
    }
  });

  async cleanupGroup(groupId) {
    if (!bot) return;
    const group = bot.pickGroup(groupId);

    let botInfo;
    try {
      botInfo = await group.getMemberInfo(bot.selfId, true);
    } catch (err) {
      logger.error(`[自动清理] 获取群 ${groupId} Bot自身信息失败`);
      return;
    }

    if (botInfo.role === "member") {
      logger.warn(`[自动清理] Bot在群 ${groupId} 中不是管理员，跳过清理`);
      return;
    }

    const memberList = await group.getMemberList(true);
    if (!memberList) {
      logger.error(`[自动清理] 获取群 ${groupId} 成员列表失败`);
      return;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const sixMonthsInSeconds = 180 * 24 * 60 * 60;
    const oneDayInSeconds = 24 * 60 * 60;

    const toCleanup = [];

    for (const member of memberList) {
      if (member.user_id == bot.selfId) continue;

      if (member.role !== "member") continue;

      const lastSentTime = member.last_sent_time || 0;

      let joinTime = member.join_time || 0;
      if (joinTime > 1000000000000) {
        joinTime = Math.floor(joinTime / 1000);
      }

      const level = parseInt(member.level);

      const timeSinceLastSpoke = currentTime - lastSentTime;
      const timeSinceJoin = currentTime - joinTime;

      const isOldInactive = timeSinceLastSpoke > sixMonthsInSeconds;

      const isLowLevel = !isNaN(level) && level <= 1;

      const isNewJoiner = timeSinceJoin > oneDayInSeconds;

      if (isOldInactive || (isNewJoiner && isLowLevel)) {
        toCleanup.push(member.user_id);
      }
    }

    if (toCleanup.length === 0) {
      return;
    }

    await group.sendMsg(`午夜时刻，开杀了喵`);

    await group.kickMemberBatch(toCleanup);
  }
}
