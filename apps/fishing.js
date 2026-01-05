import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import Setting from "../lib/setting.js";
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
      await e.reply("🎣 手里空空如也！\n快去「商店」挑根鱼竿吧~", 10);
      return true;
    }

    const equippedBait = fishingManager.getEquippedBait(userId);
    if (!equippedBait) {
      await e.reply(
        "🪱 鱼饵用光啦！\n没饵可钓不到鱼，去「商店」看看吧~",
        10
      );
      return true;
    }

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) {
      const remainingTime = Math.ceil(ttl / 60);
      await e.reply(
        `🎣 歇会儿吧，鱼塘刚被你惊扰过~\n请等待 ${remainingTime} 分钟后再来！`,
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
    const memberMap = Array.isArray(memberList)
      ? new Map(memberList.map((m) => [m.user_id, m]))
      : memberList;
    if (!memberMap || memberMap.size === 0) {
      logger.error(`[钓鱼] 获取群成员列表失败`);
      await e.reply("鱼塘信息获取失败，稍后再试~", 10);
      return true;
    }

    const members = [];
    memberMap.forEach((member) => {
      if (member.user_id === e.self_id || member.user_id === userId) {
        return;
      }

      const memberLevel = Number(member.level) || 0;
      const baitQuality = baitConfig.quality || 1;
      const minLevel = (baitQuality - 1) * 20;

      if (memberLevel <= minLevel && baitQuality > 1) {
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

    const stateKey = `${groupId}:${userId}`;
    
    const cleanupState = (key) => {
      const state = fishingState[key];
      if (state) {
        if (state.waitingTimer) clearTimeout(state.waitingTimer);
        if (state.bitingTimer) clearTimeout(state.bitingTimer);
        if (state.totalTimer) clearTimeout(state.totalTimer);
        delete fishingState[key];
      }
    };

    fishingState[stateKey] = {
      fish: fish,
      fishName: fishName,
      catchType: catchType,
      catchData: catchData,
      startTime: Date.now(),
      phase: "waiting",
      cleanup: () => cleanupState(stateKey),
    };

    const state = fishingState[stateKey];

    state.totalTimer = setTimeout(() => {
      if (fishingState[stateKey]) {
        cleanupState(stateKey);
        this.finish("pullRod", stateKey);
      }
    }, 5 * 60 * 1000);

    state.waitingTimer = setTimeout(async () => {
      const currentState = fishingState[stateKey];
      if (!currentState || currentState.phase !== "waiting") {
        return;
      }

      currentState.phase = "biting";
      currentState.biteTime = Date.now();

      await e.reply(`🌊 浮漂沉下去了！快收竿！`, false, true);

      this.setContext("pullRod", stateKey, 60);

      currentState.bitingTimer = setTimeout(() => {
        const s = fishingState[stateKey];
        if (s && s.phase === "biting") {
          this.finish("pullRod", stateKey);
          cleanupState(stateKey);
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

    const state = fishingState[`${groupId}:${userId}`];
    if (!state) {
      return;
    }

    const stateKey = `${groupId}:${userId}`;

    if (state.phase === "confirming") {
      if (/^(放弃|算了|不要|跑|放生)$/.test(msg)) {
        this.finish("pullRod", stateKey);
        if (state.cleanup) state.cleanup();
        else delete fishingState[stateKey];
        await e.reply(`🐟 你轻轻松开了鱼线，让这条大鱼游走了...\n💡 明智的选择，保护好你的鱼竿！`);
        return true;
      }
      if (!/^(收|拉)(杆|竿)$/.test(msg)) {
        return;
      }
    } else if (state.phase === "biting") {
      if (!/^(收|拉)(杆|竿)$/.test(msg)) {
        return;
      }
    } else {
      return;
    }

    const { fish, fishName, catchType, catchData } = state;
    const fishingManager = new FishingManager(groupId);

    if (catchType === "member" && state.phase === "biting") {
      const equippedRodId = fishingManager.getEquippedRod(userId);
      const rodConfig = fishingManager.getRodConfig(equippedRodId);
      const rodCapacity = fishingManager.getCurrentRodCapacity(userId);

      const eco = new EconomyManager(e);
      if (!eco.data[fish.user_id]) {
        eco.data[fish.user_id] = { coins: 0, experience: 0, level: 1 };
      }
      const fishCoins = eco.data[fish.user_id]?.coins || 0;
      const baseWeight =
        fishCoins > 200
          ? 200 + 24 * Math.log10(fishCoins - 200)
          : fishCoins;
      const randomMultiplier = 0.9 + Math.random() * 0.2;
      const fishWeight = Math.round(baseWeight * randomMultiplier);

      let successRate = 100;
      if (rodConfig?.lucky) {
        if (fishWeight > (rodConfig.capacity || 80)) {
          successRate = rodConfig.luckyRate || 66;
        }
      } else if (fishWeight > rodCapacity) {
        successRate = Math.max(0, 100 - (fishWeight - rodCapacity));
      }

      if (successRate < 100 && !rodConfig?.lucky) {
        state.phase = "confirming";
        state.calculatedWeight = fishWeight;
        state.calculatedSuccessRate = successRate;

        await e.reply(`⚠️ 这条鱼有点重，有可能会损耗鱼竿...\n💪 不过拼一把说不定能钓起来！\n🎯 发送「收竿」强行拉起，「放弃」放生鱼儿`);
        return true;
      }
    }

    this.finish("pullRod", stateKey);
    if (state.cleanup) state.cleanup();
    else delete fishingState[stateKey];

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
        `💰 获得：0 樱花币\n`,
        `💡 运气不好，下次再接再厉！`,
      ];
      fishingManager.recordCatch(userId, 0, null);
      await e.reply(resultMsg);
      return true;
    }

    if (catchType === "dangerous") {
      const creature = catchData;
      const equippedRodId = fishingManager.getEquippedRod(userId);
      const rodConfig = fishingManager.getRodConfig(equippedRodId);
      const rodName = rodConfig?.name || "鱼竿";
      const currentCapacity = fishingManager.getCurrentRodCapacity(userId);

      if (rodConfig?.legendary && _.random(1, 100) <= 50) {
        const economyManager = new EconomyManager(e);
        economyManager.addCoins(e, 1000);

        const resultMsg = [
          `😱 危险！强大的生物出现了！\n`,
          `${creature.emoji} 【${creature.name}】袭来！\n`,
          `📝 ${creature.description}\n`,
          `⚔️ 你的【${rodName}】散发着传说的力量...\n`,
          `🎉 成功钓起了这只危险生物！\n`,
          `💰 获得：1000 樱花币\n`,
          `🏆 击败危险生物是真正的勇者！`,
        ];
        fishingManager.recordDangerousCatch(userId, 1000, creature.name);
        await e.reply(resultMsg);
        return true;
      }

      if (rodConfig?.lucky) {
        fishingManager.removeEquippedRod(userId);
        const economyManager = new EconomyManager(e);
        economyManager.addCoins(e, 1000);

        const resultMsg = [
          `😱 糟糕！遇到可怕的生物！\n`,
          `${creature.emoji} 【${creature.name}】出现了！\n`,
          `📝 ${creature.description}\n`,
          `🍀 你的【${rodName}】闪烁着幸运的光芒...\n`,
          `💥 但还是被一口吞掉了！\n`,
          `✨ 幸运女神的眷顾：获得 1000 樱花币作为补偿！\n`,
          `⚠️ 鱼竿已丢失，请去商店重新购买！`,
        ];
        fishingManager.recordCatch(userId, 1000, null);
        await e.reply(resultMsg);
        return true;
      }

      if (currentCapacity <= 30) {
        fishingManager.removeEquippedRod(userId);
        const resultMsg = [
          `😱 糟糕！遇到可怕的生物！\n`,
          `${creature.emoji} 【${creature.name}】出现了！\n`,
          `📝 ${creature.description}\n`,
          `💥 你的【${rodName}】已经破旧不堪，被它一口吞掉了！\n`,
          `💰 获得：0 樱花币\n`,
          `⚠️ 鱼竿已丢失，请去商店重新购买！`,
        ];
        fishingManager.recordCatch(userId, 0, null);
        await e.reply(resultMsg);
        return true;
      }

      const reduceResult = fishingManager.reduceRodCapacity(userId, 10);
      const remainingHits = Math.floor(
        (reduceResult.currentCapacity - 30) / 10
      );
      const resultMsg = [
        `😱 糟糕！遇到可怕的生物！\n`,
        `${creature.emoji} 【${creature.name}】出现了！\n`,
        `📝 ${creature.description}\n`,
        `💢 你的【${rodName}】受到了损伤！\n`,
        `🛡️ 还能抵御 ${remainingHits} 次损伤\n`,
        `💰 获得：0 樱花币\n`,
        `💡 鱼竿损伤过多可能会被吞掉哦...`,
      ];
      fishingManager.recordCatch(userId, 0, null);
      await e.reply(resultMsg);
      return true;
    }

    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const rodCapacity = fishingManager.getCurrentRodCapacity(userId);

    let fishWeight, successRate;
    if (state.calculatedWeight !== undefined) {
      fishWeight = state.calculatedWeight;
      successRate = state.calculatedSuccessRate;
    } else {
      const eco = new EconomyManager(e);
      if (!eco.data[fish.user_id]) {
        eco.data[fish.user_id] = { coins: 0, experience: 0, level: 1 };
      }
      const fishCoins = eco.data[fish.user_id]?.coins || 0;
      const baseWeight =
        fishCoins > 200
          ? 200 + 24 * Math.log10(fishCoins - 200)
          : fishCoins;
      const randomMultiplier = 0.9 + Math.random() * 0.2;
      fishWeight = Math.round(baseWeight * randomMultiplier);

      successRate = 100;
      if (rodConfig?.lucky) {
        if (fishWeight > (rodConfig.capacity || 30)) {
          successRate = rodConfig.luckyRate || 66;
        }
      } else if (fishWeight > rodCapacity) {
        successRate = Math.max(0, 100 - (fishWeight - rodCapacity));
      }
    }

    if (_.random(1, 100) > successRate) {
      if (rodConfig?.lucky) {
        await e.reply([
          `🍀 幸运女神今天没有眷顾你...\n`,
          `😅 你的【${rodConfig?.name}】闪烁了一下，但鱼还是跑了！\n`,
          `💨 下次一定会有好运的！`,
        ]);
        fishingManager.recordCatch(userId, 0, null);
      } else {
        if (successRate <= 0) {
          const currentCapacity = fishingManager.getCurrentRodCapacity(userId);
          
          if (currentCapacity <= 30) {
            fishingManager.removeEquippedRod(userId);
            await e.reply([
              `🎣 哎呀！鱼太重了（${fishWeight}）！\n`,
              `😓 你的【${rodConfig?.name}】弯到了极限...\n`,
              `💥 咔嚓！鱼竿断了！\n`,
              `⚠️ 鱼竿已丢失，请去商店重新购买！`,
            ]);
            fishingManager.recordCatch(userId, 0, null);
          } else {
            const reduceResult = fishingManager.reduceRodCapacity(userId, 10);
            const remainingHits = Math.floor((reduceResult.currentCapacity - 30) / 10);
            await e.reply([
              `🎣 哎呀！鱼太重了（${fishWeight}）！\n`,
              `😓 你的【${rodConfig?.name}】弯到了极限，难以控制这条巨物！\n`,
              `💢 鱼竿受到了损伤！还能抵御 ${remainingHits} 次损伤\n`,
              `💨 鱼儿猛地一挣，逃之夭夭...`,
            ]);
            fishingManager.recordCatch(userId, 0, null);
          }
        } else {
          await e.reply([
            `🎣 哎呀！鱼太重了（${fishWeight}）！\n`,
            `😓 你的【${rodConfig?.name}】弯到了极限，难以控制这条巨物！\n`,
            `💨 鱼儿猛地一挣，逃之夭夭...`,
          ]);
          fishingManager.recordCatch(userId, 0, null);
        }
      }
      return true;
    }

    let fishLevel = Number(fish.level) || 1;
    let price = Math.round(fishLevel * (1 + fishWeight / 100));


    const proficiency = fishingManager.getProficiency(userId, fish.user_id);
    const proficiencyBonus = 1 + proficiency / 100;
    price = Math.round(price * proficiencyBonus);

    const currentTime = Math.floor(Date.now() / 1000);
    const lastSentTime = fish.last_sent_time || currentTime;

    const maxDuration = 60 * 24 * 3600;
    const timeDiff = Math.max(0, currentTime - lastSentTime);

    let freshness = Math.max(0, 1 - timeDiff / maxDuration);
    price = Math.round(price * freshness);

    if (fish.role === "owner" || fish.role === "admin") {
      price *= 2;
    }

    let fishNameBonus = "";
    const fishNameData = fishingManager.getFishName(fish.user_id);
    if (fishNameData) {
      fishNameBonus = `${fishNameData.name}`;
      price += 10;
    }

    let isDoubled = false;
    if (rodConfig?.doubleChance && _.random(1, 100) <= rodConfig.doubleChance) {
      price *= 2;
      isDoubled = true;
    }

    let isGoldenBonus = false;
    if (rodConfig?.goldenBonus && _.random(1, 100) <= 50) {
      const bonusAmount = Math.round(price * 0.2);
      price += bonusAmount;
      isGoldenBonus = true;
    }

    const economyConfig = Setting.getConfig("economy");
    const doubleGroups = economyConfig?.fishing_double_groups || [];
    if (doubleGroups.includes(groupId)) {
      price = Math.round(price * 2);
    }

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, price);

    fishingManager.recordCatch(userId, price, fish.user_id);

    const rarity = getRarityByLevel(fishLevel);
    const displayWeight = Math.max(1, fishWeight);
    const freshnessDisplay =
      freshness <= 0 ? "死鱼" : (freshness * 100).toFixed(2) + "%";

    const resultMsg = [
      `🎉 钓鱼成功！\n`,
      `🐟 钓到了【${fishName}】！\n`,
      segment.image(`https://q1.qlogo.cn/g?b=qq&nk=${fish.user_id}&s=640`),
    ];

    if (fishNameBonus) {
      resultMsg.push(`🐠 鱼种：${fishNameBonus}\n`);
    }

    if (fish.role === "owner" || fish.role === "admin") {
      const roleName = fish.role === "owner" ? "群主" : "管理员";
      resultMsg.push(`👑 身份：${roleName}\n`);
    }

    resultMsg.push(`📊 稀有度：${rarity.color}${rarity.name}\n`);
    if (proficiency > 0) {
      resultMsg.push(`📈 熟练度：${proficiency}\n`);
    }
    resultMsg.push(`⚖️ 重量：${displayWeight}\n`);
    resultMsg.push(`🧊 新鲜度：${freshnessDisplay}\n`);
    if (isDoubled) {
      resultMsg.push(`✨ 招财加持！樱花币翻倍！\n`);
    }
    if (isGoldenBonus) {
      resultMsg.push(`🌟黄金鱼竿加成！额外获得20%樱花币！\n`);
    }
    resultMsg.push(`💰 获得：${price} 樱花币`);

    await e.reply(resultMsg);

    return true;
  }

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

  sellRod = Command(/^#?(出售|卖掉?)鱼竿\s*(.+)$/, async (e) => {
    const rodName = e.msg.match(/^#?(出售|卖掉?)鱼竿\s*(.+)$/)[2].trim();
    const fishingManager = new FishingManager(e.group_id);

    const rod = fishingManager.getAllRods().find((r) => r.name === rodName);
    if (!rod) {
      await e.reply(`找不到【${rodName}】，请检查名称~`, 10);
      return true;
    }

    if (!fishingManager.hasRod(e.user_id, rod.id)) {
      await e.reply(`您还没有【${rod.name}】，无法出售~`, 10);
      return true;
    }

    const inventoryManager = new (await import("../lib/economy/InventoryManager.js")).default(e.group_id, e.user_id);
    const removeResult = inventoryManager.removeItem(rod.id, 1);
    if (!removeResult) {
      await e.reply(`出售失败，请稍后再试~`, 10);
      return true;
    }

    const equippedRodId = fishingManager.getEquippedRod(e.user_id);
    if (equippedRodId === rod.id && !fishingManager.hasRod(e.user_id, rod.id)) {
      fishingManager.clearEquippedRod(e.user_id);
    }

    const capacityInfo = fishingManager.getRodCapacityInfo(e.user_id, rod.id);
    const sellPrice = Math.round(rod.price * capacityInfo.percentage * 0.8);
    const capacityPercent = Math.round(capacityInfo.percentage * 100);

    fishingManager.clearRodCapacityLoss(e.user_id, rod.id);

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, sellPrice);

    await e.reply(`💰 成功出售【${rod.name}】！\n🎣 耐久：${capacityPercent}%\n💵 原价 ${rod.price} × ${capacityPercent}% × 80% = ${sellPrice} 樱花币`);
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
      memberMap = Array.isArray(memberList)
        ? new Map(memberList.map((m) => [m.user_id, m]))
        : memberList;
    } catch (err) {}

    for (const item of history) {
      let fishName = item.targetUserId;
      
      if (item.isDangerous) {
        const config = Setting.getEconomy('fishing');
        const creature = config?.dangerousCreatures?.find(c => c.name === item.targetUserId);
        if (creature) {
          fishName = `${creature.emoji} ${creature.name}`;
        }
        item.name = fishName;
        item.avatarUrl = null;
      } else {
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

  fishingRanking = Command(/^#?钓鱼(排行|榜)$/, async (e) => {
    const fishingManager = new FishingManager(e.group_id);
    const rankingList = fishingManager.getFishingRanking(10);

    if (rankingList.length === 0) {
      await e.reply("暂时还没有人上榜哦~ 快去钓鱼吧！", 10);
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
          totalEarnings: item.totalEarnings,
          totalCatch: item.totalCatch,
        };
      })
    );

    const data = {
      title: "🎣 钓鱼排行榜",
      list,
    };

    try {
      const generator = new FishingImageGenerator();
      const image = await generator.generateFishingRankingImage(data);
      await e.reply(segment.image(image));
    } catch (err) {
      logger.error(`生成钓鱼排行榜图片失败: ${err}`);
      await e.reply("Miko正在睡觉，无法生成图片，请稍后再试~", 10);
    }
    return true;
  });
}
