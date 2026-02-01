import EconomyManager from "../lib/economy/EconomyManager.js";
import EconomyImageGenerator from "../lib/economy/ImageGenerator.js";
import ShopManager from "../lib/economy/ShopManager.js";
import InventoryManager from "../lib/economy/InventoryManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import _ from "lodash";
import Setting from "../lib/setting.js";

export default class Economy extends plugin {
  constructor() {
    super({
      name: "经济系统",
      event: "message.group",
      priority: 1135,
    });
  }

  get appconfig() {
    return Setting.getConfig("economy");
  }

  checkWhitelist(e) {
    const config = this.appconfig;
    if (!config) return false;
    const groups = config.gamegroups || [];
    if (groups.length === 0) return false;
    return groups.some((g) => String(g) === String(e.group_id));
  }

  rob = Command(/^#?(打劫|抢[劫夺钱])\s*.*$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const targetId = e.at;
    if (!targetId) {
      return false;
    }

    if (targetId == e.user_id) {
      return false;
    }

    const cooldownKey = `sakura:economy:rob:cooldown:${e.group_id}:${e.user_id}`;
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) {
      const newTtl = ttl + 300;
      await redis.expire(cooldownKey, newTtl);
      const remainingTime = Math.ceil(newTtl / 60);
      await e.reply(
        `精英巫女察觉到了你的躁动，加强了戒备...\n请等待 ${remainingTime} 分钟后再行动！`,
        10
      );
      return true;
    }

    const economyManager = new EconomyManager(e);
    const targetCoins = economyManager.getCoins({
      user_id: targetId,
      group_id: e.group_id,
    });
    const attackerCoins = economyManager.getCoins(e);

    if (Math.abs(attackerCoins - targetCoins) > 1000) {
      await this.handleRobberyPenalty(
        e,
        economyManager,
        cooldownKey,
        attackerCoins,
        "由于双方贫富差距过大，"
      );
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
    const successRate = Math.max(
      20,
      Math.min(
        80,
        50 + levelDiff + Math.max(0, targetCoins - attackerCoins) / 20
      )
    );

    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      1800
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
      const robPercent = _.random(1, 20);
      const robAmount = Math.round((targetCoins * robPercent) / 100);

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
      await redis.set(counterKey, counterData, "EX", 120);

      await e.reply(
        `🌸 抢夺成功！\n${attackerName} 从 ${targetName} 那里抢走了 ${robAmount} 樱花币！`
      );
    } else {
      await this.handleRobberyPenalty(
        e,
        economyManager,
        cooldownKey,
        attackerCoins,
        ""
      );
    }

