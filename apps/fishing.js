import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import _ from "lodash";

const fishingState = {};

export default class Fishing extends plugin {
  constructor() {
    super({
      name: "钓鱼系统",
      event: "message.group",
      priority: 1135,
    });
  }

  /**
   * 开始钓鱼
   */
  startFishing = Command(/^#?钓鱼$/, async (e) => {
    const groupId = e.group_id;
    const userId = e.user_id;

    const fishingManager = new FishingManager(groupId);
    const economyManager = new EconomyManager(e);

    if (!fishingManager.hasAnyRod(userId)) {
      await e.reply("🎣 你还没有鱼竿！\n发送「钓鱼商店」查看并购买鱼竿吧~", 10);
      return true;
    }

    const equippedBait = fishingManager.getEquippedBait(userId);
    if (!equippedBait) {
      await e.reply("🪱 你没有鱼饵了！\n发送「钓鱼商店」购买鱼饵吧~", 10);
      return true;
    }

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    const lastFishTime = await redis.get(cooldownKey);
    if (lastFishTime) {
      const remainingTime = Math.ceil(
        (3600 - (Date.now() / 1000 - Number(lastFishTime))) / 60
      );
      await e.reply(
        `🎣 鱼儿们还没缓过来呢，请等待 ${remainingTime} 分钟后再来钓鱼！`,
        10
      );
      return true;
    }

    if (fishingState[`${groupId}:${userId}`]) {
      await e.reply("你已经在钓鱼了，专心点！", 10);
      return true;
    }

    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const baitConfig = fishingManager.getBaitConfig(equippedBait);

    if (!rodConfig || !baitConfig) {
      await e.reply("装备信息异常，请重新装备鱼竿和鱼饵~", 10);
      return true;
    }

    fishingManager.consumeBait(userId);

    const memberMap = await e.group.getMemberList(true);
    if (!memberMap || memberMap.size === 0) {
      logger.error(`[钓鱼] 获取群成员列表失败`);
      await e.reply("获取鱼塘信息失败，请稍后再试~", 10);
      return true;
    }

    const currentTime = Math.floor(Date.now() / 1000);

    const members = [];
    memberMap.forEach((member) => {
      if (member.user_id === e.self_id || member.user_id === userId) {
        return;
      }

      const memberLevel = Number(member.level) || 0;
      const lastSentTime = member.last_sent_time || currentTime;
      const daysSinceLastMessage = (currentTime - lastSentTime) / (24 * 60 * 60);

      if (memberLevel < rodConfig.minLevel) {
        return;
      }

      if (baitConfig.maxInactiveDays > 0 && daysSinceLastMessage > baitConfig.maxInactiveDays) {
        return;
      }

      members.push(member);
    });

    if (members.length === 0) {
      await e.reply("🐟 鱼塘里没有符合条件的鱼可以钓~\n试试换个鱼竿或鱼饵？", 10);
      return true;
    }

    const fish = members[_.random(0, members.length - 1)];

    const waitTime = _.random(0, 3 * 60 * 1000);

    const fishName = fish.card || fish.nickname || fish.user_id;
    await e.reply(`🎣 你使用【${rodConfig.name}】和【${baitConfig.name}】抛出了鱼竿，静静等待鱼儿上钩...`);

    fishingState[`${groupId}:${userId}`] = {
      fish: fish,
      fishName: fishName,
      startTime: Date.now(),
      phase: "waiting",
    };

    setTimeout(async () => {
      const state = fishingState[`${groupId}:${userId}`];
      if (!state || state.phase !== "waiting") {
        return;
      }

      state.phase = "biting";
      state.biteTime = Date.now();

      await e.reply(
        `🐟 浮漂剧烈抖动！似乎有大鱼上钩了！\n快发送"收杆"或"拉杆"来收获你的猎物！\n⏰ 你有60秒的时间！`,
        false,
        true
      );

      this.setContext("pullRod", groupId, 60);

      state.timeoutTimer = setTimeout(() => {
        const currentState = fishingState[`${groupId}:${userId}`];
        if (currentState && currentState.phase === "biting") {
          currentState.phase = "timeout";
          delete fishingState[`${groupId}:${userId}`];
          e.reply(
            `😢 你没有及时收杆，【${fishName}】跑掉了！`,
            false,
            true
          );
        }
      }, 60 * 1000);
    }, waitTime);

    return true;
  });

  /**
   * 收杆/拉杆
   */
  async pullRod() {
    const e = this.e;
    const groupId = e.group_id;
    const userId = e.user_id;
    const msg = e.msg?.trim();

    if (msg !== "收杆" && msg !== "拉杆") {
      return;
    }

    const state = fishingState[`${groupId}:${userId}`];
    if (!state || state.phase !== "biting") {
      return;
    }

    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
    }

    this.finish("pullRod", groupId);
    delete fishingState[`${groupId}:${userId}`];

    const fish = state.fish;
    const fishName = state.fishName;

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    await redis.set(cooldownKey, String(Math.floor(Date.now() / 1000)), "EX", 3600);

    let fishLevel = Number(fish.level) || 1;
    let price = fishLevel;

    const currentTime = Math.floor(Date.now() / 1000);
    const lastSentTime = fish.last_sent_time || currentTime;
    const daysSinceLastMessage = (currentTime - lastSentTime) / (24 * 60 * 60);

    let priceNote = "";
    if (daysSinceLastMessage >= 60) {
      price = 0;
      priceNote = "（潜水太久，一文不值！）";
    } else if (daysSinceLastMessage >= 30) {
      price = Math.floor(price / 2);
      priceNote = "（潜水一个月，价格减半！）";
    }

    let roleBonus = "";
    if (fish.role === "owner" || fish.role === "admin") {
      price *= 2;
      roleBonus = fish.role === "owner" ? "【群主】" : "【管理员】";
      if (price > 0) {
        priceNote += "（身份尊贵，价格翻倍！）";
      }
    }

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, price);

    const fishingManager = new FishingManager(groupId);
    fishingManager.recordCatch(userId, price, fish.user_id);

    const totalCoins = economyManager.getCoins(e);

    const resultMsg = [
      segment.image(`https://q1.qlogo.cn/g?b=qq&nk=${fish.user_id}&s=640`),
      `\n🎉 钓鱼成功！\n`,
      `🐟 你钓到了${roleBonus}【${fishName}】！\n`,
      `📊 鱼的等级：Lv.${fishLevel}\n`,
      `💰 出售获得：${price} 樱花币${priceNote}\n`,
      `💵 当前余额：${totalCoins} 樱花币`
    ];

    await e.reply(resultMsg);
    return true;
  }

  /**
   * 钓鱼商店
   */
  fishingShop = Command(/^#?(钓鱼商店|渔具店)$/, async (e) => {
    const fishingManager = new FishingManager(e.group_id);
    const rods = fishingManager.getAllRods();
    const baits = fishingManager.getAllBaits();

    const forwardMsg = [];

    forwardMsg.push({
      nickname: "钓鱼商店老板",
      user_id: e.self_id,
      content: "🏪 欢迎光临钓鱼商店！\n这里有各种精良的渔具出售哦~",
    });

    if (rods.length > 0) {
      let rodMsg = "🎣 【鱼竿】（永久道具）\n━━━━━━━━━━━━━━━━\n";
      for (const rod of rods) {
        rodMsg += `📦 ${rod.name}\n💰 价格：${rod.price} 樱花币\n📝 说明：${rod.description}\n\n`;
      }
      forwardMsg.push({
        nickname: "钓鱼商店老板",
        user_id: e.self_id,
        content: rodMsg.trim(),
      });
    }

    if (baits.length > 0) {
      let baitMsg = "🪱 【鱼饵】（消耗品）\n━━━━━━━━━━━━━━━━\n";
      for (const bait of baits) {
        baitMsg += `📦 ${bait.name}\n💰 价格：${bait.price} 樱花币\n📝 说明：${bait.description}\n\n`;
      }
      forwardMsg.push({
        nickname: "钓鱼商店老板",
        user_id: e.self_id,
        content: baitMsg.trim(),
      });
    }

    forwardMsg.push({
      nickname: "钓鱼商店老板",
      user_id: e.self_id,
      content: "💡 购买指南：\n购买：#购买鱼竿 名称 / #购买鱼饵 名称 数量\n装备：#装备鱼竿 名称 / #装备鱼饵 名称\n查看：#我的渔具",
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看钓鱼商店",
      news: [{ text: `共 ${rods.length + baits.length} 件商品` }],
      source: "钓鱼商店",
    });
    return true;
  });

  /**
   * 购买鱼竿
   */
  buyRod = Command(/^#?购买鱼竿\s*(.+)$/, async (e) => {
    const rodName = e.msg.match(/^#?购买鱼竿\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);
    const economyManager = new EconomyManager(e);

    const rod = fishingManager.getAllRods().find(r => r.name === rodName);
    if (!rod) {
      await e.reply(`找不到名为【${rodName}】的鱼竿~`, 10);
      return true;
    }

    if (fishingManager.hasRod(e.user_id, rod.id)) {
      await e.reply(`你已经拥有【${rod.name}】了~`, 10);
      return true;
    }

    const coins = economyManager.getCoins(e);
    if (coins < rod.price) {
      await e.reply(`余额不足！购买【${rod.name}】需要 ${rod.price} 樱花币，你只有 ${coins} 樱花币~`, 10);
      return true;
    }

    economyManager.reduceCoins(e, rod.price);
    fishingManager.buyRod(e.user_id, rod.id);

    await e.reply(`🎣 成功购买【${rod.name}】！\n💰 花费：${rod.price} 樱花币\n💵 剩余：${coins - rod.price} 樱花币`);
    return true;
  });

  /**
   * 购买鱼饵
   */
  buyBait = Command(/^#?购买鱼饵\s*(\S+)\s*(\d*)$/, async (e) => {
    const match = e.msg.match(/^#?购买鱼饵\s*(\S+)\s*(\d*)$/);
    const baitName = match[1].trim();
    const count = parseInt(match[2]) || 1;

    const fishingManager = new FishingManager(e.group_id);
    const economyManager = new EconomyManager(e);

    const bait = fishingManager.getAllBaits().find(b => b.name === baitName);
    if (!bait) {
      await e.reply(`找不到名为【${baitName}】的鱼饵~`, 10);
      return true;
    }

    const totalPrice = bait.price * count;

    const coins = economyManager.getCoins(e);
    if (coins < totalPrice) {
      await e.reply(`余额不足！购买 ${count} 个【${bait.name}】需要 ${totalPrice} 樱花币，你只有 ${coins} 樱花币~`, 10);
      return true;
    }

    economyManager.reduceCoins(e, totalPrice);
    fishingManager.buyBait(e.user_id, bait.id, count);

    const newCount = fishingManager.getBaitCount(e.user_id, bait.id);

    await e.reply(`🪱 成功购买【${bait.name}】x${count}！\n💰 花费：${totalPrice} 樱花币\n📦 当前数量：${newCount} 个\n💵 剩余：${coins - totalPrice} 樱花币`);
    return true;
  });

  /**
   * 装备鱼竿
   */
  equipRod = Command(/^#?装备鱼竿\s*(.+)$/, async (e) => {
    const rodName = e.msg.match(/^#?装备鱼竿\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);

    const rod = fishingManager.getAllRods().find(r => r.name === rodName);
    if (!rod) {
      await e.reply(`找不到名为【${rodName}】的鱼竿~`, 10);
      return true;
    }

    if (!fishingManager.hasRod(e.user_id, rod.id)) {
      await e.reply(`你还没有【${rod.name}】，先去购买吧~`, 10);
      return true;
    }

    fishingManager.equipRod(e.user_id, rod.id);
    await e.reply(`🎣 已装备【${rod.name}】！`);
    return true;
  });

  /**
   * 装备鱼饵
   */
  equipBait = Command(/^#?装备鱼饵\s*(.+)$/, async (e) => {
    const baitName = e.msg.match(/^#?装备鱼饵\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);

    const bait = fishingManager.getAllBaits().find(b => b.name === baitName);
    if (!bait) {
      await e.reply(`找不到名为【${baitName}】的鱼饵~`, 10);
      return true;
    }

    const count = fishingManager.getBaitCount(e.user_id, bait.id);
    if (count <= 0) {
      await e.reply(`你没有【${bait.name}】，先去购买吧~`, 10);
      return true;
    }

    fishingManager.equipBait(e.user_id, bait.id);
    await e.reply(`🪱 已装备【${bait.name}】！剩余 ${count} 个`);
    return true;
  });

  /**
   * 我的渔具
   */
  myEquipment = Command(/^#?(我的渔具|渔具背包|钓鱼装备)$/, async (e) => {
    const fishingManager = new FishingManager(e.group_id);
    const userData = fishingManager.getUserData(e.user_id);

    const equippedRodId = userData.rod;
    const equippedBaitId = userData.bait;
    const equippedRod = equippedRodId ? fishingManager.getRodConfig(equippedRodId) : null;
    const equippedBait = equippedBaitId ? fishingManager.getBaitConfig(equippedBaitId) : null;

    const forwardMsg = [];
    const nickname = e.sender.card || e.sender.nickname || e.user_id;

    let equipMsg = "📌 当前装备：\n";
    equipMsg += `🎣 鱼竿：${equippedRod ? equippedRod.name : "未装备"}\n`;
    equipMsg += `🪱 鱼饵：${equippedBait ? `${equippedBait.name} (剩余 ${fishingManager.getBaitCount(e.user_id, equippedBaitId)} 个)` : "未装备"}`;
    
    forwardMsg.push({
      nickname: nickname,
      user_id: e.user_id,
      content: equipMsg,
    });

    const userRods = userData.rods || [];
    if (userRods.length > 0) {
      let rodMsg = "🎣 拥有的鱼竿：\n";
      for (const rodId of userRods) {
        const rod = fishingManager.getRodConfig(rodId);
        if (rod) {
          const equipped = rodId === equippedRodId ? " [装备中]" : "";
          rodMsg += `📦 ${rod.name}${equipped}\n`;
        }
      }
      forwardMsg.push({
        nickname: nickname,
        user_id: e.user_id,
        content: rodMsg.trim(),
      });
    }

    const userBaits = userData.baits || {};
    const baitEntries = Object.entries(userBaits).filter(([_, count]) => count > 0);
    if (baitEntries.length > 0) {
      let baitMsg = "🪱 拥有的鱼饵：\n";
      for (const [baitId, count] of baitEntries) {
        const bait = fishingManager.getBaitConfig(baitId);
        if (bait) {
          const equipped = baitId === equippedBaitId ? " [装备中]" : "";
          baitMsg += `📦 ${bait.name} x${count}${equipped}\n`;
        }
      }
      forwardMsg.push({
        nickname: nickname,
        user_id: e.user_id,
        content: baitMsg.trim(),
      });
    }

    let statMsg = "📊 钓鱼统计：\n";
    statMsg += `🎣 总钓鱼次数：${userData.totalCatch || 0} 次\n`;
    statMsg += `💰 总收益：${userData.totalEarnings || 0} 樱花币`;
    
    forwardMsg.push({
      nickname: nickname,
      user_id: e.user_id,
      content: statMsg,
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看我的渔具",
      news: [{ text: `当前装备：${equippedRod ? equippedRod.name : "无"}` }],
      source: "钓鱼系统",
    });
    return true;
  });

  /**
   * 钓鱼记录
   */
  fishingRecord = Command(/^#?钓鱼记录(\s*.*)?$/, async (e) => {
    const msg = e.msg.replace(/^#?钓鱼记录/, "").trim();
    
    let targetId = e.user_id;
    if (e.at) {
      targetId = e.at;
    } else if (msg) {
      const match = msg.match(/\d+/);
      if (match) targetId = match[0];
    }

    const fishingManager = new FishingManager(e.group_id);
    const history = fishingManager.getUserCatchHistory(targetId);

    if (history.length === 0) {
      await e.reply("还没有钓到过任何鱼哦~", 10);
      return true;
    }

    let targetName = targetId;
    try {
      const info = await e.getInfo(targetId);
      if (info) {
        targetName = info.card || info.nickname || targetId;
      }
    } catch (err) {}

    let memberMap = null;
    try {
        memberMap = await e.group.getMemberList(true);
    } catch (err) {}

    for (const item of history) {
      let fishName = item.targetUserId;
      if (memberMap && memberMap.has(Number(item.targetUserId))) {
          const m = memberMap.get(Number(item.targetUserId));
          fishName = m.card || m.nickname || item.targetUserId;
      }
      item.name = fishName;
    }

    const userData = fishingManager.getUserData(targetId);
    
    try {
        const generator = new FishingImageGenerator();
        const image = await generator.generateFishingRecord(userData, history, targetName, targetId);
        await e.reply(segment.image(image));
    } catch (err) {
        logger.error(`生成钓鱼记录图片失败: ${err}`);
        await e.reply("生成图片失败，请稍后再试~", 10);
    }

    return true;
  });

  /**
   * 钓鱼排行榜
   */
  fishingRank = Command(/^#?钓鱼排行(榜)?$/, async (e) => {
    const economyManager = new EconomyManager(e);
    const fishingManager = new FishingManager(e.group_id);
    const ranking = economyManager.getRanking("coins", 10);

    if (ranking.length === 0) {
      await e.reply("暂无排行数据~", 10);
      return true;
    }

    const rankData = [];
    for (const user of ranking) {
        let nickname = user.userId;
        try {
            const info = await e.getInfo(user.userId);
            if (info) {
                nickname = info.card || info.nickname || user.userId;
            }
        } catch (err) {}
        
        const fishingData = fishingManager.getUserData(user.userId);
        const catchCount = fishingData.totalCatch || 0;
        
        rankData.push({
            userId: user.userId,
            nickname: nickname,
            coins: user.coins,
            catchCount: catchCount
        });
    }

    try {
        const generator = new FishingImageGenerator();
        const image = await generator.generateFishingRank(rankData);
        await e.reply(segment.image(image));
    } catch (err) {
        logger.error(`生成钓鱼排行图片失败: ${err}`);
        await e.reply("生成图片失败，请稍后再试~", 10);
    }
    
    return true;
  });
}
