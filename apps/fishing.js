import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import _ from "lodash";

const fishingState = {};

function getRarityByLevel(level) {
  if (level > 80) return { name: "传说", color: "🟠" };
  if (level > 60) return { name: "史诗", color: "🟣" };
  if (level > 40) return { name: "稀有", color: "🔵" };
  if (level > 20) return { name: "精良", color: "🟢" };
  if (level > 0) return { name: "普通", color: "⚪" };
  return { name: "垃圾", color: "⚫" };
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
        (900 - (Date.now() / 1000 - Number(lastFishTime))) / 60
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

    const memberList = await e.group.getMemberList(true);
    const memberMap = Array.isArray(memberList) ? new Map(memberList.map(m => [m.user_id, m])) : memberList;
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

      const baitQuality = baitConfig.quality || 1;
      const minLevel = (baitQuality - 1) * 20;

      if (memberLevel <= minLevel && baitQuality > 1) {
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

      await e.reply(`🌊 浮漂沉下去了！快收竿！`, false, true);

      this.setContext("pullRod", `${groupId}:${userId}`, 60);

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

    if (!/^(收|拉)(杆|竿)$/.test(msg)) {
      return;
    }

    const state = fishingState[`${groupId}:${userId}`];
    if (!state || state.phase !== "biting") {
      return;
    }

    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
    }

    this.finish("pullRod", `${groupId}:${userId}`);
    delete fishingState[`${groupId}:${userId}`];

    const { fish, fishName, catchType, catchData } = state;
    const fishingManager = new FishingManager(groupId);

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      900
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

    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const rodCapacity = rodConfig?.capacity || 40;

    const eco = new EconomyManager(e);
    if (!eco.data[fish.user_id]) {
        eco.data[fish.user_id] = { coins: 0, experience: 0, level: 1 };
    }
    const fishWeight = eco.data[fish.user_id]?.coins || 0;

    let successRate = 100;
    
    if (rodConfig?.lucky) {
        successRate = rodConfig.luckyRate || 66;
    } else if (fishWeight > rodCapacity) {
        successRate = Math.max(0, 100 - (fishWeight - rodCapacity));
    }

    if (_.random(1, 100) > successRate) {
        if (rodConfig?.lucky) {
            await e.reply([
                `🍀 幸运女神今天没有眷顾你...\n`,
                `😅 你的【${rodConfig?.name}】闪烁了一下，但鱼还是跑了！\n`,
                `💨 下次一定会有好运的！`
            ]);
        } else {
            await e.reply([
                `🎣 哎呀！鱼太重了（${fishWeight}）！\n`,
                `😓 你的【${rodConfig?.name}】弯到了极限，难以控制这条巨物！\n`,
                `💨 鱼儿猛地一挣，逃之夭夭...`
            ]);
        }
        return true;
    }

    let fishLevel = Number(fish.level) || 1;
    let price = Math.floor(fishLevel * (1 + fishWeight / 100));

    const currentTime = Math.floor(Date.now() / 1000);
    const lastSentTime = fish.last_sent_time || currentTime;
    
    const maxDuration = 60 * 24 * 3600;
    const timeDiff = Math.max(0, currentTime - lastSentTime);

    let freshness = Math.max(0, 1 - timeDiff / maxDuration);
    price = Math.floor(price * freshness);

    let priceNote = `（新鲜度 ${(freshness * 100).toFixed(2)}%）`;
    if (freshness <= 0) {
      priceNote = "（新鲜度 0% - 死鱼）";
    }

    let roleBonus = "";
    if (fish.role === "owner" || fish.role === "admin") {
      price *= 2;
      roleBonus = fish.role === "owner" ? "【群主】" : "【管理员】";
      if (price > 0) {
        priceNote += "（身份尊贵，价格翻倍！）";
      }
    }

    let fishNameBonus = "";
    const fishNameData = fishingManager.getFishName(fish.user_id);
    if (fishNameData) {
      fishNameBonus = `【${fishNameData.name}】`;
      price += 10;
      priceNote += "（命名鱼 +10）";
    }

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, price);

    fishingManager.recordCatch(userId, price, fish.user_id);

    const rarity = getRarityByLevel(fishLevel);
    const displayWeight = Math.max(1, fishWeight);
    const freshnessDisplay = freshness <= 0 ? "死鱼" : (freshness * 100).toFixed(2) + "%";
    
    const resultMsg = [
      `🎉 钓鱼成功！\n`,
      `🐟 钓到了${fishNameBonus}【${fishName}】！\n`,
      segment.image(`https://q1.qlogo.cn/g?b=qq&nk=${fish.user_id}&s=640`),
    ];
    
    if (fish.role === "owner" || fish.role === "admin") {
      const roleName = fish.role === "owner" ? "群主" : "管理员";
      resultMsg.push(`\n👑 身份：${roleName}\n`);
    }
    
    resultMsg.push(`📊 稀有度：${rarity.color}${rarity.name}\n`);
    resultMsg.push(`⚖️ 重量：${displayWeight}\n`);
    resultMsg.push(`🧊 新鲜度：${freshnessDisplay}\n`);
    resultMsg.push(`💰 获得：${price} 樱花币\n`);
    
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
      content:
        "🏪 欢迎光临「Sakura 渔具屋」！\n这里有适合您的装备哦~\n\n💡 现在可以使用 #商店 查看所有商品\n或使用 #购买 商品名 [数量] 直接购买",
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
        "💡 贴士：\n🛍️ 购买：#购买 商品名 [数量]\n🎒 装备：#装备鱼竿 名称 / #装备鱼饵 名称\n📦 查看：#背包",
    });

    await e.sendForwardMsg(forwardMsg, {
      prompt: "查看钓鱼商店",
      news: [{ text: `共 ${rods.length + baits.length} 件商品` }],
      source: "钓鱼商店",
    });
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

  nameFish = Command(/^#?鱼命名\s*(\S+)\s*.*$/, async (e) => {
    const targetId = e.at;
    if (!targetId) {
      return false;
    }

    if (targetId == e.user_id) {
      return false;
    }

    const fishName = e.msg.match(/^#?鱼命名\s*(\S+)/)?.[1]?.trim();
    if (!fishName) {
      return false;
    }

    if (fishName.length > 10) {
      await e.reply("鱼名太长了，最多10个字符~", 10);
      return true;
    }

    const economyManager = new EconomyManager(e);
    const coins = economyManager.getCoins(e);
    if (coins < 10) {
      await e.reply("樱花币不足！命名需要 10 樱花币~", 10);
      return true;
    }

    economyManager.reduceCoins(e, 10);

    const fishingManager = new FishingManager(e.group_id);
    fishingManager.setFishName(targetId, fishName, e.user_id);

    let targetName = targetId;
    try {
      const info = await e.getInfo(targetId);
      if (info) {
        targetName = info.card || info.nickname || targetId;
      }
    } catch (err) {}

    await e.reply(
      `🐟 命名成功！\n【${targetName}】现在是【${fishName}】了！\n💰 花费：10 樱花币`
    );
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
      const memberList = await e.group.getMemberList(true);
      memberMap = Array.isArray(memberList) ? new Map(memberList.map(m => [m.user_id, m])) : memberList;
    } catch (err) {}

    for (const item of history) {
      let fishName = item.targetUserId;
      if (memberMap) {
        const member = memberMap.get(Number(item.targetUserId));
        if (member) {
          fishName = member.card || member.nickname || item.targetUserId;
        }
      }
      const fishNameData = fishingManager.getFishName(item.targetUserId);
      if (fishNameData) {
        fishName = `【${fishNameData.name}】${fishName}`;
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
}
