import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import InventoryManager from "../lib/economy/InventoryManager.js";
import _ from "lodash";
import fs from "node:fs";
import path from "node:path";
import { pluginresources } from "../lib/path.js";
import Setting from "../lib/setting.js";

const fishingState = {};

let fishData = [];
try {
  const fishJsonPath = path.join(pluginresources, "fish", "fish.json");
  fishData = JSON.parse(fs.readFileSync(fishJsonPath, "utf8"));
} catch (err) {
  logger.error(`[钓鱼] 加载鱼类数据失败: ${err.message}`);
}

const RARITY_CONFIG = {
  "垃圾": { color: "⚫", level: 0 },
  "普通": { color: "⚪", level: 1 },
  "精品": { color: "🟢", level: 2 },
  "稀有": { color: "🔵", level: 3 },
  "史诗": { color: "🟣", level: 4 },
  "传说": { color: "🟠", level: 5 },
  "宝藏": { color: "👑", level: 6 },
  "噩梦": { color: "💀", level: 7 }
};

function createProgressBar(current, max, length = 10, fillChar = '█', emptyChar = '░') {
  const percentage = Math.max(0, Math.min(100, (current / max) * 100));
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return fillChar.repeat(filled) + emptyChar.repeat(empty);
}

function getRodDamageInfo(fishingManager, userId, rodConfig, damageAmount) {
  const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
  const maxControl = rodConfig.control;
  const durabilityPercent = Math.round((currentControl / maxControl) * 100);
  return `\n⚠️ 鱼竿受到了 ${damageAmount} 点损耗，当前耐久 ${durabilityPercent}%`;
}

function applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, damage) {
  const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
  let msg = "";
  let isBroken = false;

  if (currentControl <= 20) {
    inventoryManager.removeItem(rodConfig.id, 1);
    fishingManager.clearEquippedRod(userId, rodConfig.id);
    msg = `\n💥 鱼竿也断了！\n🎣 失去了【${rodConfig.name}】`;
    isBroken = true;
  } else {
    fishingManager.damageRod(userId, rodConfig.id, damage);
    msg = getRodDamageInfo(fishingManager, userId, rodConfig, damage);
  }
  return { msg, isBroken };
}

function getRarityPoolByBaitQuality(quality, hasDebuff = false, treasureBonus = 0) {
  const allRarities = ["垃圾", "普通", "精品", "稀有", "史诗", "传说", "宝藏", "噩梦"];
  
  let pool = [];
  let weights = [];

  switch (quality) {
    case 1:
      pool = ["垃圾", "普通", "精品", "宝藏", "噩梦"];
      weights = [40, 45, 5, 5, 5];
      break;
    case 2:
      pool = ["垃圾", "普通", "精品", "稀有", "宝藏", "噩梦"];
      weights = [20, 20, 45, 5, 5, 5];
      break;
    case 3:
      pool = ["垃圾", "普通", "精品", "稀有", "史诗", "宝藏", "噩梦"];
      weights = [10, 10, 19, 50, 1, 5, 5];
      break;
    case 4:
      pool = [...allRarities];
      weights = [5, 5, 10, 21, 47, 2, 5, 5];
      break;
    case 5:
      pool = [...allRarities];
      weights = [2, 3, 5, 10, 20, 50, 5, 5];
      break;
    case 6:
      pool = [...allRarities];
      weights = [1, 1, 3, 5, 10, 20, 50, 10];
      break;
    default:
      pool = ["垃圾", "普通", "精品", "宝藏", "噩梦"];
      weights = [40, 45, 5, 5, 5];
  }

  if (treasureBonus > 0) {
    const treasureIdx = pool.indexOf("宝藏");
    if (treasureIdx !== -1) {
      weights[treasureIdx] += treasureBonus;
    }
  }

  if (hasDebuff) {
    const treasureIdx = pool.indexOf("宝藏");
    const nightmareIdx = pool.indexOf("噩梦");

    if (treasureIdx !== -1 && nightmareIdx !== -1) {
      weights[nightmareIdx] += weights[treasureIdx];
      weights[treasureIdx] = 0;
    }
  }

  return { pool, weights };
}

function selectRarityByWeight(pool, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  
  for (let i = 0; i < pool.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return pool[i];
    }
  }
  return pool[pool.length - 1];
}

function getFishByRarity(rarity) {
  const currentHour = new Date().getHours();
  
  return fishData.filter(fish => {
    if (fish.rarity !== rarity) return false;
    
    if (fish.active_hours && fish.active_hours.length > 0) {
      return fish.active_hours.some(([start, end]) => {
        if (start <= end) {
          return currentHour >= start && currentHour < end;
        } else {
          return currentHour >= start || currentHour < end;
        }
      });
    }
    return true;
  });
}

