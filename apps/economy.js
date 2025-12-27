import EconomyManager from "../lib/EconomyManager.js";
import EconomyImageGenerator from "../lib/economy/ImageGenerator.js";

export default class Economy extends plugin {
  constructor() {
    super({
      name: "经济系统",
      event: "message.group",
      priority: 1000,
    });
  }

  myStatus = Command(/^#?(我的资产|我的等级|个人信息)$/, async (e) => {
    const economyManager = new EconomyManager(e);
    const coins = economyManager.getCoins(e);
    const level = economyManager.getLevel(e);
    const experience = economyManager.getExperience(e);

    const userData = {
      userId: e.user_id,
      nickname: e.sender.card || e.sender.nickname || e.user_id,
      avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`,
      coins,
      level,
      experience,
    };

    try {
      const generator = new EconomyImageGenerator();
      const image = await generator.generateStatusImage(userData);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成个人信息图片失败: ${err}`);
      await e.reply("生成图片失败，请稍后再试~");
    }
    return true;
  });

  coinRanking = Command(/^#?(金币|樱花币|富豪)(排行|榜)$/, async (e) => {
    return await this.generateRanking(e, "coins", "樱花币排行榜");
  });

  levelRanking = Command(/^#?(等级|经验)(排行|榜)$/, async (e) => {
    return await this.generateRanking(e, "level", "等级排行榜");
  });

  async generateRanking(e, type, title) {
    const economyManager = new EconomyManager(e);
    const rankingList = economyManager.getRanking(type, 10);

    if (rankingList.length === 0) {
      await e.reply("暂时还没有数据哦~");
      return true;
    }

    const list = await Promise.all(
      rankingList.map(async (item, index) => {
        let nickname = item.userId;
        try {
          const info = await e.getInfo(item.userId);
          if (info) {
            nickname = info.card || info.nickname || item.userId;
          }
        } catch (err) {}

        return {
          rank: index + 1,
          userId: item.userId,
          nickname: String(nickname),
          avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${item.userId}&s=640`,
          value: item[type],
        };
      })
    );

    const data = {
      title,
      list,
    };

    try {
      const generator = new EconomyImageGenerator();
      const image = await generator.generateRankingImage(data);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成排行榜图片失败: ${err}`);
      await e.reply("生成图片失败，请稍后再试~");
    }
    return true;
  }
}
