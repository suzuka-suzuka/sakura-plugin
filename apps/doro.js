import EconomyManager from "../lib/economy/EconomyManager.js";
export class DoroEnding extends plugin {
  constructor() {
    super({
      name: "DoroEnding",
      dsc: "Doro结局图片",
      event: "message",
      priority: 1135,
    });
  }

  doroEnding = Command(/^doro结局$/, async (e) => {
    const economyManager = new EconomyManager(e);
    if (!e.isMaster && !economyManager.pay(e, 5)) {
      return false;
    }
    try {
      const imageUrl = "https://image.rendround.ggff.net/doroending";
      await e.reply(segment.image(imageUrl));
      return true;
    } catch (error) {
      logger.error("获取Doro结局图片出错：", error);
      return false;
    }
  });
}
