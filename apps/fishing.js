import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import InventoryManager from "../lib/economy/InventoryManager.js";
import _ from "lodash";
import fs from "node:fs";
import path from "node:path";
import { pluginresources } from "../lib/path.js";

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
  "宝藏": { color: "👑", level: 6 }
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

function getRarityPoolByBaitQuality(quality) {
  const allRarities = ["垃圾", "普通", "精品", "稀有", "史诗", "传说", "宝藏"];
  
  switch (quality) {
    case 1:
      return { pool: ["垃圾", "普通", "精品", "宝藏"], weights: [48, 50, 1, 1] };
    case 2:
      return { pool: ["垃圾", "普通", "精品", "稀有", "宝藏"], weights: [23, 24, 50, 1, 2] };
    case 3:
      return { pool: ["垃圾", "普通", "精品", "稀有", "史诗", "宝藏"], weights: [11, 12, 23, 50, 1, 3] };
    case 4:
      return { pool: allRarities, weights: [5, 5, 12, 23, 50, 1, 4] };
    case 5:
      return { pool: allRarities, weights: [2, 3, 5, 12, 23, 50, 5] };
    case 6:
      return { pool: allRarities, weights: [1, 1, 3, 7, 13, 25, 50] };
    default:
      return { pool: ["垃圾", "普通", "精品", "宝藏"], weights: [48, 50, 1, 1] };
  }
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

function selectRandomFish(baitQuality, fishingManager = null, fisherId = null, currentPoolCount = -1) {
  if (fishingManager && fisherId) {
    const torpedoCount = fishingManager.getAvailableTorpedoCount(fisherId);
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
  
  let selectedRarity;
  
  if (currentPoolCount === 0 || currentPoolCount === 29) {
    selectedRarity = "宝藏";
  } else {
    const { pool, weights } = getRarityPoolByBaitQuality(baitQuality);
    selectedRarity = selectRarityByWeight(pool, weights);
  }
  
  let availableFish = getFishByRarity(selectedRarity);
  
  if (selectedRarity === "宝藏" && availableFish.length > 0) {
    const mimic = availableFish.find(f => f.id === "monster_mimic" || f.isMimic);
    if (mimic) {
      if (Math.random() < 0.2) {
        const [minWeight, maxWeight] = mimic.weight;
        const actualWeight = _.round(_.random(minWeight, maxWeight, true), 2);
        return {
          ...mimic,
          actualWeight,
          isMimic: true
        };
      }
      availableFish = availableFish.filter(f => f.id !== "monster_mimic" && !f.isMimic);
    }
  }
  
  
  const fish = availableFish[_.random(0, availableFish.length - 1)];
  
  const [minWeight, maxWeight] = fish.weight;
  const actualWeight = _.round(_.random(minWeight, maxWeight, true), 2);
  
  const isTreasure = fish.rarity === "宝藏" && fish.id !== "monster_mimic";
  
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

  startFishing = Command(/^#?钓鱼$/, async (e) => {
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

    const groupLockKey = `sakura:fishing:group_lock:${groupId}`;
    const lockTtl = await redis.ttl(groupLockKey);

    if (lockTtl > 0) {
      const unlockTime = new Date(Date.now() + lockTtl * 1000);
      const hours = String(unlockTime.getHours()).padStart(2, '0');
      const minutes = String(unlockTime.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      await e.reply(`😭 鱼塘里的鱼都被钓光啦！\n🐟 鱼苗正在紧急投放中，预计 ${timeStr} 恢复开放`, 10);
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

    const groupCountKey = `sakura:fishing:group_pool_count:${groupId}`;
    let currentPoolCount = await redis.get(groupCountKey);
    currentPoolCount = currentPoolCount ? parseInt(currentPoolCount) : 0;

    const selectedFish = selectRandomFish(baitQuality, fishingManager, userId, currentPoolCount);

    const luckyKey = `sakura:fishing:buff:lucky:${groupId}:${userId}`;
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
      const lineCapacity = lineConfig.capacity;
      
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
        
        let rodDamageMsg = "";
        let breakMsg = "";

        const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
        if (currentControl <= 20) {
          inventoryManager.removeItem(rodConfig.id, 1);
          fishingManager.clearEquippedRod(userId, rodConfig.id);
          breakMsg = `\n💥 鱼竿也断了！\n🎣 失去了【${rodConfig.name}】`;
        } else {
          fishingManager.damageRod(userId, rodConfig.id, 20);
          rodDamageMsg = getRodDamageInfo(fishingManager, userId, rodConfig, 20);
        }
        
        await e.reply([
          `💥💥💥 轰！！！\n`,
          `😱 钓到了`,
          segment.at(ownerId),
          `的鱼雷！\n`,
          `🧵 鱼线被炸断了！`,
          `${rodDamageMsg}${breakMsg}\n`,
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
        const lineCapacity = lineConfig.capacity;
        
        if (fishWeight > lineCapacity * 2) {
          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.increaseRodMastery(userId, rodConfig.id);
          
          let rodDamageMsg = "";
          let breakMsg = "";
          
          const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
          if (currentControl <= 20) {
            inventoryManager.removeItem(rodConfig.id, 1);
            fishingManager.clearEquippedRod(userId, rodConfig.id);
            breakMsg = `\n💥 鱼竿也断了！\n🎣 失去了【${rodConfig.name}】`;
          } else {
            fishingManager.damageRod(userId, rodConfig.id, 10);
            rodDamageMsg = getRodDamageInfo(fishingManager, userId, rodConfig, 10);
          }
          
          await e.reply([
            `🌊 巨大的力量传来！\n`,
            `😱 这到底是个什么庞然大物！？(${fishWeight})\n`,
            `💥 啪！鱼线瞬间崩断了！\n`,
            `🧵 【${lineConfig.name}】牺牲了...${rodDamageMsg}${breakMsg}`,
          ]);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }
        
        const successRate = 1 - (fishWeight - lineCapacity) / lineCapacity;
        const isSuccess = Math.random() < successRate;

        if (!isSuccess) {
          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);
          fishingManager.increaseRodMastery(userId, rodConfig.id);
          
          let rodDamageMsg2 = "";
          let breakMsg = "";
          
          const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
          if (currentControl <= 20) {
            inventoryManager.removeItem(rodConfig.id, 1);
            fishingManager.clearEquippedRod(userId, rodConfig.id);
            breakMsg = `\n💥 鱼竿也断了！\n🎣 失去了【${rodConfig.name}】`;
          } else {
            fishingManager.damageRod(userId, rodConfig.id, 5);
            rodDamageMsg2 = getRodDamageInfo(fishingManager, userId, rodConfig, 5);
          }
          
          await e.reply([
            `💥 崩！\n`,
            `😫 还是没能坚持住，鱼线断了...\n`,
            `👋 鱼大摇大摆地游走了(${fishWeight})\n`,
            `🧵 失去了【${lineConfig.name}】${rodDamageMsg2}${breakMsg}`,
          ]);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        const currentCtrl = fishingManager.getRodControl(userId, rodConfig.id);
        if (currentCtrl <= 20) {
          await e.reply([
            `⚡ 鱼线竟然没断！但是...\n`,
            `💥 咔嚓一声！鱼竿承受不住压力折断了！\n`,
            `😭 你的【${rodConfig.name}】...`,
          ]);
          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(rodConfig.id, 1);
          fishingManager.clearEquippedRod(userId, rodConfig.id);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }
        
        fishingManager.damageRod(userId, rodConfig.id, 5);
        const rodDamageMsg4 = getRodDamageInfo(fishingManager, userId, rodConfig, 5);
        await e.reply(`⚡ 鱼线紧绷！勉强撑住了！${rodDamageMsg4}`);
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
          const currentCtrl = fishingManager.getRodControl(userId, rodConfig.id);
          if (currentCtrl <= 20) {
            await e.reply([
              `💥 鱼竿断了！\n`,
              `🎣 失去了【${rodConfig.name}】\n`,
              `❌ 溜鱼失败... 鱼跑掉了`,
            ]);
            const inventoryManager = new InventoryManager(groupId, userId);
            inventoryManager.removeItem(rodConfig.id, 1);
            fishingManager.clearEquippedRod(userId, rodConfig.id);
            fishingManager.recordCatch(userId, 0, fish.id, false);
            
            this.finish("handleFishing", stateKey);
            if (state.cleanup) state.cleanup();
            await this.setCooldownAndIncrement(groupId, userId);
            return;
          }
          
          fishingManager.damageRod(userId, rodConfig.id, 1);
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

    const groupCountKey = `sakura:fishing:group_pool_count:${groupId}`;
    const groupLockKey = `sakura:fishing:group_lock:${groupId}`;

    const currentCount = await redis.incr(groupCountKey);

    if (currentCount === 1) {
      await redis.expire(groupCountKey, 48 * 60 * 60);
    }

    if (currentCount >= 30) {
      await redis.set(groupLockKey, "locked", "EX", 12 * 60 * 60);
      
      await redis.del(groupCountKey);
      
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
    
    if (fish.isMimic) {
      fishingManager.recordCatch(userId, 0, fish.id, true);
      fishingManager.increaseRodMastery(userId, rodConfig.id);
      
      const inventoryManager = new InventoryManager(groupId, userId);
      inventoryManager.removeItem(lineConfig.id, 1);
      fishingManager.clearEquippedLine(userId);
      
      let rodDamageMsg = "";
      let breakMsg = "";
      
      const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
      
      if (currentControl <= 20) {
        inventoryManager.removeItem(rodConfig.id, 1);
        fishingManager.clearEquippedRod(userId, rodConfig.id);
        breakMsg = `\n💥 鱼竿也断了！\n🎣 失去了【${rodConfig.name}】`;
      } else {
        fishingManager.damageRod(userId, rodConfig.id, 20);
        rodDamageMsg = getRodDamageInfo(fishingManager, userId, rodConfig, 20);
      }
      
      await e.reply([
        `🎉 成功拉上来了！\n`,
        `📦 咦？是个宝箱！\n`,
        `😱 等等...这个宝箱在动！\n`,
        `👹 是宝箱怪！！！\n`,
        segment.image(`file:///${fishImagePath}`),
        `💥 宝箱怪咬断了你的鱼线！`,
        `${rodDamageMsg}${breakMsg}`
      ]);
      
      await this.setCooldownAndIncrement(groupId, userId);
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
          `📈 熟练度：${newMastery}\n`,
          `🎒 已自动放入背包！\n`,
          `💡 发送「使用${fish.name}」来使用它！`,
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
    const finalPrice = Math.round(price * buffMultiplier);
    
    const economyManager = new EconomyManager(e);
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
    
    const resultMsg = [
      `🎉 钓到了【${fish.name}】！\n`,
      segment.image(`file:///${fishImagePath}`),
      `📝 ${fish.description}\n`,
      `📊 稀有度：${rarity.color}${fish.rarity}\n`,
      `⚖️ 重量：${fishWeight}\n`,
      `📈 熟练度：${newMastery}\n`,
      priceBoostMsg,
      buffMsg,
      `💰 价值：${finalPrice} 樱花币`,
    ];
    await e.reply(resultMsg);    
  }

  async getFishSellBuffMultiplier(groupId, userId) {
    let multiplier = 1;
    
    const doubleKey = `sakura:fishing:buff:double_coin:${groupId}:${userId}`;
    const hasDouble = await redis.get(doubleKey);
    if (hasDouble) {
      return 2;
    }
    
    const oneHalfKey = `sakura:fishing:buff:1_5_coin:${groupId}:${userId}`;
    const hasOneHalf = await redis.get(oneHalfKey);
    if (hasOneHalf) {
      return 1.5;
    }
    
    return multiplier;
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

  equipLine = Command(/^#?装备鱼线\s*(.+)$/, async (e) => {
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

  fishingRecord = Command(/^#?钓鱼记录(\s*.*)?$/, async (e) => {
    let msg = e.msg.replace(/^#?钓鱼记录/, "").trim();

    let targetId = e.user_id;
    let page = 1;

    const args = msg.split(/\s+/).filter(arg => arg);

    for (const arg of args) {
      if (/^\d+$/.test(arg)) {
        if (arg.length < 5) {
          page = Math.max(1, parseInt(arg));
        }
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
}
