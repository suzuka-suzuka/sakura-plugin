import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import InventoryManager from "../lib/economy/InventoryManager.js";
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

// ==================== 公共算法方法 ====================

/**
 * 计算鱼的重量
 * @param {number} fishCoins - 鱼（群友）的樱花币数量
 * @returns {number} 计算后的重量值
 */
function calculateFishWeight(fishCoins) {
  const baseWeight =
    fishCoins > 100
      ? 100 + Math.pow(Math.log2(fishCoins - 100), 2)
      : fishCoins;
  const randomMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(baseWeight * randomMultiplier);
}

/**
 * 计算钓鱼成功率
 * @param {number} fishWeight - 鱼的重量
 * @param {number} rodCapacity - 鱼竿容量
 * @param {number} rodProficiency - 鱼竿熟练度
 * @param {object} rodConfig - 鱼竿配置
 * @returns {number} 成功率 (0-100)
 */
function calculateSuccessRate(fishWeight, rodCapacity, rodProficiency, rodConfig) {
  // 幸运鱼竿特殊逻辑
  if (rodConfig?.lucky) {
    const luckyCapacity = (rodConfig.capacity || -6) + rodProficiency;
    return fishWeight > luckyCapacity ? (rodConfig.luckyRate || 66) : 100;
  }

  // 基础鱼竿（容量 <= 30）
  if (rodCapacity <= 30) {
    return fishWeight > rodCapacity
      ? Math.max(0, 100 - (fishWeight - rodCapacity))
      : 100;
  }

  // 高级鱼竿
  if (fishWeight - rodCapacity >= 100) {
    return 0;
  }

  const effectiveCapacity = rodCapacity + rodProficiency;
  return fishWeight > effectiveCapacity
    ? Math.max(0, 100 - (fishWeight - effectiveCapacity))
    : 100;
}

/**
 * 计算鱼的价格
 * @param {object} fish - 鱼（群友）对象
 * @param {number} fishWeight - 鱼的重量
 * @param {object} fishingManager - 钓鱼管理器实例
 * @param {object} options - 可选配置
 * @returns {object} { price, freshness, fishNameBonus, isDoubled, isGoldenBonus, isTorpedoScare }
 */