async function selectRandomFish(baitQuality, fishingManager = null, userId = null, groupId = null) {
  if (fishingManager && userId) {
    const torpedoCount = fishingManager.getAvailableTorpedoCount(userId);
    if (torpedoCount > 0) {
      const torpedoWeight = torpedoCount * 5;
      const totalWeight = 100 + torpedoWeight;
      const random = Math.random() * totalWeight;
      
      if (random < torpedoWeight) {
        return {
          id: "torpedo",
          name: "鱼雷",
          rarity: "危险",
          isTorpedo: true,
          actualWeight: 0,
          weight: [0, 0],
          base_price: 0,
          description: "💥 轰！！！"
        };
      }
    }
  }
  
  let hasDebuff = false;
  if (groupId && userId) {
    const key = `sakura:fishing:nightmare:${groupId}:${userId}`;
    const count = await redis.get(key);
    hasDebuff = parseInt(count) > 0;
    if (hasDebuff) {
      await redis.decr(key);
    }
  }
  
  let treasureBonus = 0;
  if (fishingManager && userId) {
    treasureBonus = fishingManager.getTreasureBonus(userId);
  }
  
  const { pool, weights } = getRarityPoolByBaitQuality(baitQuality, hasDebuff, treasureBonus);
  const selectedRarity = selectRarityByWeight(pool, weights);
  
  const availableFish = getFishByRarity(selectedRarity);
  
  const fish = availableFish[_.random(0, availableFish.length - 1)];
  
  const [minWeight, maxWeight] = fish.weight;
  const actualWeight = _.round(_.random(minWeight, maxWeight, true), 2);
  
  const isTreasure = fish.rarity === "宝藏";
  
  return {
    ...fish,
    actualWeight,
    isTreasure
  };
}


async function calculateFishPrice(fish, fishingManager = null) {
  const basePrice = fish.base_price || 0;
  const weight = fish.actualWeight;
  const [minWeight, maxWeight] = fish.weight || [weight, weight];
  const avgWeight = (minWeight + maxWeight) / 2;
  
  let weightRatio = 0;
  if (maxWeight !== minWeight) {
    weightRatio = (weight - avgWeight) / (maxWeight - minWeight) * 2;
  }
  
  const priceMultiplier = 1 + (weightRatio * 0.5);
  
  let torpedoMultiplier = 1;
  if (fishingManager) {
    torpedoMultiplier = await fishingManager.getFishPriceMultiplier();
  }
  
  return Math.round(basePrice * priceMultiplier * torpedoMultiplier);
}

function getFishImagePath(fishId) {
  return path.join(pluginresources, "fish", "img", `${fishId}.png`);
}

