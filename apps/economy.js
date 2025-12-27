import EconomyManager from "../lib/managers/EconomyManager.js";
import EconomyImageGenerator from "../lib/economy/ImageGenerator.js";
import GiftManager from "../lib/managers/GiftManager.js";

export default class Economy extends plugin {
  constructor() {
    super({
      name: "经济系统",
      event: "message.group",
      priority: 1000,
    });
  }

  giftList = Command(/^#?礼物列表$/, async (e) => {
    const gifts = GiftManager.getAllGifts();
    if (gifts.length === 0) {
      await e.reply("暂时还没有礼物上架哦~",10);
      return true;
    }

    const forwardMsg = gifts.map((gift) => {
      return {
        nickname: "礼物商店",
        user_id: e.self_id,
        content: `🎁 ${gift.name}\n💰 价格：${gift.price} 樱花币\n❤️ 好感度：+${gift.favorability}\n📝 描述：${gift.description}`,
      };
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看礼物列表",
      news: [{ text: `共 ${gifts.length} 种礼物` }],
      source: "樱花商店",
    });
    return true;
  });

  buyGift = Command(/^#?购买\s*(.+)$/, async (e) => {
    const giftName = e.match[1].trim();
    const result = await GiftManager.buyGift(e, giftName);
    await e.reply(result.msg);
    return true;
  });

  myGifts = Command(/^#?我的礼物$/, async (e) => {
    const inventory = GiftManager.getInventory(e.group_id, e.user_id);
    if (Object.keys(inventory).length === 0) {
      await e.reply("你还没有购买任何礼物哦~",10);
      return true;
    }

    let msg = "🎒 我的背包：\n";
    for (const [name, count] of Object.entries(inventory)) {
      msg += `\n${name} x ${count}`;
    }
    await e.reply(msg);
    return true;
  });

  sendGift = Command(/^#?赠送\s*(.+)$/, async (e) => {
    const giftName = e.match[1].trim();
    const targetId = e.at;

    if (!targetId) {
      return false
    }

    if (targetId == e.user_id) {
      return false
    }

    const result = await GiftManager.sendGift(e, giftName, targetId);
    await e.reply(result.msg,10);
    return true;
  });

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
      await e.reply("生成图片失败，请稍后再试~", 10);
    }
    return true;
  });

  transfer = Command(/^#?转账(\d+).*$/, async (e) => {
    const amount = parseInt(e.match[1]);
    if (isNaN(amount) || amount <= 0) {
      return false;
    }

    const targetId = e.at;

    if (!targetId) {
      return false;
    }

    if (targetId == e.user_id) {
      return false;
    }

    const economyManager = new EconomyManager(e);
    const success = economyManager.transfer(e, targetId, amount);

    if (!success) {
      await e.reply("你的樱花币不足哦~", 10);
      return true;
    }

    const senderCoins = economyManager.getCoins(e);
    const receiverCoins = economyManager.getCoins({
      user_id: targetId,
      group_id: e.group_id,
    });

    const senderNickname = e.sender.card || e.sender.nickname || e.user_id;
    let receiverNickname = targetId;
    try {
      const info = await e.getInfo(targetId);
      if (info) {
        receiverNickname = info.card || info.nickname || targetId;
      }
    } catch (err) {}

    const data = {
      sender: {
        nickname: String(senderNickname),
        avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`,
        coins: senderCoins,
      },
      receiver: {
        nickname: String(receiverNickname),
        avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`,
        coins: receiverCoins,
      },
      amount,
    };

    try {
      const generator = new EconomyImageGenerator();
      const image = await generator.generateTransferImage(data);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成转账图片失败: ${err}`);
      await e.reply(
        `转账成功！你失去了 ${amount} 樱花币，对方获得了 ${amount} 樱花币。`
      );
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
      await e.reply("暂时还没有数据哦~", 10);
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
      await e.reply("生成图片失败，请稍后再试~", 10);
    }
    return true;
  }
}
