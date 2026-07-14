import path from "node:path";
import _ from "lodash";
import { plugindata } from "../lib/path.js";
import ImageGenerator from "../lib/sign/ImageGenerator.js";
import SignData from "../lib/sign/SignData.js";
import EconomyManager from "../lib/economy/EconomyManager.js";

const signData = new SignData(path.join(plugindata, "sign", "sign.json"));

export default class DailySign extends plugin {
  constructor() {
    super({
      name: "每日签到图",
      event: "message.group",
      priority: 1135,
    });
  }

  signIn = Command(/^#?签到$/, async (e) => {
    const groupId = e.group_id;
    const userId = e.user_id;
    const signDate = new Date();

    if (signData.hasSigned(groupId, userId, signDate)) {
      await e.reply("你今天已经签到过了哦~", 10);
      return true;
    }

    let newCoins = 0;
    try {
      const senderInfo = await e.getInfo();
      const groupLevel = Number(senderInfo?.level) || 1;
      const baseCoins = groupLevel;
      const fluctuation = _.random(-10, 10);
      newCoins = Math.max(0, baseCoins + fluctuation);
    } catch (err) {
      logger.warn(`获取群等级失败，使用默认随机金币: ${err}`);
      newCoins = _.random(5, 15);
    }

    // 正式写入前会重新加载磁盘数据并再次检查，整个读改写过程同步完成。
    const signResult = signData.recordSign(groupId, userId, signDate);
    if (!signResult.accepted) {
      await e.reply("你今天已经签到过了哦~", 10);
      return true;
    }

    const { signRanking, lastingTimes } = signResult;
    const economyManager = new EconomyManager(e);

    let continuousBonus = 0;
    if (lastingTimes >= 2) {
      continuousBonus = Math.min(lastingTimes - 1, 10);
    }

    let rankingBonus = 0;
    if (signRanking === 1) {
      rankingBonus = 10;
    } else if (signRanking === 2) {
      rankingBonus = 5;
    } else if (signRanking === 3) {
      rankingBonus = 3;
    }

    const totalBonus = continuousBonus + rankingBonus;
    newCoins += totalBonus;

    const newExperience = _.random(5, 15);

    economyManager.addCoins(e, newCoins, { type: "收入", note: "签到" });
    economyManager.addExperience(e, newExperience);

    const totalCoins = economyManager.getCoins(e);
    const totalExperience = economyManager.getExperience(e);
    const currentLevel = economyManager.getLevel(e);

    const currentLevelExp = 100 * (currentLevel - 1) ** 2;
    const nextLevelExp = 100 * currentLevel ** 2;
    const totalExperienceInLevel = totalExperience - currentLevelExp;
    const nextLevelRequiredExp = nextLevelExp - currentLevelExp;

    const displayData = {
      signRanking: signRanking,
      lastingTimes: lastingTimes,
      newCoins: newCoins,
      totalCoins: totalCoins,
      currentLevel: currentLevel,
      newExperience: newExperience,
      totalExperience: totalExperienceInLevel,
      nextLevelRequiredExp: nextLevelRequiredExp,
      currentLevelExpRange: totalExperienceInLevel / nextLevelRequiredExp,
      fortune: this.getFortune(),
      sentence: await this.getSentence(),
      continuousBonus: continuousBonus,
      rankingBonus: rankingBonus,
      totalBonus: totalBonus,
    };

    try {
      const imageGenerator = new ImageGenerator();
      const imageBuffer = await imageGenerator.generateSignImage(displayData);
      await e.reply(segment.image(imageBuffer));
    } catch (error) {
      logger.error("签到图生成失败:", error);
      await e.reply("签到失败~");
    }

    return true;
  });

  getFortune() {
    const fortunes = [
      { description: "大吉", argb: 0xfff89b59 },
      { description: "中吉", argb: 0xffa1c88a },
      { description: "小吉", argb: 0xff8ec7d2 },
      { description: "吉", argb: 0xfff1c4cd },
      { description: "末吉", argb: 0xffc8b2d3 },
      { description: "凶", argb: 0xff9e9e9e },
      { description: "大凶", argb: 0xff666666 },
    ];
    return _.sample(fortunes);
  }

  async getSentence() {
    try {
      const response = await fetch("https://international.v1.hitokoto.cn/");
      const data = await response.json();
      return data.hitokoto;
    } catch (error) {
      logger.warn("获取一言失败，使用本地句子:", error);
      const sentences = [
        "心想事成，万事如意！",
        "今天也是元气满满的一天！",
        "愿你的每一天都充满阳光。",
        "保持好心情，好事自然来。",
        "又是努力向上的一天呢！",
      ];
      return _.sample(sentences);
    }
  }
}
