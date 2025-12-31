import EconomyManager from "../lib/economy/EconomyManager.js";
import EconomyImageGenerator from "../lib/economy/ImageGenerator.js";
import ShopManager from "../lib/economy/ShopManager.js";
import GiftManager from "../lib/favorability/GiftManager.js";
import InventoryManager from "../lib/economy/InventoryManager.js";
import _ from "lodash";

export default class Economy extends plugin {
  constructor() {
    super({
      name: "经济系统",
      event: "message.group",
      priority: 1135,
    });
  }

  rob = Command(/^#?(打劫|抢[劫夺钱])\s*.*$/, async (e) => {
    const targetId = e.at;
    if (!targetId) {
      return false;
    }

    if (targetId == e.user_id) {
      return false;
    }

    const cooldownKey = `sakura:economy:rob:cooldown:${e.group_id}:${e.user_id}`;
    const lastRobTime = await redis.get(cooldownKey);
    if (lastRobTime) {
      const remainingTime = Math.ceil(
        (3600 - (Date.now() / 1000 - Number(lastRobTime))) / 60
      );
      await e.reply(
        `精英巫女正在注视着你，请等待 ${remainingTime} 分钟后再行动！`,
        10
      );
      return true;
    }

    const economyManager = new EconomyManager(e);
    const targetCoins = economyManager.getCoins({
      user_id: targetId,
      group_id: e.group_id,
    });

    if (targetCoins < 100) {
      await e.reply("那个人太穷了，连买鲷鱼烧的钱都没有~", 10);
      return true;
    }

    let attackerLevel = 1;
    let targetLevel = 1;
    try {
      const attackerInfo = await e.getInfo();
      attackerLevel = Number(attackerInfo?.level) || 1;
    } catch (err) {
      logger.warn(`获取攻击者群等级失败: ${err}`);
    }
    try {
      const targetInfo = await e.getInfo(targetId);
      targetLevel = Number(targetInfo?.level) || 1;
    } catch (err) {
      logger.warn(`获取目标群等级失败: ${err}`);
    }

    const levelDiff = attackerLevel - targetLevel;
    const successRate = Math.max(20, Math.min(80, 50 + levelDiff));

    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      3600
    );

    const roll = _.random(1, 100);
    const attackerName = e.sender.card || e.sender.nickname || e.user_id;
    let targetName = targetId;
    try {
      const info = await e.getInfo(targetId);
      if (info) {
        targetName = info.card || info.nickname || targetId;
      }
    } catch (err) {}

    if (roll <= successRate) {
      const robPercent = _.random(0, 20);
      const robAmount = Math.floor((targetCoins * robPercent) / 100);

      if (robAmount <= 0) {
        await e.reply(`抢夺成功！但是对方口袋里只有空气...`);
        return true;
      }

      economyManager.reduceCoins(
        { user_id: targetId, group_id: e.group_id },
        robAmount
      );
      economyManager.addCoins(e, robAmount);

      const counterKey = `sakura:economy:rob:counter:${e.group_id}:${targetId}`;
      const counterData = JSON.stringify({
        attackerId: e.user_id,
        amount: robAmount,
        time: Date.now(),
      });
      await redis.set(counterKey, counterData, "EX", 300);

      const transferLockKey = `sakura:economy:transfer:lock:${e.group_id}:${e.user_id}`;
      await redis.set(transferLockKey, String(Date.now()), "EX", 300);

      await e.reply(
        `🌸 抢夺成功！\n${attackerName} 从 ${targetName} 那里抢走了 ${robAmount} 樱花币！`
      );
    } else {
      const attackerCoins = economyManager.getCoins(e);
      const penalty = Math.min(50, attackerCoins);
      economyManager.reduceCoins(e, penalty);

      await e.reply(
        `🚨 抢夺失败！\n${attackerName} 被神使当场抓获！\n受到神罚，失去 ${penalty} 樱花币！`
      );
    }