    return true;
  });

  async handleRobberyPenalty(
    e,
    economyManager,
    cooldownKey,
    attackerCoins,
    reasonPrefix
  ) {
    const attackerName = e.sender.card || e.sender.nickname || e.user_id;

    if (attackerCoins < 50) {
      const jailHours = 50 - attackerCoins;
      const jailSeconds = jailHours * 60 * 60;

      economyManager.reduceCoins(e, attackerCoins);
      economyManager.addCoins(
        { user_id: e.self_id, group_id: e.group_id },
        attackerCoins
      );

      await redis.set(
        cooldownKey,
        String(Math.floor(Date.now() / 1000)),
        "EX",
        jailSeconds
      );

      await e.reply(
        `🚨 抢夺失败！\n${reasonPrefix}${attackerName} 被神使当场抓获！\n由于付不起罚款，被直接打入地牢！\n监禁 ${jailHours} 小时`
      );
      return;
    }

    const penalty = 50;
    economyManager.reduceCoins(e, penalty);
    economyManager.addCoins(
      { user_id: e.self_id, group_id: e.group_id },
      penalty
    );

    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      1800
    );

    await e.reply(
      `🚨 抢夺失败！\n${reasonPrefix}${attackerName} 被神使当场抓获！\n受到神罚，失去 ${penalty} 樱花币！`
    );
  }

  counter = Command(/^#?(反击|复仇|神罚)\s*.*$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
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
      Math.round(100 - (elapsedTime / 120) * 100)
    );

    const roll = _.random(1, 100);
    if (roll <= successRate) {
      const counterAmount = Math.round(counterData.amount * 1.5);
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
    if (!this.checkWhitelist(e)) return false;
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

  buyItem = Command(/^#?(购买|兑换)\s*(\S+)\s*(\d*)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
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

  myBag = Command(/^#?(我的)?背包$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const inventoryManager = new InventoryManager(e);
    const inventory = inventoryManager.getInventory();
    const economyManager = new EconomyManager(e);
    const capacity = economyManager.getBagCapacity(e);
    const currentSize = inventoryManager.getCurrentSize();
    const level = economyManager.getBagLevel(e);

    const shopManager = new ShopManager();
    const fishingManager = new FishingManager(e.group_id);

    const nickname = e.sender.card || e.sender.nickname || e.user_id;
    const forwardMsg = [];

    let bagMsg = `🎒 背包 (Lv.${level}) - 容量: ${currentSize}/${capacity}\n━━━━━━━━━━━━━━━━\n`;
    if (Object.keys(inventory).length > 0) {
      for (const [itemId, count] of Object.entries(inventory)) {
        let name = itemId;
        const item =
          shopManager.findItemById(itemId) ||
          shopManager.findItemByName(itemId);
        if (item) {
          name = item.name;
        }

        let rodInfo = "";
        if (itemId.startsWith("rod_")) {
          const durabilityInfo = fishingManager.getRodDurabilityInfo(e.user_id, itemId);
          if (durabilityInfo.maxControl > 0) {
            const durabilityPercent = Math.round((durabilityInfo.currentControl / durabilityInfo.maxControl) * 100);
            rodInfo = ` 耐久: ${durabilityPercent}%`;
          }
        }

        bagMsg += `📦 ${name} x ${count}${rodInfo}\n`;
      }
    } else {
      bagMsg += "空空如也~\n";
    }

    forwardMsg.push({
      nickname: nickname,
      user_id: e.user_id,
      content: bagMsg.trim(),
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看我的背包",
      news: [{ text: `共 ${Object.keys(inventory).length} 种物品` }],
      source: "樱神社",
    });
    return true;
  });

  upgradeBag = Command(/^#?升级背包$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const economyManager = new EconomyManager(e);
    const result = economyManager.upgradeBag(e);
    await e.reply(result.msg);
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

  transfer = Command(/^#?(转账|投喂)\s*(\d+).*$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const amount = parseInt(e.match[2]);
    const targetId = e.at;

    if (!targetId) {
      return false;
    }

    if (targetId === e.user_id) {
      return false;
    }

    if (amount <= 0) {
      return false;
    }

    const economyManager = new EconomyManager(e);
    const fromCoins = economyManager.getCoins(e);

    if (fromCoins < amount) {
      await e.reply(`余额不足！无法投喂~`, 10);
      return true;
    }

    const feePercent = _.random(0, 10);
    const totalFee = 10 + Math.round(amount * (feePercent / 100));
    
    let actualTransfer = amount - totalFee;
    let actualFee = totalFee;
    
    if (totalFee >= amount) {
      actualTransfer = 0;
      actualFee = amount;
    }

    economyManager.reduceCoins(e, amount);
    if (actualTransfer > 0) {
      economyManager.addCoins({ user_id: targetId, group_id: e.group_id }, actualTransfer);
    }
    
    if (actualFee > 0) {
      economyManager.addCoins({ user_id: e.self_id, group_id: e.group_id }, actualFee);
    }

    let fromNickname = e.sender.card || e.sender.nickname || e.user_id;
    let toNickname = targetId;
    try {
      const info = await e.getInfo(targetId);
      if (info) {
        toNickname = info.card || info.nickname || targetId;
      }
    } catch (err) {}

    const data = {
      from: {
        id: e.user_id,
        nickname: String(fromNickname),
        avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`
      },
      to: {
        id: targetId,
        nickname: String(toNickname),
        avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
      },
      amount: actualTransfer,
      fee: actualFee,
      time: new Date().toISOString()
    };

    try {
      const generator = new EconomyImageGenerator();
      const image = await generator.generateTransferImage(data);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成转账图片失败: ${err}`);
      await e.reply(`💰 转账${actualTransfer > 0 ? '成功' : '失败'}！\n实际转账：${actualTransfer} 樱花币\n手续费：${actualFee} 樱花币`);
    }
    return true;
  });

  sell = Command(/^#?出售\s*(\S+).*$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const itemName = e.match[1].trim();
    const shopManager = new ShopManager();
    const inventoryManager = new InventoryManager(e);

    const item = shopManager.findShopItemByName(itemName) || shopManager.findShopItemById(itemName);
    if (!item || item.type !== 'equipment') return false;

    const itemId = item.id || itemName;
    if (inventoryManager.getItemCount(itemId) < 1) {
      await e.reply(`你没有【${item.name}】，无法出售~`, 10);
      return true;
    }

    let sellPrice = Math.floor(item.price * 0.8);
    let durabilityMsg = "";
    
    const fishingManager = new FishingManager(e.group_id);
    const rodConfig = fishingManager.getRodConfig(itemId);

    if (rodConfig) {
      const durabilityInfo = fishingManager.getRodDurabilityInfo(e.user_id, itemId);
      if (durabilityInfo.maxControl > 0) {
        const ratio = durabilityInfo.currentControl / durabilityInfo.maxControl;
        sellPrice = Math.floor(sellPrice * ratio);
        durabilityMsg = `(耐久:${Math.floor(ratio * 100)}%)`;
      }
    }

    if (!inventoryManager.removeItem(itemId, 1)) {
      await e.reply("出售失败，请稍后再试~", 10);
      return true;
    }

    if (rodConfig) {
      fishingManager.clearEquippedRod(e.user_id, itemId);
    }

    new EconomyManager(e).addCoins(e, sellPrice);

    await e.reply(
      `💰 成功出售【${item.name}】${durabilityMsg}！\n💵 获得 ${sellPrice} 樱花币`
    );
    return true;
  });

  useItem = Command(/^#?使用\s*(\S+)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const itemName = e.match[1].trim();
    const shopManager = new ShopManager();
    const item = shopManager.findItemByName(itemName);

    if (!item) return false;

    const inventoryManager = new InventoryManager(e);
    const fishingManager = new FishingManager(e.group_id);
    const groupId = e.group_id;
    const userId = e.user_id;

    if (!item.activation_message && !item.isRandomBait) {
      return false;
    }

    if (inventoryManager.getItemCount(item.id) < 1) {
      await e.reply(`你没有【${itemName}】，无法使用~`, 10);
      return true;
    }

    if (item.isRandomBait) {
      const economyManager = new EconomyManager(e);
      const capacity = economyManager.getBagCapacity(e);
      const currentSize = inventoryManager.getCurrentSize();
      const remainingSpace = capacity - currentSize;

      if (remainingSpace < 2) {
        await e.reply(`背包空间不足！需要至少2~`, 10);
        return true;
      }

      const allBaits = fishingManager.getAllBaits();
      const userBaits = fishingManager.getUserBaits(userId);
      
      let missingBaits = allBaits.filter(b => !userBaits[b.id] || userBaits[b.id] <= 0);
      
      let selectedBait;
      if (missingBaits.length > 0) {
        selectedBait = missingBaits[_.random(0, missingBaits.length - 1)];
      } else {
        selectedBait = allBaits[_.random(0, allBaits.length - 1)];
      }

      inventoryManager.removeItem(item.id, 1);
      
      await inventoryManager.addItem(selectedBait.id, 3);
      
      await e.reply([
        `🎁 打开了随机鱼饵包！\n`,
        `✨ 获得了【${selectedBait.name}】x3！\n`,
        `📝 ${selectedBait.description}`
      ]);
      return true;
    }

    const buffKey = `sakura:fishing:buff:${item.id}:${groupId}:${userId}`;
    
    const existingBuff = await redis.get(buffKey);
    if (existingBuff) {
      await redis.del(buffKey);
    }

    inventoryManager.removeItem(item.id, 1);
    
    const duration = item.duration || 3600;
    await redis.set(buffKey, String(Date.now()), "EX", duration);
    
    await e.reply(item.activation_message);
    return true;
  });

  reviveCoin = Command(/^#?领取复活币$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;

    const fishingKey = `sakura:economy:daily_fishing_count:${e.group_id}:${e.user_id}`;
    const fishingCount = await redis.get(fishingKey);

    if (!fishingCount || parseInt(fishingCount) < 5) {
      return false;
    }

    const key = `sakura:economy:daily_revive:${e.group_id}:${e.user_id}`;
    const hasReceived = await redis.get(key);

    if (hasReceived) {
      await e.reply("你今天已经领取过复活币了，请明天再来吧~", 10);
      return true;
    }

    const economyManager = new EconomyManager(e);
    const coins = economyManager.getCoins(e);

    if (coins >= 100) {
      return false;
    }

    economyManager.addCoins(e, 100);

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const ttl = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);

    await redis.set(key, "1", "EX", ttl);

    await e.reply("看你囊中羞涩，偷偷塞给了你 100 樱花币，希望能助你东山再起~");
    return true;
  });

  coinRanking = Command(/^#?(金币|樱花币|富豪|财富)(排行|榜)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    return await this.generateRanking(e, "coins", "樱花币排行榜");
  });
  levelRanking = Command(/^#?(等级|经验|精英)(排行|榜)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
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
