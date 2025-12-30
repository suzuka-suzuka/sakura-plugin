import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import _ from "lodash";

const fishingState = {};

function getRarityByLevel(level) {
  if (level >= 80) return { name: "传说", color: "🟠" };
  if (level >= 60) return { name: "史诗", color: "🟣" };
  if (level >= 40) return { name: "稀有", color: "🔵" };
  if (level >= 20) return { name: "精良", color: "🟢" };
  return { name: "普通", color: "⚪" };
}

export default class Fishing extends plugin {
  constructor() {
    super({
      name: "钓鱼系统",
      event: "message.group",
      priority: 1135,
    });
  }

  startFishing = Command(/^#?钓鱼$/, async (e) => {
    const groupId = e.group_id;
    const userId = e.user_id;

    const fishingManager = new FishingManager(groupId);

    if (!fishingManager.hasAnyRod(userId)) {
      await e.reply("🎣 手里空空如也！\n快去「钓鱼商店」挑根鱼竿吧~", 10);
      return true;
    }

    const equippedBait = fishingManager.getEquippedBait(userId);
    if (!equippedBait) {
      await e.reply(
        "🪱 鱼饵用光啦！\n没饵可钓不到鱼，去「钓鱼商店」看看吧~",
        10
      );
      return true;
    }

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    const lastFishTime = await redis.get(cooldownKey);
    if (lastFishTime) {
      const remainingTime = Math.ceil(
        (3600 - (Date.now() / 1000 - Number(lastFishTime))) / 60
      );
      await e.reply(
        `🎣 鱼儿被吓跑了！\n请等待 ${remainingTime} 分钟，等它们放松警惕再来！`,
        10
      );
      return true;
    }

    if (fishingState[`${groupId}:${userId}`]) {
      await e.reply("一心不可二用！你已经在钓鱼啦，专心盯着浮漂~", 10);
      return true;
    }

    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const baitConfig = fishingManager.getBaitConfig(equippedBait);

    if (!rodConfig || !baitConfig) {
      await e.reply("装备异常，请重新装备鱼竿和鱼饵~", 10);
      return true;
    }

    fishingManager.consumeBait(userId);

    const memberMap = await e.group.getMemberList(true);
    if (!memberMap || memberMap.size === 0) {
      logger.error(`[钓鱼] 获取群成员列表失败`);
      await e.reply("鱼塘信息获取失败，稍后再试~", 10);
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
      const daysSinceLastMessage =
        (currentTime - lastSentTime) / (24 * 60 * 60);

      if (memberLevel < rodConfig.minLevel) {
        return;
      }

      if (
        baitConfig.maxInactiveDays > 0 &&
        daysSinceLastMessage > baitConfig.maxInactiveDays
      ) {
        return;
      }

      members.push(member);
    });

    if (members.length === 0) {
      await e.reply(
        "🐟 水域静悄悄，似乎没鱼...\n换个高级点的鱼竿或鱼饵试试？",
        10
      );
      return true;
    }

    const randomChance = _.random(1, 100);
    let catchType = "member";
    let catchData = null;

    const trashItems = fishingManager.getTrashItems();
    const dangerousCreatures = fishingManager.getDangerousCreatures();

    if (randomChance <= 5 && trashItems.length > 0) {
      catchType = "trash";
      catchData = trashItems[_.random(0, trashItems.length - 1)];
    } else if (randomChance <= 10 && dangerousCreatures.length > 0) {
      catchType = "dangerous";
      catchData =
        dangerousCreatures[_.random(0, dangerousCreatures.length - 1)];
    } else {
      catchType = "member";
      catchData = members[_.random(0, members.length - 1)];
    }

    const fish = catchType === "member" ? catchData : null;

    const waitTime = _.random(0, 3 * 60 * 1000);

    const fishName = fish ? fish.card || fish.nickname || fish.user_id : null;
    await e.reply(
      `🎣 挥动【${rodConfig.name}】，挂上【${baitConfig.name}】，抛入水中...\n水面泛起涟漪，耐心等待吧...`
    );