    return true;
  });

  counter = Command(/^#?(反击|复仇|神罚)\s*.*$/, async (e) => {
    const targetId = e.at;
    if (!targetId) {
      return false;
    }

    if (targetId == e.user_id) {
      return false;
    }

    const counterKey = `sakura:economy:rob:counter:${e.group_id}:${e.user_id}`;
    const counterDataStr = await redis.get(counterKey);

    if (!counterDataStr) {
      await e.reply("找不到反击目标，或者对方已经逃回神社了！", 10);
      return true;
    }

    const counterData = JSON.parse(counterDataStr);

    if (counterData.attackerId != targetId) {
      await e.reply("找错人了！那个人是无辜的！", 10);
      return true;
    }

    await redis.del(counterKey);

    const economyManager = new EconomyManager(e);
    const attackerName = e.sender.card || e.sender.nickname || e.user_id;
    let targetName = targetId;
    try {
      const info = await e.getInfo(targetId);
      if (info) {
        targetName = info.card || info.nickname || targetId;
      }
    } catch (err) {}

    const elapsedTime = (Date.now() - counterData.time) / 1000;
    const successRate = Math.max(
      0,
      Math.floor(100 - (elapsedTime / 300) * 100)
    );

    const roll = _.random(1, 100);
    if (roll <= successRate) {
      const counterAmount = Math.floor(counterData.amount * 1.5);
      const targetCoins = economyManager.getCoins({
        user_id: targetId,
        group_id: e.group_id,
      });
      const actualAmount = Math.min(counterAmount, targetCoins);

      economyManager.reduceCoins(
        { user_id: targetId, group_id: e.group_id },
        actualAmount
      );
      economyManager.addCoins(e, actualAmount);

      await e.reply(
        `⚔️ 反击成功！\n${attackerName} 用岩浆烫伤了 ${targetName}！\n夺回并获得了 ${actualAmount} 樱花币！`
      );
    } else {
      await e.reply(`💨 反击失败！\n${targetName} 早就跑得比Miko还快了...`);
    }

    return true;
  });

  shopList = Command(/^#?(商店|商城|樱神社商店|神社商店)$/, async (e) => {
    const shopManager = new ShopManager();
    const forwardMsg = shopManager.generateShopMessage(e);
    const items = shopManager.getAllItems();

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看樱神社商店",
      news: [{ text: `共 ${items.length} 种商品` }],
      source: "樱神社商店",
    });
    return true;
  });

  giftShop = Command(/^#?(礼物商店|礼物商城|礼物列表)$/, async (e) => {
    const gifts = GiftManager.getAllGifts();
    if (gifts.length === 0) {
      await e.reply("礼物商店暂时缺货哦~", 10);
      return true;
    }

    const forwardMsg = [];
    forwardMsg.push({
      nickname: "礼物商店",
      user_id: e.self_id,
      content:
        "🎁 欢迎光临「礼物商店」！\n送礼物可以增加对方的好感度哦~\n\n💡 购买：#购买 礼物名\n💝 赠送：#赠送 礼物名 @某人",
    });

    let giftMsg = "🎁 【礼物】\n━━━━━━━━━━━━━━━━\n";
    for (const gift of gifts) {
      giftMsg += `\n📦 ${gift.name}\n💰 价格：${gift.price} 樱花币\n❤️ 好感度：+${gift.favorability}\n📝 ${gift.description}\n`;
    }
    forwardMsg.push({
      nickname: "礼物商店",
      user_id: e.self_id,
      content: giftMsg.trim(),
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看礼物商店",
      news: [{ text: `共 ${gifts.length} 种礼物` }],
      source: "礼物商店",
    });
    return true;
  });

  buyItem = Command(/^#?(购买|兑换)\s*(\S+)\s*(\d*)$/, async (e) => {
    const shopManager = new ShopManager();
    const itemName = e.match[2].trim();
    const count = parseInt(e.match[3]) || 1;
    const result = await shopManager.buyItem(e, itemName, count);
    if (!result.success && !shopManager.findItemByName(itemName)) {
      return false;
    }
    await e.reply(result.msg);
    return true;
  });

  myBag = Command(/^#?(我的礼物|我的背包|背包)$/, async (e) => {
    const inventoryManager = new InventoryManager(e);
    const inventory = inventoryManager.getInventory();
    const economyManager = new EconomyManager(e);
    const capacity = economyManager.getBagCapacity(e);
    const currentSize = inventoryManager.getCurrentSize();
    const level = economyManager.getBagLevel(e);
    
    const shopManager = new ShopManager();
    const buffs = shopManager.getActiveBuffs(e.group_id, e.user_id);

    const nickname = e.sender.card || e.sender.nickname || e.user_id;
    const forwardMsg = [];

    let bagMsg = `🎒 背包 (Lv.${level}) - 容量: ${currentSize}/${capacity}\n━━━━━━━━━━━━━━━━\n`;
    if (Object.keys(inventory).length > 0) {
      for (const [itemId, count] of Object.entries(inventory)) {
        let name = itemId;
        const item = shopManager.findItemById(itemId) || shopManager.findItemByName(itemId);
        if (item) {
            name = item.name;
        }
        bagMsg += `📦 ${name} x ${count}\n`;
      }
    } else {
        bagMsg += "空空如也~\n";
    }
    
    forwardMsg.push({
        nickname: nickname,
        user_id: e.user_id,
        content: bagMsg.trim(),
    });

    if (Object.keys(buffs).length > 0) {
      let buffMsg = "✨ 活跃增益\n━━━━━━━━━━━━━━━━\n";
      const now = Date.now();
      for (const buff of Object.values(buffs)) {
        const remainingTime = Math.ceil((buff.expireTime - now) / 1000 / 60);
        buffMsg += `💫 ${buff.name}（剩余 ${remainingTime} 分钟）\n`;
      }
      forwardMsg.push({
        nickname: nickname,
        user_id: e.user_id,
        content: buffMsg.trim(),
      });
    }

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看我的背包",
      news: [{ text: `共 ${Object.keys(inventory).length} 种物品` }],
      source: "樱神社",
    });
    return true;
  });

  upgradeBag = Command(/^#?升级背包$/, async (e) => {
    const economyManager = new EconomyManager(e);
    const result = economyManager.upgradeBag(e);
    await e.reply(result.msg);
    return true;
  });

  sendGift = Command(/^#?(赠送|送礼)\s*(.+)$/, async (e) => {
    const giftName = e.match[2].trim();
    const targetId = e.at;

    if (!targetId) {
      return false;
    }

    if (targetId == e.user_id) {
      return false;
    }

    const result = await GiftManager.sendGift(e, giftName, targetId);
    await e.reply(result.msg, 10);
    return true;
  });

  myStatus = Command(/^#?((我|咱)的(信息|等级|资产))$/, async (e) => {
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
      await e.reply("Miko正在睡觉，无法生成图片，请稍后再试~", 10);
    }
    return true;
  });

  transfer = Command(/^#?(转账|投喂|给钱)\s*(\d+).*$/, async (e) => {
    const amount = parseInt(e.match[2]);
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

    const transferLockKey = `sakura:economy:transfer:lock:${e.group_id}:${e.user_id}`;
    const lockTime = await redis.get(transferLockKey);
    if (lockTime) {
      const remainingTime = Math.ceil(
        (300 - (Date.now() / 1000 - Number(lockTime) / 1000)) / 60
      );
      await e.reply(
        `你刚打劫完，赃款还烫手呢！${remainingTime} 分钟后才能转账~`,
        10
      );
      return true;
    }

    const economyManager = new EconomyManager(e);
    const result = economyManager.transfer(e, targetId, amount);

    if (!result.success) {
      await e.reply("你的樱花币不足，无法投喂哦~", 10);
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
      fee: result.fee
    };

    try {
      const generator = new EconomyImageGenerator();
      const image = await generator.generateTransferImage(data);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成转账图片失败: ${err}`);
      await e.reply(
        `投喂成功！你失去了 ${amount} 樱花币，对方获得了 ${result.actualAmount} 樱花币（手续费 ${result.fee}）。`
      );
    }
    return true;
  });

  coinRanking = Command(/^#?(金币|樱花币|富豪)(排行|榜)$/, async (e) => {
    return await this.generateRanking(e, "coins", "樱花币排行榜");
  });

  levelRanking = Command(/^#?(等级|经验|精英)(排行|榜)$/, async (e) => {
    return await this.generateRanking(e, "level", "等级排行榜");
  });

  async generateRanking(e, type, title) {
    const economyManager = new EconomyManager(e);
    const rankingList = economyManager.getRanking(type, 10);

    if (rankingList.length === 0) {
      await e.reply("暂时还没有人上榜哦~", 10);
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
      await e.reply("Miko正在睡觉，无法生成图片，请稍后再试~", 10);
    }
    return true;
  }
}