async function calculateFishPrice(fish, fishWeight, fishingManager, options = {}) {
  const {
    rodConfig = null,
    groupId = null,
    isExplosion = false, // 是否被炸（鱼雷引爆）
  } = options;

  let fishLevel = Number(fish.level) || 1;
  let price = Math.round(fishLevel * (1 + fishWeight / 100));

  // 计算新鲜度
  const currentTime = Math.floor(Date.now() / 1000);
  const lastSentTime = fish.last_sent_time || currentTime;
  const maxDuration = 60 * 24 * 3600;
  const timeDiff = Math.max(0, currentTime - lastSentTime);
  let freshness = Math.max(0, 1 - timeDiff / maxDuration);
  price = Math.round(price * freshness);

  // 管理员/群主加成
  if (fish.role === "owner" || fish.role === "admin") {
    price *= 2;
  }

  // 鱼名加成
  let fishNameBonus = "";
  const fishNameData = fishingManager.getFishName(fish.user_id);
  if (fishNameData) {
    fishNameBonus = fishNameData.name;
    price += 10;
  }

  // 爆炸减价
  if (isExplosion) {
    price = Math.round(price / 2);
  }

  // 招财鱼竿双倍
  let isDoubled = false;
  if (rodConfig?.doubleChance && _.random(1, 100) <= rodConfig.doubleChance) {
    price *= 2;
    isDoubled = true;
  }

  // 黄金鱼竿加成
  let isGoldenBonus = false;
  if (rodConfig?.goldenBonus && _.random(1, 100) <= 50) {
    const bonusAmount = Math.round(price * 0.2);
    price += bonusAmount;
    isGoldenBonus = true;
  }

  // 鱼雷恐慌加成
  let isTorpedoScare = false;
  if (groupId) {
    const torpedoScareKey = `sakura:fishing:torpedo_scare:${groupId}`;
    const torpedoScareTime = await redis.get(torpedoScareKey);
    if (torpedoScareTime) {
      isTorpedoScare = true;
      price = Math.round(price * 1.5);
    }
  }

  return {
    price,
    freshness,
    fishNameBonus,
    isDoubled,
    isGoldenBonus,
    isTorpedoScare,
  };
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
      await e.reply("🪱 鱼饵用光啦！\n没饵可钓不到鱼，去「商店」看看吧~", 10);
      return true;
    }

    // 检查群每日钓鱼次数限制
    const groupFishingKey = `sakura:fishing:group_daily:${groupId}`;
    const groupFishingCount = await redis.get(groupFishingKey);
    const currentCount = groupFishingCount ? parseInt(groupFishingCount) : 0;
    
    if (currentCount >= 1000) {
      await e.reply("😭 鱼塘里的鱼都被钓光啦！\n🐟 为了可持续发展，请等待凌晨4点鱼苗投放后再来吧~", 10);
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

    const torpedoCheck = fishingManager.checkTorpedoCatch(userId);
    const torpedoCount = torpedoCheck.hasTorpedo ? torpedoCheck.count : 0;
    
    const totalWeight = 100 + torpedoCount;
    const torpedoThreshold = torpedoCount;
    const trashThreshold = torpedoThreshold + 5;
    const dangerousThreshold = trashThreshold + 5;
    
    const randomRoll = _.random(1, totalWeight);

    if (torpedoCount > 0 && randomRoll <= torpedoThreshold) {
      catchType = "torpedo";
      catchData = fishingManager.getRandomTorpedo(userId);
    } else if (randomRoll <= trashThreshold && trashItems.length > 0) {
      catchType = "trash";
      catchData = trashItems[_.random(0, trashItems.length - 1)];
    } else if (randomRoll <= dangerousThreshold && dangerousCreatures.length > 0) {
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
        if (state.confirmTimer) clearTimeout(state.confirmTimer);
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

  // ==================== pullRod 子处理函数 ====================

  /**
   * 处理钓到垃圾的情况
   */
  async handleTrash(e, catchData, fishingManager, userId) {
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

  /**
   * 处理钓到危险生物的情况
   */
  async handleDangerous(e, catchData, fishingManager, userId) {
    const creature = catchData;
    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const rodName = rodConfig?.name || "鱼竿";
    const currentCapacity = fishingManager.getCurrentRodCapacity(userId);

    // 传说鱼竿：可以钓起危险生物
    if (rodConfig?.legendary) {
      const reduceResult = fishingManager.reduceRodCapacity(userId, 10);
      const remainingHits = Math.floor(
        (reduceResult.currentCapacity - 30) / 10
      );

      const economyManager = new EconomyManager(e);
      economyManager.addCoins(e, 1000);

      const resultMsg = [
        `😱 危险！强大的生物出现了！\n`,
        `${creature.emoji} 【${creature.name}】袭来！\n`,
        `📝 ${creature.description}\n`,
        `⚔️ 你的【${rodName}】散发着传说的力量...\n`,
        `🎉 成功钓起了这只危险生物！\n`,
        `💢 但是你的【${rodName}】受到了损伤！\n`,
        `🛡️ 还能抵御 ${remainingHits} 次损伤\n`,
        `💰 获得：1000 樱花币\n`,
        `🏆 击败危险生物是真正的勇者！`,
      ];
      fishingManager.recordDangerousCatch(userId, 1000, creature.name);
      await e.reply(resultMsg);
      return true;
    }

    // 幸运鱼竿：被吞但有补偿
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

    // 鱼竿已破旧：直接被吞
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

    // 普通情况：鱼竿受损
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

  /**
   * 处理钓到鱼雷的情况
   */
  async handleTorpedo(e, catchData, fishingManager, userId, groupId) {
    const torpedo = catchData;
    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const rodName = rodConfig?.name || "鱼竿";
    const currentCapacity = fishingManager.getCurrentRodCapacity(userId);

    // 触发鱼雷
    fishingManager.triggerTorpedo(userId, torpedo.ownerId);

    // 设置鱼雷恐慌
    const torpedoScareKey = `sakura:fishing:torpedo_scare:${groupId}`;
    await redis.set(torpedoScareKey, String(Date.now()), "EX", 1 * 60 * 60);

    const scareMsg = `😱 鱼雷爆炸引发恐慌！接下来1小时内鱼价1.5倍！`;

    // 幸运鱼竿：被炸但有补偿
    if (rodConfig?.lucky) {
      fishingManager.removeEquippedRod(userId);
      const economyManager = new EconomyManager(e);
      economyManager.addCoins(e, 300);

      const resultMsg = [
        `💣 糟糕！钓到了鱼雷！\n`,
        segment.at(torpedo.ownerId),
        ` 埋的鱼雷被钓到了！\n`,
        `🍀 你的【${rodName}】闪烁着幸运的光芒...\n`,
        `💥 但鱼雷爆炸了！鱼竿被炸毁了！\n`,
        `✨ 幸运女神的眷顾：获得 300 樱花币作为补偿！\n`,
        `⚠️ 鱼竿已丢失，请去商店重新购买！\n`,
        scareMsg,
      ];
      fishingManager.recordCatch(userId, 300, null);
      await e.reply(resultMsg);
      return true;
    }

    // 鱼竿已破旧：直接炸毁
    if (currentCapacity <= 30) {
      fishingManager.removeEquippedRod(userId);
      const resultMsg = [
        `💣 糟糕！钓到了鱼雷！\n`,
        segment.at(torpedo.ownerId),
        ` 埋的鱼雷被钓到了！\n`,
        `💥 你的【${rodName}】已经破旧不堪，被炸毁了！\n`,
        `💰 获得：0 樱花币\n`,
        `⚠️ 鱼竿已丢失，请去商店重新购买！\n`,
        scareMsg,
      ];
      fishingManager.recordCatch(userId, 0, null);
      await e.reply(resultMsg);
      return true;
    }

    // 普通情况：鱼竿受损
    const reduceResult = fishingManager.reduceRodCapacity(userId, 10);
    const remainingHits = Math.floor(
      (reduceResult.currentCapacity - 30) / 10
    );
    const resultMsg = [
      `💣 糟糕！钓到了鱼雷！\n`,
      segment.at(torpedo.ownerId),
      ` 埋的鱼雷被钓到了！\n`,
      `💢 你的【${rodName}】受到了损伤！\n`,
      `🛡️ 还能抵御 ${remainingHits} 次损伤\n`,
      `💰 获得：0 樱花币\n`,
      `💡 鱼竿损伤过多可能会被炸毁哦...\n`,
      scareMsg,
    ];
    fishingManager.recordCatch(userId, 0, null);
    await e.reply(resultMsg);
    return true;
  }

  /**
   * 处理钓到群友（鱼）的情况
   */
  async handleMember(e, state, fishingManager, userId, groupId) {
    const { fish, fishName, calculatedWeight: fishWeight, calculatedSuccessRate: successRate } = state;
    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const rodProficiency = fishingManager.getRodProficiency(userId, equippedRodId);
    fishingManager.addRodProficiency(userId, equippedRodId);

    // 判断是否钓鱼失败
    if (_.random(1, 100) > successRate) {
      return await this.handleFishingFailure(e, fishWeight, successRate, fishingManager, userId, rodConfig);
    }

    // 钓鱼成功，计算价格
    const priceResult = await calculateFishPrice(fish, fishWeight, fishingManager, {
      rodConfig,
      groupId,
      isExplosion: false,
    });

    const { price, freshness, fishNameBonus, isDoubled, isGoldenBonus, isTorpedoScare } = priceResult;

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, price);
    fishingManager.recordCatch(userId, price, fish.user_id);

    // 构建结果消息
    const rarity = getRarityByLevel(Number(fish.level) || 1);
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
    if (rodProficiency > 0) {
      resultMsg.push(`📈 熟练度：${rodProficiency}\n`);
    }
    resultMsg.push(`⚖️ 重量：${displayWeight}\n`);
    resultMsg.push(`🧊 新鲜度：${freshnessDisplay}\n`);
    if (isDoubled) {
      resultMsg.push(`✨ 招财加持！樱花币翻倍！\n`);
    }
    if (isGoldenBonus) {
      resultMsg.push(`🌟黄金鱼竿加成！额外获得20%樱花币！\n`);
    }
    if (isTorpedoScare) {
      resultMsg.push(`😱 鱼雷恐慌中！鱼价1.5倍！\n`);
    }
    resultMsg.push(`💰 获得：${price} 樱花币`);

    await e.reply(resultMsg);
    return true;
  }

  /**
   * 处理钓鱼失败的情况
   */
  async handleFishingFailure(e, fishWeight, successRate, fishingManager, userId, rodConfig) {
    // 幸运鱼竿：失败但不损坏
    if (rodConfig?.lucky) {
      await e.reply([
        `🍀 幸运女神今天没有眷顾你...\n`,
        `😅 你的【${rodConfig?.name}】闪烁了一下，但鱼还是跑了！\n`,
        `💨 下次一定会有好运的！`,
      ]);
      fishingManager.recordCatch(userId, 0, null);
      return true;
    }

    // 成功率为0：鱼竿可能损坏
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
        return true;
      }

      const reduceResult = fishingManager.reduceRodCapacity(userId, 10);
      const remainingHits = Math.floor(
        (reduceResult.currentCapacity - 30) / 10
      );
      await e.reply([
        `🎣 哎呀！鱼太重了（${fishWeight}）！\n`,
        `😓 你的【${rodConfig?.name}】弯到了极限，难以控制这条巨物！\n`,
        `💢 鱼竿受到了损伤！还能抵御 ${remainingHits} 次损伤\n`,
        `💨 鱼儿猛地一挣，逃之夭夭...`,
      ]);
      fishingManager.recordCatch(userId, 0, null);
      return true;
    }

    // 普通失败
    await e.reply([
      `🎣 哎呀！鱼太重了（${fishWeight}）！\n`,
      `😓 你的【${rodConfig?.name}】弯到了极限，难以控制这条巨物！\n`,
      `💨 鱼儿猛地一挣，逃之夭夭...`,
    ]);
    fishingManager.recordCatch(userId, 0, null);
    return true;
  }

  // ==================== 状态机处理 ====================

  /**
   * 处理咬钩阶段 (biting)
   * @returns {object|null} { shouldReturn, result } 或 null 表示继续处理
   */
  async handleBitingPhase(e, state, stateKey, fishingManager, userId, groupId) {
    const { fish, catchType } = state;

    // 只有钓到群友才需要检查重量确认
    if (catchType !== "member") {
      return null;
    }

    const equippedRodId = fishingManager.getEquippedRod(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const rodCapacity = fishingManager.getCurrentRodCapacity(userId);
    const rodProficiency = fishingManager.getRodProficiency(userId, equippedRodId);

    // 计算重量和成功率
    const eco = new EconomyManager(e);
    if (!eco.data[fish.user_id]) {
      eco.data[fish.user_id] = { coins: 0, experience: 0, level: 1 };
    }
    const fishCoins = eco.data[fish.user_id]?.coins || 0;
    const fishWeight = calculateFishWeight(fishCoins);
    const successRate = calculateSuccessRate(fishWeight, rodCapacity, rodProficiency, rodConfig);

    // 始终存储计算结果，避免重复计算
    state.calculatedWeight = fishWeight;
    state.calculatedSuccessRate = successRate;

    // 需要确认：成功率 < 100 且不是幸运鱼竿
    if (successRate < 100 && !rodConfig?.lucky) {
      state.phase = "confirming";

      this.setContext("pullRod", stateKey, 60);

      state.confirmTimer = setTimeout(() => {
        const s = fishingState[stateKey];
        if (s && s.phase === "confirming") {
          this.finish("pullRod", stateKey);
          if (s.cleanup) s.cleanup();
          else delete fishingState[stateKey];
          e.reply(
            `🐟 犹豫就会败北...\n这条大鱼已经挣脱鱼钩游走啦！`
          );
        }
      }, 60000);

      await e.reply(
        `⚠️ 这条鱼有点重，有可能会损耗鱼竿...\n💪 不过拼一把说不定能钓起来！\n🎯 发送「收竿」强行拉起，「放弃」放生鱼儿`
      );
      return { shouldReturn: true, result: true };
    }

    return null;
  }

  /**
   * 处理确认阶段 (confirming) - 放弃操作
   * @returns {boolean} 是否已处理
   */
  async handleConfirmingGiveUp(e, state, stateKey) {
    this.finish("pullRod", stateKey);
    if (state.cleanup) state.cleanup();
    else delete fishingState[stateKey];
    await e.reply(
      `🐟 你轻轻松开了鱼线，让这条大鱼游走了...\n💡 明智的选择，保护好你的鱼竿！`
    );
    return true;
  }

  // ==================== 主函数 pullRod ====================

  async pullRod() {
    const e = this.e;
    const groupId = e.group_id;
    const userId = e.user_id;
    const msg = e.msg?.trim();

    const stateKey = `${groupId}:${userId}`;
    const state = fishingState[stateKey];
    if (!state) {
      return;
    }

    // ========== 状态机：处理不同阶段 ==========

    // 确认阶段 (confirming)
    if (state.phase === "confirming") {
      // 放弃操作
      if (/^(放弃|算了|不要|跑|放生)$/.test(msg)) {
        return await this.handleConfirmingGiveUp(e, state, stateKey);
      }
      // 非收竿命令则忽略
      if (!/^(收|拉)(杆|竿)$/.test(msg)) {
        return;
      }
    }
    // 咬钩阶段 (biting)
    else if (state.phase === "biting") {
      // 非收竿命令则忽略
      if (!/^(收|拉)(杆|竿)$/.test(msg)) {
        return;
      }
    }
    // 其他阶段直接返回
    else {
      return;
    }

    const { catchType, catchData } = state;
    const fishingManager = new FishingManager(groupId);

    // ========== 咬钩阶段：检查是否需要进入确认阶段 ==========
    if (state.phase === "biting") {
      const phaseResult = await this.handleBitingPhase(
        e, state, stateKey, fishingManager, userId, groupId
      );
      if (phaseResult?.shouldReturn) {
        return phaseResult.result;
      }
    }

    // ========== 清理状态，设置冷却 ==========
    this.finish("pullRod", stateKey);
    if (state.cleanup) state.cleanup();
    else delete fishingState[stateKey];

    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      180
    );

    // ========== 增加群钓鱼计数，设置到凌晨4点刷新 ==========
    const groupFishingKey = `sakura:fishing:group_daily:${groupId}`;
    const now = new Date();
    const nextReset = new Date(now);
    
    // 如果当前时间已过4点，则设置到明天4点；否则设置到今天4点
    if (now.getHours() >= 4) {
      nextReset.setDate(nextReset.getDate() + 1);
    }
    nextReset.setHours(4, 0, 0, 0);
    
    const secondsUntilReset = Math.floor((nextReset - now) / 1000);
    await redis.incr(groupFishingKey);
    await redis.expire(groupFishingKey, secondsUntilReset);

    // ========== 根据捕获类型分发处理 ==========
    switch (catchType) {
      case "trash":
        return await this.handleTrash(e, catchData, fishingManager, userId);

      case "dangerous":
        return await this.handleDangerous(e, catchData, fishingManager, userId);

      case "torpedo":
        return await this.handleTorpedo(e, catchData, fishingManager, userId, groupId);

      case "member":
        return await this.handleMember(e, state, fishingManager, userId, groupId);

      default:
        return true;
    }
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

    const inventoryManager = new InventoryManager(e.group_id, e.user_id);
    const removeResult = inventoryManager.removeItem(rod.id, 1);
    if (!removeResult) {
      await e.reply(`出售失败，请稍后再试~`, 10);
      return true;
    }

    const equippedRodId = fishingManager.getEquippedRod(e.user_id);
    if (equippedRodId === rod.id && !fishingManager.hasRod(e.user_id, rod.id)) {
      fishingManager.clearEquippedRod(e.user_id);
    }

    // --- 修改开始 ---
    
    // 获取耐久度信息仅用于展示（如果不需要展示耐久也可以删除这两行）
    const capacityInfo = fishingManager.getRodCapacityInfo(e.user_id, rod.id);
    const capacityPercent = Math.round(capacityInfo.percentage * 100);

    // 核心修改：直接使用原价，不再乘以百分比和0.8
    const sellPrice = rod.price; 

    fishingManager.clearRodCapacityLoss(e.user_id, rod.id);
    fishingManager.clearRodProficiency(e.user_id, rod.id);

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, sellPrice);

    // 修改回复文案，去掉计算公式，直接显示全额退款
    await e.reply(
      `💰 成功全额出售【${rod.name}】！\n🎣 剩余耐久：${capacityPercent}%\n💵 获得退款：${sellPrice} 樱花币`
    );
    
    // --- 修改结束 ---
    
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
        const config = Setting.getEconomy("fishing");
        const creature = config?.dangerousCreatures?.find(
          (c) => c.name === item.targetUserId
        );
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
      const displayHistory = history.slice(0, 20);
      const image = await generator.generateFishingRecord(
        userData,
        displayHistory,
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

  deployTorpedo = Command(/^#?投放鱼雷$/, async (e) => {
    const groupId = e.group_id;
    const userId = e.user_id;

    const fishingManager = new FishingManager(groupId);
    const inventoryManager = new InventoryManager(groupId, userId);

    if (fishingManager.hasDeployedTorpedo(userId)) {
      const torpedo = fishingManager.getUserTorpedo(userId);
      const canResult = fishingManager.canDetonateTorpedo(userId);
      
      if (canResult.canDetonate) {
        await e.reply(
          `💣 你已经在鱼塘里埋了一颗鱼雷！\n⏰ 已经可以引爆了\n💡 每人同一时间只能在鱼塘里埋一颗鱼雷哦~`,
          10
        );
      } else {
        await e.reply(
          `💣 你已经在鱼塘里埋了一颗鱼雷！\n⏰ 还需要等待 ${canResult.remainingHours} 小时 ${canResult.remainingMinutes} 分钟才能引爆\n💡 每人同一时间只能在鱼塘里埋一颗鱼雷哦~`,
          10
        );
      }
      return true;
    }

    const torpedoCount = inventoryManager.getItemCount("torpedo");
    if (torpedoCount <= 0) {
      await e.reply("💣 你没有鱼雷！\n快去「商店」买一个吧~", 10);
      return true;
    }

    inventoryManager.removeItem("torpedo", 1);

    const result = fishingManager.deployTorpedo(userId);
    if (result.success) {
      await e.reply(
        `💣 鱼雷投放成功！\n🌊 鱼雷悄悄沉入水底...\n⏰ 12小时后可以引爆`
      );
    } else {
      inventoryManager.addItem("torpedo", 1);
      await e.reply("💣 投放失败，请稍后再试~", 10);
    }
    return true;
  });

  detonateTorpedo = Command(/^#?引爆鱼雷$/, async (e) => {
    const groupId = e.group_id;
    const userId = e.user_id;

    const fishingManager = new FishingManager(groupId);

    if (!fishingManager.hasDeployedTorpedo(userId)) {
      await e.reply("💣 你没有在鱼塘里投放鱼雷！\n先去投放一颗吧~", 10);
      return true;
    }

    const canResult = fishingManager.canDetonateTorpedo(userId);
    if (!canResult.canDetonate) {
      if (canResult.reason === "not_ready") {
        await e.reply(
          `⏳ 鱼雷引信尚未解除保险！\n⏰ 需等待 ${canResult.remainingHours} 小时 ${canResult.remainingMinutes} 分钟后方可手动引爆`,
          10
        );
      } else {
        await e.reply("💣 引爆失败，请稍后再试~", 10);
      }
      return true;
    }

    const memberList = await e.group.getMemberList(true);
    const memberMap = Array.isArray(memberList)
      ? new Map(memberList.map((m) => [m.user_id, m]))
      : memberList;

    if (!memberMap || memberMap.size === 0) {
      await e.reply("鱼塘信息获取失败，稍后再试~", 10);
      return true;
    }

    const members = [];
    memberMap.forEach((member) => {
      if (member.user_id === e.self_id || member.user_id === userId) {
        return;
      }
      members.push(member);
    });

    if (members.length === 0) {
      await e.reply("🌊 水域里空空如也... 没什么可炸的~", 10);
      return true;
    }

    fishingManager.detonateTorpedo(userId);

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
      catchData = dangerousCreatures[_.random(0, dangerousCreatures.length - 1)];
    } else {
      catchType = "member";
      catchData = members[_.random(0, members.length - 1)];
    }

    if (catchType === "trash") {
      const trash = catchData;
      const resultMsg = [
        `💥 轰！鱼雷引爆了！\n`,
        `🌊 水花四溅...\n`,
        `${trash.emoji} 炸出了【${trash.name}】！\n`,
        `📝 ${trash.description}\n`,
        `💰 获得：0 樱花币\n`,
        `💡 运气不好，炸到垃圾了...`,
      ];
      fishingManager.recordCatch(userId, 0, null);
      await e.reply(resultMsg);
      return true;
    }

    if (catchType === "dangerous") {
      const creature = catchData;
      const economyManager = new EconomyManager(e);
      economyManager.addCoins(e, 500);

      const resultMsg = [
        `💥 轰——！！水底传来一声闷响！\n`,
        `🌊 剧烈的冲击波将水面炸开了花...\n`,
        `📝 ${creature.description}\n`,
        `${creature.emoji} 竟然炸翻了【${creature.name}】！\n`,
        `⚔️ 这只危险生物虽然被消灭，但已经被炸得面目全非...\n`,
        `💰 获得：500 樱花币\n`,
        `💡 因尸体受损严重，收购价格减半...`,
      ];
      fishingManager.recordDangerousCatch(userId, 500, creature.name);
      await e.reply(resultMsg);
      return true;
    }

    // 使用公共算法计算重量和价格
    const fish = catchData;
    const fishName = fish.card || fish.nickname || fish.user_id;

    const eco = new EconomyManager(e);
    if (!eco.data[fish.user_id]) {
      eco.data[fish.user_id] = { coins: 0, experience: 0, level: 1 };
    }
    const fishCoins = eco.data[fish.user_id]?.coins || 0;
    const fishWeight = calculateFishWeight(fishCoins);

    // 使用公共价格计算（爆炸模式）
    const priceResult = await calculateFishPrice(fish, fishWeight, fishingManager, {
      rodConfig: null,
      groupId,
      isExplosion: true,
    });

    const { price, freshness, fishNameBonus, isTorpedoScare } = priceResult;

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, price);
    fishingManager.recordCatch(userId, price, fish.user_id);

    // 构建结果消息
    const rarity = getRarityByLevel(Number(fish.level) || 1);
    const displayWeight = Math.max(1, fishWeight);
    const freshnessDisplay =
      freshness <= 0 ? "死鱼" : (freshness * 100).toFixed(2) + "%";

    const resultMsg = [
      `💥 轰！鱼雷引爆了！\n`,
      `🌊 水花四溅...\n`,
      `🐟 炸到了【${fishName}】！\n`,
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
    resultMsg.push(`⚖️ 重量：${displayWeight}\n`);
    resultMsg.push(`🧊 新鲜度：${freshnessDisplay}\n`);
    resultMsg.push(`💢 鱼被炸伤了，价格减半！\n`);
    if (isTorpedoScare) {
      resultMsg.push(`😱 鱼雷恐慌中！鱼价1.5倍！\n`);
    }
    resultMsg.push(`💰 获得：${price} 樱花币`);

    await e.reply(resultMsg);
    return true;
  });

  torpedoStatus = Command(/^#?鱼雷状态$/, async (e) => {
    const groupId = e.group_id;
    const userId = e.user_id;

    const fishingManager = new FishingManager(groupId);
    const inventoryManager = new InventoryManager(groupId, userId);

    const torpedoCount = inventoryManager.getItemCount("torpedo");
    const torpedoStats = fishingManager.getTorpedoStats(userId);
    const torpedo = fishingManager.getUserTorpedo(userId);
    const poolCount = fishingManager.getTorpedoCount(userId);

    let torpedoStatusText = "❌ 未投放";
    if (torpedo) {
      const canResult = fishingManager.canDetonateTorpedo(userId);
      if (canResult.canDetonate) {
        torpedoStatusText = "✅ 已可引爆";
      } else {
        torpedoStatusText = `⏰ 还需 ${canResult.remainingHours}时${canResult.remainingMinutes}分`;
      }
    }

    const forwardMsg = [
      `💣 鱼雷状态\n━━━━━━━━━━━━━━━\n📦 背包鱼雷：${torpedoCount} 个\n🌊 鱼塘鱼雷：${poolCount} 个（不含自己的）\n🎯 你的鱼雷：${torpedoStatusText}`,
      `📊 鱼雷统计\n━━━━━━━━━━━━━━━\n💣 投放次数：${torpedoStats.deployed}\n💥 成功引爆：${torpedoStats.detonated}\n🎯 钓到别人的雷：${torpedoStats.hitOthers}\n😱 被别人钓到：${torpedoStats.hitByOthers}`,
    ];

    await e.sendForwardMsg(forwardMsg, { prompt: "💣 鱼雷状态" });
    return true;
  });
}