export default class Fishing extends plugin {
  constructor() {
    super({
      name: "钓鱼系统",
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
    return groups.some(g => String(g) === String(e.group_id));
  }

  startFishing = Command(/^#?钓鱼$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const groupId = e.group_id;
    const userId = e.user_id;

    const fishingManager = new FishingManager(groupId);

    if (!fishingManager.hasAnyRod(userId)) {
      await e.reply("🎣 手里空空如也！\n快去「商店」挑根鱼竿吧~", 10);
      return true;
    }

    if (!fishingManager.hasAnyLine(userId)) {
      await e.reply("🧵 还没有鱼线！\n快去「商店」买根鱼线吧~", 10);
      return true;
    }

    const equippedBait = fishingManager.getEquippedBait(userId);
    if (!equippedBait) {
      await e.reply("🪱 鱼饵用光啦！\n没饵可钓不到鱼，去「商店」看看吧~", 10);
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
    const equippedLineId = fishingManager.getEquippedLine(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const lineConfig = fishingManager.getLineConfig(equippedLineId);
    const baitConfig = fishingManager.getBaitConfig(equippedBait);

    if (!rodConfig || !lineConfig || !baitConfig) {
      await e.reply("装备异常，请重新装备鱼竿、鱼线和鱼饵~", 10);
      return true;
    }

    fishingManager.consumeBait(userId);

    const baitQuality = baitConfig.quality || 1;

    const selectedFish = await selectRandomFish(baitQuality, fishingManager, userId, groupId);

    const luckyKey = `sakura:fishing:buff:item_charm_lucky:${groupId}:${userId}`;
    const hasLucky = await redis.get(luckyKey);
    const waitTime = _.random(0, 3 * 60 * 1000);
    
    const luckyMsg = hasLucky ? "\n🍀 好运护符生效中！" : "";

    await e.reply(
      `🎣 挥动【${rodConfig.name}】挂上【${baitConfig.name}】伴随着优美的抛物线，鱼钩落入水中...耐心等待浮漂的动静吧...${luckyMsg}`
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
      fish: selectedFish,
      rodConfig,
      lineConfig,
      baitConfig,
      startTime: Date.now(),
      phase: "waiting",
      hasLucky: !!hasLucky,
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

      const fish = currentState.fish;
      const fishWeight = fish.actualWeight;
      const lineBonus = fishingManager.getLineBonusFromMastery(userId, rodConfig.id);
      const lineCapacity = lineConfig.capacity + lineBonus;
      
      currentState.phase = "weight_check";
      currentState.biteTime = Date.now();
      
      if (fish.isTorpedo) {
        await e.reply([
          `🌊 浮漂动了！有鱼上钩啦！\n`,
          `🤩 快！回复「收竿」把它拉上来！`,
        ], false, true);
        
        currentState.isOverweight = false;
        this.setContext("handleFishing", stateKey, 60);
        
        currentState.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "weight_check") {
            cleanupState(stateKey);
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 错过时机了... 鱼跑掉了！`, false, true);
          }
        }, 60 * 1000);
      }
      else if (fishWeight > lineCapacity) {
        await e.reply([
          `🌊 浮漂猛地沉下去了！\n`,
          `😨 这条鱼太大了！鱼线可能撑不住...\n`,
          `📝 回复「收竿」拼了，回复「放弃」保平安`,
        ], false, true);
        
        currentState.isOverweight = true;
        this.setContext("handleFishing", stateKey, 60);
        
        currentState.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "weight_check") {
            cleanupState(stateKey);
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 犹豫太久了... 鱼挣脱跑掉了！`, false, true);
          }
        }, 60 * 1000);
      } else {
        await e.reply([
          `🌊 浮漂动了！有鱼上钩啦！\n`,
          `🤩 快！回复「收竿」把它拉上来！`,
        ], false, true);
        
        currentState.isOverweight = false;
        this.setContext("handleFishing", stateKey, 60);
        
        currentState.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "weight_check") {
            cleanupState(stateKey);
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 错过时机了... 鱼跑掉了！`, false, true);
          }
        }, 60 * 1000);
      }
    }, waitTime);

    return true;
  });


  async handleFishing() {
    const e = this.e;
    const groupId = e.group_id;
    const userId = e.user_id;
    const msg = e.msg?.trim();

    const stateKey = `${groupId}:${userId}`;
    const state = fishingState[stateKey];
    if (!state) {
      return;
    }

    const { fish, rodConfig, lineConfig } = state;
    const fishingManager = new FishingManager(groupId);
    const rodMastery = fishingManager.getRodMastery(userId, rodConfig.id);
    const fishDifficulty = fish.difficulty;

    if (state.phase === "weight_check") {
      if (/^放弃$/.test(msg)) {
        this.finish("handleFishing", stateKey);
        if (state.cleanup) state.cleanup();
        await e.reply(`🎣 放生了这条鱼，期待下次相遇~`);
        return;
      }

      if (!/^(收|拉)(杆|竿)$/.test(msg)) {
        return;
      }

      if (state.confirmTimer) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = null;
      }

      if (fish.isTorpedo) {
        const ownerId = fishingManager.triggerTorpedo(userId);
        
        fishingManager.recordTorpedoHit(userId);
        
        await fishingManager.setFishPriceBoost();
        
        const inventoryManager = new InventoryManager(groupId, userId);
        inventoryManager.removeItem(lineConfig.id, 1);
        fishingManager.clearEquippedLine(userId);
        
        const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 20);
        
        await e.reply([
          `💥💥💥 轰！！！\n`,
          `😱 钓到了`,
          segment.at(ownerId),
          `的鱼雷！\n`,
          `🧵 鱼线被炸断了！`,
          `${damageResult.msg}\n`,
          `😱 鱼雷爆炸引发恐慌！接下来1小时内鱼价1.5倍！`
        ]);
        
        this.finish("handleFishing", stateKey);
        if (state.cleanup) state.cleanup();
        await this.setCooldownAndIncrement(groupId, userId);
        return;
      }

      if (state.hasLucky) {
        await e.reply(`🍀 好运护符发挥了作用！轻松把鱼拉了上来！`);
        await this.finishSuccess(e, state, fishingManager);
        return;
      }

      if (state.isOverweight) {
        const fishWeight = fish.actualWeight;
        const lineBonus = fishingManager.getLineBonusFromMastery(userId, rodConfig.id);
        const lineCapacity = lineConfig.capacity + lineBonus;
        
        if (fishWeight > lineCapacity * 2) {
          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.increaseRodMastery(userId, rodConfig.id);
          
          const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 10);
          
          await e.reply([
            `🌊 巨大的力量传来！\n`,
            `😱 这到底是个什么庞然大物！？(${fishWeight})\n`,
            `💥 啪！鱼线瞬间崩断了！\n`,
            `🧵 【${lineConfig.name}】牺牲了...${damageResult.msg}`,
          ]);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }
        
        const successRate = 1 - (fishWeight - lineCapacity) / lineCapacity;
        const isSuccess = Math.random() < successRate;
        
        const inventoryManager = new InventoryManager(groupId, userId);

        if (!isSuccess) {
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);
          fishingManager.increaseRodMastery(userId, rodConfig.id);
          
          const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 5);
          
          await e.reply([
            `💥 崩！\n`,
            `😫 还是没能坚持住，鱼线断了...\n`,
            `👋 鱼大摇大摆地游走了(${fishWeight})\n`,
            `🧵 失去了【${lineConfig.name}】${damageResult.msg}`,
          ]);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 5);
        
        if (damageResult.isBroken) {
          await e.reply([
            `⚡ 鱼线竟然没断！但是...\n`,
            `💥 咔嚓一声！鱼竿承受不住压力折断了！\n`,
            `😭 你的【${rodConfig.name}】...`,
          ]);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }
        
        await e.reply(`⚡ 鱼线紧绷！勉强撑住了！${damageResult.msg}`);
      }

      state.phase = "difficulty_check";
      const updatedControl = fishingManager.getRodControl(userId, rodConfig.id) + rodMastery;
      
      if (fishDifficulty > updatedControl) {
        await e.reply([
          `😵 这条鱼劲好大！完全拉不动！\n`,
          `⚠️ 看来是条暴脾气的鱼！\n`,
          `📝 怎么处理？\n`,
          `  「强拉」- 大力出奇迹！\n`,
          `  「溜鱼」- 和它比拼耐力！`,
        ]);

        this.setContext("handleFishing", stateKey, 30);
        state.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "difficulty_check") {
            if (s.cleanup) s.cleanup();
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 犹豫太久... 鱼挣脱了！`, false, true);
          }
        }, 30 * 1000);
      } else {
        await this.finishSuccess(e, state, fishingManager);
      }
      return;
    }

    if (state.phase === "difficulty_check") {
      if (state.confirmTimer) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = null;
      }

      if (/^强拉$/.test(msg)) {
        const updatedControl = fishingManager.getRodControl(userId, rodConfig.id) + rodMastery;
        const successRate = Math.max(0, 1 - (fishDifficulty - updatedControl) / 100);
        const isSuccess = Math.random() < successRate;

        if (!isSuccess) {
          await e.reply([
            `💥 啪！用力过猛了！\n`,
            `😫 鱼线应声而断，鱼跑了...\n`,
            `🧵 失去了【${lineConfig.name}】`,
          ]);

          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);
          fishingManager.increaseRodMastery(userId, rodConfig.id);

          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        await e.reply(`💪 强行拉了上来！`);
        await this.finishSuccess(e, state, fishingManager);
        return;
      }

      if (/^溜鱼$/.test(msg)) {
        state.phase = "fighting";
        state.distance = 50;
        state.tension = 50;
        state.fightingRounds = 0;
        
        if (state.totalTimer) clearTimeout(state.totalTimer);
        state.totalTimer = setTimeout(() => {
          if (fishingState[stateKey]) {
            if (state.cleanup) state.cleanup();
            this.finish("handleFishing", stateKey);
            e.reply("🌊 僵持太久了！鱼儿趁你松懈的瞬间，猛地一甩尾逃回了深水区...", false, true);
          }
        }, 60 * 1000);

        const distanceBar = createProgressBar(state.distance, 100, 10);
        const tensionBar = createProgressBar(state.tension, 100, 10);
        
        await e.reply([
          `🎮 开始溜鱼！这是一场耐力的较量！\n`,
          `📏 距离：${distanceBar}\n`,
          `⚡ 张力：${tensionBar}\n`,
          `\n📝 你的策略：\n`,
          `  「拉」- 拉近距离 (张力会升高)\n`,
          `  「溜」- 放松鱼线 (距离会变远)\n`,
          `\n⚠️ 只有 60 秒时间，速战速决！`,
        ]);

        this.setContext("handleFishing", stateKey, 65);
        return;
      }

      return;
    }

    if (state.phase === "fighting") {
      const updatedControl = fishingManager.getRodControl(userId, rodConfig.id) + rodMastery;
      
      if (/^拉$/.test(msg)) {
        state.fightingRounds++;
        
        const pullPower = Math.max(8, Math.floor(updatedControl / 6));
        const fishResist = Math.max(3, Math.floor(fishDifficulty / 20));
        
        const distanceChange = -(pullPower - fishResist + _.random(0, 3));
        const tensionChange = Math.floor(fishDifficulty / 12) + _.random(4, 9);
        
        state.distance += distanceChange;
        state.tension += tensionChange;

        if (state.isOverweight) {
          const inventoryManager = new InventoryManager(groupId, userId);
          const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 1);
          
          if (damageResult.isBroken) {
            await e.reply([
              `💥 鱼竿断了！\n`,
              `🎣 失去了【${rodConfig.name}】\n`,
              `❌ 溜鱼失败... 鱼跑掉了`,
            ]);
            fishingManager.recordCatch(userId, 0, fish.id, false);
            
            this.finish("handleFishing", stateKey);
            if (state.cleanup) state.cleanup();
            await this.setCooldownAndIncrement(groupId, userId);
            return;
          }
        }

        if (state.tension >= 100) {
          await e.reply([
            `💥 崩！\n`,
            `⚡ 线绷得太紧，断掉了！\n`,
            `😓 下次记得适时放松哦...\n`,
            `🧵 失去了【${lineConfig.name}】`,
          ]);

          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);
          fishingManager.increaseRodMastery(userId, rodConfig.id);

          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        if (state.distance <= 0) {
          await e.reply(`🎉 成功把鱼拉上来了！溜了 ${state.fightingRounds} 回合！`);
          await this.finishSuccess(e, state, fishingManager);
          return;
        }

        if (state.distance >= 100) {
          await e.reply([
            `🌊 鱼跑得太远了！\n`,
            `👋 只能目送它离开了...\n`,
            `❌ 鱼逃走了`,
          ]);

          fishingManager.recordCatch(userId, 0, fish.id, false);
          fishingManager.increaseRodMastery(userId, rodConfig.id);
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        const damageHint = state.isOverweight ? getRodDamageInfo(fishingManager, userId, rodConfig, 1) : "";
        const distanceBar = createProgressBar(state.distance, 100, 10);
        const tensionBar = createProgressBar(state.tension, 100, 10);
        
        await e.reply([
          `💪 用力一拉！\n`,
          `📏 距离：${distanceBar}\n`,
          `⚡ 张力：${tensionBar}${damageHint}`,
        ]);
        
        this.setContext("handleFishing", stateKey, 65, false);
        return;
      }

      if (/^溜$/.test(msg)) {
        state.fightingRounds++;
        
        const tensionRelease = _.random(20, 35);
        const fishEscape = Math.max(2, Math.floor(fishDifficulty / 30)) + _.random(1, 4);
        
        state.tension = Math.max(0, state.tension - tensionRelease);
        state.distance += fishEscape;

        if (state.distance >= 100) {
          await e.reply([
            `🌊 鱼跑得太远了！\n`,
            `👋 只能目送它离开了...\n`,
            `❌ 鱼逃走了`,
          ]);

          fishingManager.recordCatch(userId, 0, fish.id, false);
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        const distanceBar = createProgressBar(state.distance, 100, 10);
        const tensionBar = createProgressBar(state.tension, 100, 10);
        
        await e.reply([
          `🌊 放松鱼线...\n`,
          `📏 距离：${distanceBar}\n`,
          `⚡ 张力：${tensionBar}`,
        ]);
        
        this.setContext("handleFishing", stateKey, 65, false);
        return;
      }

      return;
    }
  }

  async setCooldownAndIncrement(groupId, userId) {
    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      600
    );

    const dailyKey = `sakura:economy:daily_fishing_count:${groupId}:${userId}`;
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const ttlDaily = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);

    const count = await redis.incr(dailyKey);
    if (count === 1) {
       await redis.expire(dailyKey, ttlDaily);
    } else {
    }
  }

  async finishSuccess(e, state, fishingManager) {
    const groupId = e.group_id;
    const userId = e.user_id;
    const { fish, rodConfig, lineConfig } = state;
    
    this.finish("handleFishing", `${groupId}:${userId}`);
    if (state.cleanup) state.cleanup();

    const rarity = RARITY_CONFIG[fish.rarity] || { color: "⚪", level: 0 };
    const fishWeight = fish.actualWeight;
    const fishImagePath = getFishImagePath(fish.id);
    const economyManager = new EconomyManager(e);

    if (fish.rarity === "噩梦") {
      fishingManager.recordCatch(userId, 0, fish.id, true);
      fishingManager.increaseRodMastery(userId, rodConfig.id);
      
      const inventoryManager = new InventoryManager(groupId, userId);
      inventoryManager.removeItem(lineConfig.id, 1);
      fishingManager.clearEquippedLine(userId);
      
      let punishmentMsg = "";

      switch (fish.id) {
        case "monster_mimic":
        case "nightmare_bone_shark":
          const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 20);
          punishmentMsg = `💥 它疯狂挣扎，严重损坏了你的鱼竿！${damageResult.msg}`;
          break;

        case "nightmare_thief_murloc":
          const currentCoins1 = economyManager.getCoins(e);
          if (currentCoins1 <= 0) {
            const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 20);
            punishmentMsg = `💸 它想偷你的钱，但发现你身无分文！恼羞成怒的它攻击了你的鱼竿！${damageResult.msg}`;
          } else {
            let stolenAmount1 = _.random(1, 200);
            if (stolenAmount1 > currentCoins1) {
              stolenAmount1 = currentCoins1;
            }
            economyManager.reduceCoins(e, stolenAmount1);
            punishmentMsg = `💸 趁你手忙脚乱之时，它偷走了你 ${stolenAmount1} 樱花币！`;
          }
          break;

        case "nightmare_void_devourer":
          const currentCoins2 = economyManager.getCoins(e);
          if (currentCoins2 <= 0) {
            const damageResult = applyRodDamage(fishingManager, inventoryManager, userId, rodConfig, 20);
            punishmentMsg = `🌑 它想吞噬你的财富，却发现你空空如也！它愤怒地破坏了你的鱼竿！${damageResult.msg}`;
          } else {
            const stealPercent = _.random(1, 20);
            let stolenAmount2 = Math.round(currentCoins2 * (stealPercent / 100));
            if (stolenAmount2 > currentCoins2) {
              stolenAmount2 = currentCoins2;
            }
            if (stolenAmount2 < 1 && currentCoins2 > 0) {
                stolenAmount2 = 1;
            }
            economyManager.reduceCoins(e, stolenAmount2);
            punishmentMsg = `🌑 它吞噬了你的财富... 你丢失了 ${stolenAmount2} 樱花币！`;
          }
          break;

        case "nightmare_cursed_skull":
          const key = `sakura:fishing:nightmare:${groupId}:${userId}`;
          await redis.incrby(key, 5);
          await redis.expire(key, 86400);
          punishmentMsg = `☠️ 诅咒附身！你感觉厄运缠身！`;
          break;
          
        default:
          punishmentMsg = `💥 这是一个噩梦般的生物！`;
      }

      await e.reply([
        `😱 钓到了... 糟糕！是【${fish.name}】！\n`,
        segment.image(`file:///${fishImagePath}`),
        `📝 ${fish.description}\n`,
        `📊 稀有度：${rarity.color}${fish.rarity}\n`,
        `💥 崩！鱼线被扯断了！\n`,
        `🧵 失去了【${lineConfig.name}】\n`,
        punishmentMsg
      ]);
      
      await this.setCooldownAndIncrement(groupId, userId);
      return;
    }

    if (fish.id === "item_rod_repair") {
      fishingManager.recordCatch(userId, 0, fish.id, true);
      fishingManager.clearRodDamage(userId, rodConfig.id);
      fishingManager.clearRodMastery(userId, rodConfig.id);
      fishingManager.increaseRodMastery(userId, rodConfig.id);
      const newMastery = fishingManager.getRodMastery(userId, rodConfig.id);
      
      await this.setCooldownAndIncrement(groupId, userId);

      await e.reply([
        `🎉 钓到了【${fish.name}】！\n`,
        segment.image(`file:///${fishImagePath}`),
        `📝 ${fish.description}\n`,
        `📊 稀有度：${rarity.color}${fish.rarity}\n`,
        `📈 熟练度：${newMastery}`
      ]);
      return;
    }

    if (fish.id === "item_treasure_pearl") {
      fishingManager.recordCatch(userId, 0, fish.id, true);
      fishingManager.increaseRodMastery(userId, rodConfig.id);
      const newMastery = fishingManager.getRodMastery(userId, rodConfig.id);
      
      economyManager.addCoins(e, fish.base_price);
      await this.setCooldownAndIncrement(groupId, userId);

      await e.reply([
        `🎉 钓到了【${fish.name}】！\n`,
        segment.image(`file:///${fishImagePath}`),
        `📝 ${fish.description}\n`,
        `📊 稀有度：${rarity.color}${fish.rarity}\n`,
        `📈 熟练度：${newMastery}\n`,
        `💰 价值：${fish.base_price} 樱花币`,
      ]);
      return;
    }
    
    if (fish.isTreasure || fish.rarity === "宝藏") {
      const inventoryManager = new InventoryManager(groupId, userId);
      const addResult = await inventoryManager.addItem(fish.id, 1);
      
      fishingManager.recordCatch(userId, 0, fish.id, true);
      fishingManager.increaseRodMastery(userId, rodConfig.id);
      const newMastery = fishingManager.getRodMastery(userId, rodConfig.id);
      
      await this.setCooldownAndIncrement(groupId, userId);
      
      if (addResult.success) {
        await e.reply([
          `🎉 钓到了【${fish.name}】！\n`,
          segment.image(`file:///${fishImagePath}`),
          `📝 ${fish.description}\n`,
          `📊 稀有度：${rarity.color}${fish.rarity}\n`,
          `📈 熟练度：${newMastery}`,
        ]);
      } else {
        await e.reply([
          `🎉 钓到了【${fish.name}】！\n`,
          segment.image(`file:///${fishImagePath}`),
          `📝 ${fish.description}\n`,
          `📊 稀有度：${rarity.color}${fish.rarity}\n`,
          `📈 熟练度：${newMastery}\n`,
          `❌ 背包已满，无法放入！宝藏丢失了...`,
        ]);
      }
      return;
    }
    
    const price = await calculateFishPrice(fish, fishingManager);
    
    const buffMultiplier = await this.getFishSellBuffMultiplier(groupId, userId);
    const merchantMultiplier = fishingManager.getMerchantCoinMultiplier(userId);
    const finalPrice = Math.round(price * buffMultiplier * merchantMultiplier);
    
    economyManager.addCoins(e, finalPrice);
    fishingManager.recordCatch(userId, finalPrice, fish.id, true);
    
    fishingManager.increaseRodMastery(userId, rodConfig.id);
    const newMastery = fishingManager.getRodMastery(userId, rodConfig.id);

    await this.setCooldownAndIncrement(groupId, userId);
    
    let priceBoostMsg = "";
    if (await fishingManager.isFishPriceBoostActive()) {
      priceBoostMsg = `😱 鱼雷恐慌中，鱼价1.5倍！\n`;
    }
    
    let buffMsg = "";
    if (buffMultiplier > 1) {
      buffMsg = `✨ 金币加成：×${buffMultiplier}！\n`;
    }
    
    let merchantMsg = "";
    if (merchantMultiplier > 1) {
      const bonusPercent = Math.round((merchantMultiplier - 1) * 100);
      merchantMsg = `💰 商人加成：+${bonusPercent}%！\n`;
    }
    
    const resultMsg = [
      `🎉 钓到了【${fish.name}】！\n`,
      segment.image(`file:///${fishImagePath}`),
      `📝 ${fish.description}\n`,
      `📊 稀有度：${rarity.color}${fish.rarity}\n`,
      `⚖️ 重量：${fishWeight}\n`,
      `📈 熟练度：${newMastery}\n`,
      priceBoostMsg,
      buffMsg,
      merchantMsg,
      `💰 价值：${finalPrice} 樱花币`,
    ];
    await e.reply(resultMsg);    
  }

  async getFishSellBuffMultiplier(groupId, userId) {
    const doubleKey = `sakura:fishing:buff:item_card_double_coin:${groupId}:${userId}`;
    const hasDouble = await redis.get(doubleKey);
    if (hasDouble) {
      return 2;
    }
    
    return 1;
  }


  equipRod = Command(/^#?装备鱼竿\s*(.+)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
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
    if (!this.checkWhitelist(e)) return false;
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

  equipLine = Command(/^#?装备鱼线\s*(.+)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const lineName = e.msg.match(/^#?装备鱼线\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);

    const line = fishingManager.getAllLines().find((l) => l.name === lineName);
    if (!line) {
      await e.reply(`找不到【${lineName}】，请检查名称~`, 10);
      return true;
    }

    if (!fishingManager.hasLine(e.user_id, line.id)) {
      await e.reply(`您还没有【${line.name}】，请先购买~`, 10);
      return true;
    }

    fishingManager.equipLine(e.user_id, line.id);
    await e.reply(`🧵 鱼线换好啦！当前使用【${line.name}】。`);
    return true;
  });

  fishingRecord = Command(/^#?钓鱼记录(\s*\d+)?$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    let msg = e.msg.replace(/^#?钓鱼记录/, "").trim();

    let targetId = e.user_id;
    let page = 1;

    if (msg) {
      const pageNum = parseInt(msg);
      if (!isNaN(pageNum)) {
        page = Math.max(1, pageNum);
      }
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

    const processedHistory = history.map(item => {
      const fishInfo = fishData.find(f => f.id === item.fishId);
      let rarityLevel = 0;
      let rarityName = "垃圾";
      let displayName = item.fishId || "未知鱼类";

      if (fishInfo) {
        rarityName = fishInfo.rarity;
        const config = RARITY_CONFIG[rarityName];
        if (config) {
          rarityLevel = config.level;
        }
        displayName = fishInfo.name;
      }

      return {
        ...item,
        name: displayName,
        rarity: rarityName,
        rarityLevel: rarityLevel
      };
    });

    processedHistory.sort((a, b) => {
      if (b.rarityLevel !== a.rarityLevel) {
        return b.rarityLevel - a.rarityLevel;
      }
      return (a.fishId || "").localeCompare(b.fishId || "");
    });

    const pageSize = 20;
    const totalPages = Math.ceil(processedHistory.length / pageSize);
    if (page > totalPages) page = totalPages;

    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const displayHistory = processedHistory.slice(startIdx, endIdx);

    const userData = fishingManager.getUserData(targetId);

    try {
      const generator = new FishingImageGenerator();
      const image = await generator.generateFishingRecord(
        userData,
        displayHistory,
        targetName,
        targetId
      );
      
      const pageInfo = totalPages > 1 ? `第 ${page} / ${totalPages} 页` : "";
      await e.reply([
        pageInfo ? pageInfo + "\n" : "",
        segment.image(image)
      ]);
    } catch (err) {
      logger.error(`生成钓鱼记录图片失败: ${err}`);
    }

    return true;
  });

  deployTorpedo = Command(/^#?(投放|放置)鱼雷$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const groupId = e.group_id;
    const userId = e.user_id;
    
    const inventoryManager = new InventoryManager(groupId, userId);
    const torpedoCount = inventoryManager.getItemCount("torpedo");
    
    if (torpedoCount <= 0) {
      await e.reply("💣 你背包里没有鱼雷！\n快去「商店」购买吧~", 10);
      return true;
    }
    
    const fishingManager = new FishingManager(groupId);
    
    if (fishingManager.getUserTorpedoCount(userId) > 0) {
      await e.reply("💣 你已经在鱼塘里投放了一个鱼雷！\n一个人最多只能投放一个鱼雷哦~", 10);
      return true;
    }
    
    inventoryManager.removeItem("torpedo", 1);
    
    const result = fishingManager.deployTorpedo(userId);
    
    if (result.success) {
      const totalTorpedoes = fishingManager.getTotalTorpedoCount();
      await e.reply([
        `💣 嘿嘿嘿... 鱼雷已悄悄投放到鱼塘中！\n`,
        `🎯 静待猎物上钩...\n`,
        `📊 当前鱼塘共有 ${totalTorpedoes} 个鱼雷潜伏中~`
      ]);
    } else {
      await inventoryManager.forceAddItem("torpedo", 1);
      await e.reply(result.msg, 10);
    }
    
    return true;
  });

  checkPondTorpedoes = Command(/^#?鱼雷状态$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const fishingManager = new FishingManager(e.group_id);
    const dangerousTorpedoes = fishingManager.getAvailableTorpedoCount(e.user_id);
    const priceBoostActive = await fishingManager.isFishPriceBoostActive();
    
    let msgs = [];
    
    if (dangerousTorpedoes > 0) {
      msgs.push(`💣 对你有威胁的鱼雷：${dangerousTorpedoes} 个\n⚠️ 小心钓鱼！随时可能触雷！`);
    } else {
      msgs.push(`✨ 鱼塘安全，没有威胁你的鱼雷`);
    }
    
    if (priceBoostActive) {
      const remainingMinutes = await fishingManager.getFishPriceBoostRemainingMinutes();
      msgs.push(`🎉 鱼雷效应生效中！\n💰 当前鱼价：×1.5\n⏰ 剩余时间：${remainingMinutes} 分钟`);
    } else {
      msgs.push(`💰 当前鱼价：正常`);
    }
    
    await e.sendForwardMsg(msgs, {
      prompt: "🎣 鱼塘状态",
      news: [
        { text: `💣 威胁鱼雷: ${dangerousTorpedoes}个` },
        { text: priceBoostActive ? "💰 鱼价: ×1.5" : "💰 鱼价: 正常" }
      ],
      source: "钓鱼系统"
    });
    return true;
  });

  fishingRanking = Command(/^#?钓鱼(排行|榜)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
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
    }
    return true;
  });


  viewProfession = Command(/^#?(钓鱼)?职业(列表|一览)?$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const fishingManager = new FishingManager(e.group_id);
    const userData = fishingManager.getUserData(e.user_id);
    const professionInfo = fishingManager.getUserProfession(e.user_id);
    const requirements = FishingManager.getUnlockRequirements();
    const professions = FishingManager.getAllProfessions();
    
    const msgs = [];
    
    if (!professionInfo.profession) {
      const canChoose = fishingManager.canChooseProfession(e.user_id);
      const catchCount = userData.totalCatch || 0;
      
      if (canChoose) {
        msgs.push([
          `🎓 你还没有选择职业！\n`,
          `📊 钓鱼次数: ${catchCount} (已满足解锁条件)\n\n`,
          `📝 发送「#选择职业 职业名」来选择\n`,
          `   例如: #选择职业 宝藏猎人`
        ].join(''));
      } else {
        const remaining = requirements.level_1 - catchCount;
        msgs.push([
          `🎓 你还没有职业\n`,
          `📊 钓鱼次数: ${catchCount}/${requirements.level_1}\n`,
          `🔒 还需要钓${remaining}次鱼才能解锁职业选择！`
        ].join(''));
      }
    } else {
      const professionConfig = FishingManager.getProfessionConfig(professionInfo.profession);
      const currentLevel = professionInfo.level;
      const levelConfig = professionConfig.levels[currentLevel];
      const canAdvance = fishingManager.canAdvanceProfession(e.user_id);
      
      let advanceInfo = "";
      if (currentLevel < 2) {
        if (canAdvance) {
          const nextLevelConfig = professionConfig.levels[2];
          advanceInfo = `\n\n🆙 可以进阶到「${nextLevelConfig.title}」！发送「#进阶职业」`;
        } else {
          const remaining = requirements.level_2 - userData.totalCatch;
          advanceInfo = `\n\n📊 进阶需要: 钓鱼${requirements.level_2}次 (还差${remaining}次)`;
        }
      } else {
        advanceInfo = `\n\n🏆 已达到最高等级！`;
      }
      
      let bonusInfo = "";
      switch (professionInfo.profession) {
        case 'treasure_hunter':
          const treasureBonus = fishingManager.getTreasureBonus(e.user_id);
          bonusInfo = `\n💎 当前宝藏概率加成: +${treasureBonus}权重`;
          break;
        case 'fishing_master':
          const equippedRod = fishingManager.getEquippedRod(e.user_id);
          if (equippedRod) {
            const lineBonus = fishingManager.getLineBonusFromMastery(e.user_id, equippedRod);
            const mastery = fishingManager.getRodMastery(e.user_id, equippedRod);
            bonusInfo = `\n🧵 当前鱼线承重加成: +${lineBonus} (熟练度${mastery})`;
          } else {
            bonusInfo = `\n🧵 装备鱼竿后可查看承重加成`;
          }
          break;
        case 'merchant':
          const coinMultiplier = fishingManager.getMerchantCoinMultiplier(e.user_id);
          const bonusPercent = Math.round((coinMultiplier - 1) * 100);
          bonusInfo = `\n💰 当前金币收益加成: +${bonusPercent}%`;
          break;
      }
      
      msgs.push([
        `🎓 我的职业\n\n`,
        `${professionConfig.icon}【${professionConfig.name}】\n`,
        `🏅 称号: ${levelConfig.title}\n`,
        `📝 ${professionConfig.description}\n`,
        bonusInfo,
        advanceInfo
      ].join(''));
    }
    
    for (const p of professions) {
      const level1 = p.levels[1];
      const level2 = p.levels[2];
      const isCurrentProfession = professionInfo.profession === p.id;
      const currentMark = isCurrentProfession ? ' ✅ 当前职业' : '';
      
      msgs.push([
        `${p.icon}【${p.name}】${currentMark}\n`,
        `📝 ${p.description}\n\n`,
        `⭐ 1级「${level1.title}」\n`,
        `   效果: ${level1.description}\n\n`,
        `⭐ 2级「${level2.title}」\n`,
        `   效果: ${level2.description}`
      ].join(''));
    }
    
    msgs.push([
      `📌 解锁条件\n\n`,
      `🔓 钓鱼${requirements.level_1}次 → 可选择1级职业\n`,
      `🆙 钓鱼${requirements.level_2}次 → 可进阶到2级\n\n`,
      `⚠️ 每人只能选择一个职业，选择后不可更换！`
    ].join(''));
    
    let statusText = "未选择职业";
    if (professionInfo.profession) {
      const config = FishingManager.getProfessionConfig(professionInfo.profession);
      const levelConfig = config.levels[professionInfo.level];
      statusText = `${config.icon}${levelConfig.title}`;
    }
    
    await e.sendForwardMsg(msgs, {
      prompt: "🎣 钓鱼职业系统",
      source: "钓鱼系统",
      news: [
        { text: `当前职业: ${statusText}` },
        { text: `可选职业: ${professions.length}个` }
      ]
    });
    
    return true;
  });

  chooseProfession = Command(/^#?选择职业\s*(.+)$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const professionName = e.msg.match(/^#?选择职业\s*(.+)$/)[1].trim();
    const fishingManager = new FishingManager(e.group_id);
    
    const professions = FishingManager.getAllProfessions();
    const targetProfession = professions.find(p => p.name === professionName);
    
    if (!targetProfession) {
      const validNames = professions.map(p => p.name).join('、');
      await e.reply(`❌ 找不到职业【${professionName}】\n可选职业: ${validNames}`, 10);
      return true;
    }
    
    const result = fishingManager.chooseProfession(e.user_id, targetProfession.id);
    
    if (result.success) {
      const levelConfig = targetProfession.levels[1];
      const requirements = FishingManager.getUnlockRequirements();
      await e.reply([
        `🎉 ${result.msg}\n\n`,
        `${targetProfession.icon}【${targetProfession.name}】\n`,
        `🏅 称号: ${levelConfig.title}\n`,
        `📝 ${targetProfession.description}\n`,
        `⭐ 效果: ${levelConfig.description}\n\n`,
        `💡 钓鱼满${requirements.level_2}次后可以进阶！`
      ]);
    } else {
      await e.reply(`❌ ${result.msg}`, 10);
    }
    return true;
  });

  advanceProfession = Command(/^#?进阶职业$/, async (e) => {
    if (!this.checkWhitelist(e)) return false;
    const fishingManager = new FishingManager(e.group_id);
    
    const result = fishingManager.advanceProfession(e.user_id);
    
    if (result.success) {
      const professionConfig = result.profession;
      const levelConfig = professionConfig.levels[2];
      await e.reply([
        `🎉 ${result.msg}\n\n`,
        `${professionConfig.icon}【${professionConfig.name}】\n`,
        `🏅 称号: ${levelConfig.title}\n`,
        `📝 ${professionConfig.description}\n`,
        `⭐ 效果: ${levelConfig.description}\n\n`,
        `🏆 已达到最高等级！`
      ]);
    } else {
      await e.reply(`❌ ${result.msg}`, 10);
    }
    return true;
  });
}