    fishingState[`${groupId}:${userId}`] = {
      fish: fish,
      fishName: fishName,
      catchType: catchType,
      catchData: catchData,
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

      await e.reply(`🌊 浮漂沉下去了！\n快发送"收杆"或"拉杆"！`, false, true);

      this.setContext("pullRod", groupId, 60);

      state.timeoutTimer = setTimeout(() => {
        const currentState = fishingState[`${groupId}:${userId}`];
        if (currentState && currentState.phase === "biting") {
          currentState.phase = "timeout";
          delete fishingState[`${groupId}:${userId}`];
          e.reply(
            `🍃 鱼线松了... 那条鱼挣脱鱼钩跑了...\n下次手脚麻利点！`,
            false,
            true
          );
        }
      }, 60 * 1000);
    }, waitTime);

    return true;
  });

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

    const { fish, fishName, catchType, catchData } = state;
    const fishingManager = new FishingManager(groupId);

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      3600
    );

    if (catchType === "trash") {
      const trash = catchData;
      const resultMsg = [
        `😔 可惜...不是鱼！\n`,
        `${trash.emoji} 钓到了【${trash.name}】！\n`,
        `📝 ${trash.description}\n`,
        `💰 获得：0 樱花币（这破烂玩意儿不值钱）\n`,
        `\n💡 运气不好，下次再接再厠！`,
      ];
      fishingManager.recordCatch(userId, 0, null);
      await e.reply(resultMsg);
      return true;
    }

    if (catchType === "dangerous") {
      const creature = catchData;
      const removedRodId = fishingManager.removeEquippedRod(userId);
      const rodConfig = fishingManager.getRodConfig(removedRodId);
      const rodName = rodConfig?.name || "鱼竿";

      const resultMsg = [
        `😱 糟糕！遇到可怕的生物！\n`,
        `${creature.emoji} 【${creature.name}】出现了！\n`,
        `📝 ${creature.description}\n`,
        `\n💥 你的【${rodName}】被它一口吞掉了！\n`,
        `💰 获得：0 樱花币\n`,
        `\n⚠️ 鱼竿已丢失，请去商店重新购买！`,
      ];
      fishingManager.recordCatch(userId, 0, null);
      await e.reply(resultMsg);
      return true;
    }

    let fishLevel = Number(fish.level) || 1;
    let price = fishLevel;

    const currentTime = Math.floor(Date.now() / 1000);
    const lastSentTime = fish.last_sent_time || currentTime;
    const daysSinceLastMessage = (currentTime - lastSentTime) / (24 * 60 * 60);

    let priceNote = "";
    if (daysSinceLastMessage >= 60) {
      price = 0;
      priceNote = "（潜水太久，变僵尸鱼了，不值钱！）";
    } else if (daysSinceLastMessage >= 30) {
      price = Math.floor(price / 2);
      priceNote = "（潜水一月，肉质变差，价格减半！）";
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

    fishingManager.recordCatch(userId, price, fish.user_id);

    const rarity = getRarityByLevel(fishLevel);
    const resultMsg = [
      `🎉 钓鱼成功！\n`,
      `🐟 钓到了${roleBonus}【${fishName}】！\n`,
      segment.image(`https://q1.qlogo.cn/g?b=qq&nk=${fish.user_id}&s=640`),
      `\n📊 稀有度：${rarity.color}${rarity.name}\n`,
      `💰 获得：${price} 樱花币${priceNote}\n`,
    ];

    await e.reply(resultMsg);
    return true;
  }

  fishingShop = Command(/^#?(钓鱼商店|渔具店)$/, async (e) => {
    const fishingManager = new FishingManager(e.group_id);
    const rods = fishingManager.getAllRods();
    const baits = fishingManager.getAllBaits();

    const forwardMsg = [];

    forwardMsg.push({
      nickname: "钓鱼商店老板",
      user_id: e.self_id,
      content: "🏪 欢迎光临「Sakura 渔具屋」！\n这里有适合您的装备哦~",
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
      content:
        "💡 贴士：\n🛍️ 购买：#购买鱼竿 名称 / #购买鱼饵 名称 数量\n🎒 装备：#装备鱼竿 名称 / #装备鱼饵 名称\n📦 查看：#我的渔具",
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看钓鱼商店",
      news: [{ text: `共 ${rods.length + baits.length} 件商品` }],
      source: "钓鱼商店",
    });
    return true;
  });

  buyRod = Command(/^#?购买鱼竿\s*(.+)$/, async (e) => {
    const rodName = e.msg.match(/^#?购买鱼竿\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);
    const economyManager = new EconomyManager(e);

    const rod = fishingManager.getAllRods().find((r) => r.name === rodName);
    if (!rod) {
      await e.reply(`店里没有叫【${rodName}】的鱼竿呢...`, 10);
      return true;
    }

    if (fishingManager.hasRod(e.user_id, rod.id)) {
      await e.reply(`您已有【${rod.name}】，无需重复购买~`, 10);
      return true;
    }

    const coins = economyManager.getCoins(e);
    if (coins < rod.price) {
      await e.reply(
        `钱不够呢... 购买【${rod.name}】需 ${rod.price} 樱花币，您只有 ${coins}。`,
        10
      );
      return true;
    }

    economyManager.reduceCoins(e, rod.price);
    fishingManager.buyRod(e.user_id, rod.id);

    await e.reply(`成功购买了【${rod.name}】！`);
    return true;
  });

  buyBait = Command(/^#?购买鱼饵\s*(\S+)\s*(\d*)$/, async (e) => {
    const match = e.msg.match(/^#?购买鱼饵\s*(\S+)\s*(\d*)$/);
    const baitName = match[1].trim();
    const count = parseInt(match[2]) || 1;

    const fishingManager = new FishingManager(e.group_id);
    const economyManager = new EconomyManager(e);

    const bait = fishingManager.getAllBaits().find((b) => b.name === baitName);
    if (!bait) {
      await e.reply(`店里没有叫【${baitName}】的鱼饵呢...`, 10);
      return true;
    }

    const totalPrice = bait.price * count;

    const coins = economyManager.getCoins(e);
    if (coins < totalPrice) {
      await e.reply(
        `钱不够啦... 买 ${count} 个【${bait.name}】需 ${totalPrice} 樱花币，您只有 ${coins}。`,
        10
      );
      return true;
    }

    economyManager.reduceCoins(e, totalPrice);
    fishingManager.buyBait(e.user_id, bait.id, count);

    const newCount = fishingManager.getBaitCount(e.user_id, bait.id);

    await e.reply(`成功购买了 ${count} 个【${bait.name}】！`);
    return true;
  });

  equipRod = Command(/^#?装备鱼竿\s*(.+)$/, async (e) => {
    const rodName = e.msg.match(/^#?装备鱼竿\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);

    const rod = fishingManager.getAllRods().find((r) => r.name === rodName);
    if (!rod) {
      await e.reply(`找不到【${rodName}】，请检查名称~`, 10);
      return true;
    }

    if (!fishingManager.hasRod(e.user_id, rod.id)) {
      await e.reply(`您还没有【${rod.name}】，请先购买~`, 10);
      return true;
    }

    fishingManager.equipRod(e.user_id, rod.id);
    await e.reply(`🎣 装备更替！当前使用【${rod.name}】，祝满载而归！`);
    return true;
  });

  equipBait = Command(/^#?装备鱼饵\s*(.+)$/, async (e) => {
    const baitName = e.msg.match(/^#?装备鱼饵\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);

    const bait = fishingManager.getAllBaits().find((b) => b.name === baitName);
    if (!bait) {
      await e.reply(`找不到【${baitName}】，请检查名称~`, 10);
      return true;
    }

    const count = fishingManager.getBaitCount(e.user_id, bait.id);
    if (count <= 0) {
      await e.reply(`背包里没有【${bait.name}】了，请先补充库存~`, 10);
      return true;
    }

    fishingManager.equipBait(e.user_id, bait.id);
    await e.reply(
      `🪱 饵料挂好啦！当前使用【${bait.name}】，库存 ${count} 个。`
    );
    return true;
  });

  myEquipment = Command(/^#?(我的渔具|渔具背包|钓鱼装备)$/, async (e) => {
    const fishingManager = new FishingManager(e.group_id);
    const userData = fishingManager.getUserData(e.user_id);

    const equippedRodId = userData.rod;
    const equippedBaitId = userData.bait;
    const equippedRod = equippedRodId
      ? fishingManager.getRodConfig(equippedRodId)
      : null;
    const equippedBait = equippedBaitId
      ? fishingManager.getBaitConfig(equippedBaitId)
      : null;

    const forwardMsg = [];
    const nickname = e.sender.card || e.sender.nickname || e.user_id;

    let equipMsg = "🎒 您的行囊：\n";
    equipMsg += `🎣 手持：${equippedRod ? equippedRod.name : "空手"}\n`;
    equipMsg += `🪱 诱饵：${
      equippedBait
        ? `${equippedBait.name} (剩余 ${fishingManager.getBaitCount(
            e.user_id,
            equippedBaitId
          )} 个)`
        : "无"
    }`;

    forwardMsg.push({
      nickname: nickname,
      user_id: e.user_id,
      content: equipMsg,
    });

    const userRods = userData.rods || [];
    if (userRods.length > 0) {
      let rodMsg = "📦 鱼竿收藏：\n";
      for (const rodId of userRods) {
        const rod = fishingManager.getRodConfig(rodId);
        if (rod) {
          const equipped = rodId === equippedRodId ? " [已装备]" : "";
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
    const baitEntries = Object.entries(userBaits).filter(
      ([_, count]) => count > 0
    );
    if (baitEntries.length > 0) {
      let baitMsg = "🥡 鱼饵储备：\n";
      for (const [baitId, count] of baitEntries) {
        const bait = fishingManager.getBaitConfig(baitId);
        if (bait) {
          const equipped = baitId === equippedBaitId ? " [已装备]" : "";
          baitMsg += `📦 ${bait.name} x${count}${equipped}\n`;
        }
      }
      forwardMsg.push({
        nickname: nickname,
        user_id: e.user_id,
        content: baitMsg.trim(),
      });
    }

    let statMsg = "📈 战绩统计：\n";
    statMsg += `🎣 挥杆次数：${userData.totalCatch || 0} 次\n`;
    statMsg += `💰 累计获利：${userData.totalEarnings || 0} 樱花币`;

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
      await e.reply("空空如也... 图鉴一片空白，快去钓第一条鱼吧！", 10);
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
      const image = await generator.generateFishingRecord(
        userData,
        history,
        targetName,
        targetId
      );
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成钓鱼记录图片失败: ${err}`);
      await e.reply("画师偷懒了，图片生成失败... 稍后再试~", 10);
    }

    return true;
  });

  fishingRank = Command(/^#?钓鱼排行(榜)?$/, async (e) => {
    const economyManager = new EconomyManager(e);
    const fishingManager = new FishingManager(e.group_id);
    const ranking = economyManager.getRanking("coins", 10);

    if (ranking.length === 0) {
      await e.reply("榜单统计中，暂无数据~", 10);
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
        catchCount: catchCount,
      });
    }

    try {
      const generator = new FishingImageGenerator();
      const image = await generator.generateFishingRank(rankData);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成钓鱼排行图片失败: ${err}`);
      await e.reply("画师偷懒了，图片生成失败... 稍后再试~", 10);
    }

    return true;
  });
}
