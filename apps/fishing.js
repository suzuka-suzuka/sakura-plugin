import EconomyManager from "../lib/economy/EconomyManager.js";
import FishingManager from "../lib/economy/FishingManager.js";
import FishingImageGenerator from "../lib/economy/FishingImageGenerator.js";
import InventoryManager from "../lib/economy/InventoryManager.js";
import _ from "lodash";
import fs from "node:fs";
import path from "node:path";
import { pluginroot } from "../lib/path.js";

const fishingState = {};

// 加载鱼类数据
let fishData = [];
try {
  const fishJsonPath = path.join(pluginroot, "resources", "fish", "fish.json");
  fishData = JSON.parse(fs.readFileSync(fishJsonPath, "utf8"));
} catch (err) {
  logger.error(`[钓鱼] 加载鱼类数据失败: ${err.message}`);
}

// 稀有度配置
const RARITY_CONFIG = {
  "垃圾": { color: "⚫", level: 0 },
  "普通": { color: "⚪", level: 1 },
  "精品": { color: "🟢", level: 2 },
  "稀有": { color: "🔵", level: 3 },
  "史诗": { color: "🟣", level: 4 },
  "传说": { color: "🟠", level: 5 }
};

// 根据鱼饵品质获取可钓稀有度
function getRarityPoolByBaitQuality(quality) {
  const allRarities = ["垃圾", "普通", "精品", "稀有", "史诗", "传说"];
  
  switch (quality) {
    case 1: // 只能钓垃圾和普通
      return { pool: ["垃圾", "普通"], weights: [50, 50] };
    case 2: // 50%精品，50%精品以下
      return { pool: ["垃圾", "普通", "精品"], weights: [25, 25, 50] };
    case 3: // 50%稀有，50%稀有以下
      return { pool: ["垃圾", "普通", "精品", "稀有"], weights: [12.5, 12.5, 25, 50] };
    case 4: // 50%史诗，50%史诗以下
      return { pool: ["垃圾", "普通", "精品", "稀有", "史诗"], weights: [6.25, 6.25, 12.5, 25, 50] };
    case 5: // 50%传说，50%传说以下
      return { pool: allRarities, weights: [3.125, 3.125, 6.25, 12.5, 25, 50] };
    default:
      return { pool: ["垃圾", "普通"], weights: [50, 50] };
  }
}

// 根据权重随机选择稀有度
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

// 根据稀有度获取可选鱼类（考虑当前时间）
function getFishByRarity(rarity) {
  const currentHour = new Date().getHours();
  
  return fishData.filter(fish => {
    if (fish.rarity !== rarity) return false;
    
    // 检查活跃时间
    if (fish.active_hours && fish.active_hours.length > 0) {
      return fish.active_hours.some(([start, end]) => {
        if (start <= end) {
          return currentHour >= start && currentHour < end;
        } else {
          // 跨午夜的时间段
          return currentHour >= start || currentHour < end;
        }
      });
    }
    return true;
  });
}

// 随机选择一条鱼并生成重量
function selectRandomFish(baitQuality) {
  const { pool, weights } = getRarityPoolByBaitQuality(baitQuality);
  const selectedRarity = selectRarityByWeight(pool, weights);
  
  let availableFish = getFishByRarity(selectedRarity);
  
  // 如果该稀有度没有可钓的鱼，降级到更低稀有度
  if (availableFish.length === 0) {
    const rarityIndex = pool.indexOf(selectedRarity);
    for (let i = rarityIndex - 1; i >= 0; i--) {
      availableFish = getFishByRarity(pool[i]);
      if (availableFish.length > 0) break;
    }
  }
  
  if (availableFish.length === 0) {
    // 实在没有就返回第一条垃圾
    availableFish = fishData.filter(f => f.rarity === "垃圾");
  }
  
  const fish = availableFish[_.random(0, availableFish.length - 1)];
  
  // 生成随机重量
  const [minWeight, maxWeight] = fish.weight;
  const actualWeight = _.round(_.random(minWeight, maxWeight, true), 2);
  
  return {
    ...fish,
    actualWeight
  };
}

// 计算鱼线承重失败率
function calculateLineFailRate(fishWeight, lineCapacity) {
  if (fishWeight <= lineCapacity) {
    return 0; // 不超重，不会失败
  }
  // 失败率 = (鱼重-鱼线承重) / 鱼线承重
  return Math.min(1, (fishWeight - lineCapacity) / lineCapacity);
}

// 计算鱼竿控制失败率
function calculateRodFailRate(fishDifficulty, rodControl) {
  if (rodControl >= fishDifficulty) {
    return 0; // 控制力足够，不会失败
  }
  // 失败率 = (困难度-控制力) / 100
  return Math.min(1, (fishDifficulty - rodControl) / 100);
}

// 计算鱼的价格
// 价格只和基础价格和重量有关
// 如果重量是最大值和最小值的平均值，价格就是基础价格
// 否则最大上下偏差50%的价格
function calculateFishPrice(fish) {
  const basePrice = fish.base_price || 0;
  const weight = fish.actualWeight;
  const [minWeight, maxWeight] = fish.weight || [weight, weight];
  const avgWeight = (minWeight + maxWeight) / 2;
  
  // 计算重量偏差比例，范围从 -1（最小重量）到 +1（最大重量）
  let weightRatio = 0;
  if (maxWeight !== minWeight) {
    weightRatio = (weight - avgWeight) / (maxWeight - minWeight) * 2;
  }
  
  // 价格偏差最大50%
  const priceMultiplier = 1 + (weightRatio * 0.5);
  
  return Math.round(basePrice * priceMultiplier);
}

// 获取鱼的图片路径
function getFishImagePath(fishId) {
  return path.join(pluginroot, "resources", "fish", "img", `${fishId}.png`);
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

    // 检查鱼竿
    if (!fishingManager.hasAnyRod(userId)) {
      await e.reply("🎣 手里空空如也！\n快去「商店」挑根鱼竿吧~", 10);
      return true;
    }

    // 检查鱼线
    if (!fishingManager.hasAnyLine(userId)) {
      await e.reply("🧵 还没有鱼线！\n快去「商店」买根鱼线吧~", 10);
      return true;
    }

    // 检查鱼饵
    const equippedBait = fishingManager.getEquippedBait(userId);
    if (!equippedBait) {
      await e.reply("🪱 鱼饵用光啦！\n没饵可钓不到鱼，去「商店」看看吧~", 10);
      return true;
    }

    // 检查群每日钓鱼次数限制
    const groupFishingKey = `sakura:fishing:group_daily:${groupId}`;
    const groupFishingCount = await redis.get(groupFishingKey);
    const currentCount = groupFishingCount ? parseInt(groupFishingCount) : 0;
    
    if (currentCount >= 50) {
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
    const equippedLineId = fishingManager.getEquippedLine(userId);
    const rodConfig = fishingManager.getRodConfig(equippedRodId);
    const lineConfig = fishingManager.getLineConfig(equippedLineId);
    const baitConfig = fishingManager.getBaitConfig(equippedBait);

    if (!rodConfig || !lineConfig || !baitConfig) {
      await e.reply("装备异常，请重新装备鱼竿、鱼线和鱼饵~", 10);
      return true;
    }

    // 消耗鱼饵
    fishingManager.consumeBait(userId);

    // 根据鱼饵品质选择一条鱼
    const baitQuality = baitConfig.quality || 1;
    const selectedFish = selectRandomFish(baitQuality);

    const waitTime = _.random(0, 3 * 60 * 1000);

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
      fish: selectedFish,
      rodConfig,
      lineConfig,
      baitConfig,
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

      // 鱼咬钩了，但不显示鱼的信息
      const fish = currentState.fish;
      const fishWeight = fish.actualWeight;
      const lineCapacity = lineConfig.capacity;
      
      currentState.phase = "weight_check";
      currentState.biteTime = Date.now();
      
      // 重量判定 - 不显示鱼的信息
      if (fishWeight > lineCapacity * 2) {
        // 重量超过2倍承重，直接断线
        await e.reply([
          `🌊 浮漂猛地沉下去了！`,
          `⚖️ 这条鱼太重了！远超鱼线承重！`,
          `💥 鱼线直接崩断了！`,
          `🧵 失去了【${lineConfig.name}】`,
        ], false, true);
        
        // 扣除鱼线和鱼竿控制力
        const inventoryManager = new InventoryManager(groupId, userId);
        inventoryManager.removeItem(lineConfig.id, 1);
        fishingManager.damageRod(userId, rodConfig.id, 10);
        fishingManager.clearEquippedLine(userId);
        
        // 检查鱼竿是否断裂
        await this.checkRodBreak(e, fishingManager, userId, rodConfig);
        
        cleanupState(stateKey);
        this.finish("handleFishing", stateKey);
        return;
      } else if (fishWeight > lineCapacity) {
        // 重量超过承重但不到2倍，让玩家选择
        await e.reply([
          `🌊 浮漂猛地沉下去了！`,
          `⚖️ 感觉这条鱼有点重，超过了鱼线承重！`,
          `⚠️ 强行收杆可能会断线并损耗鱼竿！`,
          `📝 30秒内回复「收杆」继续，「放弃」则放生`,
        ], false, true);
        
        currentState.isOverweight = true;
        this.setContext("handleFishing", stateKey, 30);
        
        currentState.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "weight_check") {
            cleanupState(stateKey);
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 犹豫太久了... 鱼挣脱跑掉了！`, false, true);
          }
        }, 30 * 1000);
      } else {
        // 重量在承重范围内，直接进入困难度判定
        await e.reply([
          `🌊 浮漂沉下去了！有鱼咬钩！`,
          `📝 30秒内回复「收杆」开始拉鱼！`,
        ], false, true);
        
        currentState.isOverweight = false;
        this.setContext("handleFishing", stateKey, 30);
        
        currentState.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "weight_check") {
            cleanupState(stateKey);
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 错过时机了... 鱼跑掉了！`, false, true);
          }
        }, 30 * 1000);
      }
    }, waitTime);

    return true;
  });

  // ==================== 多阶段钓鱼处理 ====================

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
    const fishWeight = fish.actualWeight;
    const lineCapacity = lineConfig.capacity;
    const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
    const fishDifficulty = fish.difficulty;

    // ===== 阶段1: 重量判定 =====
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

      // 清除确认计时器
      if (state.confirmTimer) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = null;
      }

      // 如果是超重的鱼，需要判定是否断线
      if (state.isOverweight) {
        const successRate = 1 - (fishWeight - lineCapacity) / lineCapacity;
        const isSuccess = Math.random() < successRate;

        if (!isSuccess) {
          // 断线失败
          await e.reply([
            `💥 鱼线崩断了！`,
            `❌ 鱼跑掉了...`,
            `🧵 失去了【${lineConfig.name}】`,
          ]);

          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.damageRod(userId, rodConfig.id, 5);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);
          
          // 检查鱼竿是否断裂
          await this.checkRodBreak(e, fishingManager, userId, rodConfig);

          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        // 通过重量判定但损耗控制力
        fishingManager.damageRod(userId, rodConfig.id, 5);
        
        // 检查鱼竿是否断裂
        const currentCtrl = fishingManager.getRodControl(userId, rodConfig.id);
        if (currentCtrl <= 0) {
          await e.reply([
            `⚡ 鱼线勉强撑住了！`,
            `💥 但是鱼竿断了！`,
            `🎣 失去了【${rodConfig.name}】`,
          ]);
          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(rodConfig.id, 1);
          fishingManager.clearEquippedRod(userId);
          fishingManager.clearRodDamage(userId, rodConfig.id);
          
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }
        
        await e.reply(`⚡ 鱼线紧绷！勉强撑住了！`);
      }

      // 进入困难度判定阶段
      state.phase = "difficulty_check";
      const updatedControl = fishingManager.getRodControl(userId, rodConfig.id);
      
      if (fishDifficulty > updatedControl) {
        // 困难度大于控制力，让玩家选择是否溜鱼
        await e.reply([
          `🎯 感觉这条鱼很难控制！`,
          `⚠️ 困难度超过了鱼竿控制力！`,
          `📝 30秒内选择：`,
          `  「强拉」- 直接计算概率`,
          `  「溜鱼」- 进入溜鱼小游戏`,
        ]);

        this.setContext("handleFishing", stateKey, 30);
        state.confirmTimer = setTimeout(() => {
          const s = fishingState[stateKey];
          if (s && s.phase === "difficulty_check") {
            cleanupState(stateKey);
            this.finish("handleFishing", stateKey);
            e.reply(`⏰ 犹豫太久... 鱼挣脱了！`, false, true);
          }
        }, 30 * 1000);
      } else {
        // 困难度在控制范围内，直接成功
        await this.finishSuccess(e, state, fishingManager);
      }
      return;
    }

    // ===== 阶段2: 困难度判定 =====
    if (state.phase === "difficulty_check") {
      if (state.confirmTimer) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = null;
      }

      if (/^强拉$/.test(msg)) {
        // 直接计算概率
        const updatedControl = fishingManager.getRodControl(userId, rodConfig.id);
        const successRate = Math.max(0, 1 - (fishDifficulty - updatedControl) / 100);
        const isSuccess = Math.random() < successRate;

        if (!isSuccess) {
          // 强拉失败，断线
          await e.reply([
            `💥 用力过猛！鱼线崩断了！`,
            `❌ 失败！成功率只有 ${(successRate * 100).toFixed(1)}%`,
            `🧵 失去了【${lineConfig.name}】`,
          ]);

          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);

          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        // 强拉成功
        await e.reply(`💪 强行拉了上来！成功率 ${(successRate * 100).toFixed(1)}%`);
        await this.finishSuccess(e, state, fishingManager);
        return;
      }

      if (/^溜鱼$/.test(msg)) {
        // 进入溜鱼小游戏
        state.phase = "fighting";
        state.distance = 50;  // 初始距离
        state.tension = 50;   // 初始张力
        state.fightingRounds = 0;
        
        await e.reply([
          `🎮 进入溜鱼模式！`,
          `📏 距离：${state.distance} (目标：<0)`,
          `⚡ 张力：${state.tension} (上限：100)`,
          `\n📝 发送指令：`,
          `  「拉」- 用力拉杆，减少距离但增加张力`,
          `  「溜」- 放松鱼线，减少张力但增加距离`,
          `\n⚠️ 张力>100或距离>100均失败！`,
        ]);

        this.setContext("handleFishing", stateKey, 300); // 5分钟超时
        return;
      }

      return;
    }

    // ===== 阶段3: 溜鱼小游戏 =====
    if (state.phase === "fighting") {
      const updatedControl = fishingManager.getRodControl(userId, rodConfig.id);
      
      if (/^拉$/.test(msg)) {
        // 拉：减少距离，增加张力
        state.fightingRounds++;
        
        // 根据鱼竿控制力和困难度计算效果
        const pullPower = Math.max(5, Math.floor(updatedControl / 10)); // 控制力越高拉得越多
        const fishResist = Math.max(3, Math.floor(fishDifficulty / 20)); // 困难度越高反抗越强
        
        const distanceChange = -(pullPower - fishResist);
        const tensionChange = Math.floor(fishDifficulty / 15) + _.random(3, 8);
        
        state.distance += distanceChange;
        state.tension += tensionChange;

        // 如果溜超重的鱼，每次拉都损耗控制力
        if (state.isOverweight) {
          fishingManager.damageRod(userId, rodConfig.id, 5);
          
          // 检查鱼竿是否断裂
          const currentCtrl = fishingManager.getRodControl(userId, rodConfig.id);
          if (currentCtrl <= 0) {
            await e.reply([
              `💥 鱼竿断了！`,
              `🎣 失去了【${rodConfig.name}】`,
              `❌ 溜鱼失败... 鱼跑掉了`,
            ]);
            const inventoryManager = new InventoryManager(groupId, userId);
            inventoryManager.removeItem(rodConfig.id, 1);
            fishingManager.clearEquippedRod(userId);
            fishingManager.clearRodDamage(userId, rodConfig.id);
            fishingManager.recordCatch(userId, 0, fish.id, false);
            
            this.finish("handleFishing", stateKey);
            if (state.cleanup) state.cleanup();
            await this.setCooldownAndIncrement(groupId, userId);
            return;
          }
        }

        if (state.tension > 100) {
          // 张力过大，失败
          await e.reply([
            `💥 鱼线崩断了！`,
            `⚡ 张力超过了100！`,
            `❌ 溜鱼失败！`,
            `🧵 失去了【${lineConfig.name}】`,
          ]);

          const inventoryManager = new InventoryManager(groupId, userId);
          inventoryManager.removeItem(lineConfig.id, 1);
          fishingManager.clearEquippedLine(userId);
          fishingManager.recordCatch(userId, 0, fish.id, false);

          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        if (state.distance < 0) {
          // 溜鱼成功
          await e.reply(`🎉 成功把鱼拉上来了！溜了 ${state.fightingRounds} 回合！`);
          await this.finishSuccess(e, state, fishingManager);
          return;
        }

        if (state.distance > 100) {
          // 距离太远，失败
          await e.reply([
            `🌊 鱼跑得太远了！`,
            `📏 距离超过了100！`,
            `❌ 溜鱼失败... 鱼逃走了`,
          ]);

          fishingManager.recordCatch(userId, 0, fish.id, false);
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        // 继续溜鱼
        const damageHint = state.isOverweight ? "\n⚠️ 鱼竿受损 -5 控制力" : "";
        await e.reply([
          `💪 用力一拉！`,
          `📏 距离：${state.distance}`,
          `⚡ 张力：${state.tension}${damageHint}`,
        ]);
        return;
      }

      if (/^溜$/.test(msg)) {
        // 溜：减少张力，增加距离
        state.fightingRounds++;
        
        const tensionRelease = _.random(8, 15);
        const fishEscape = Math.max(5, Math.floor(fishDifficulty / 15)) + _.random(2, 5);
        
        state.tension = Math.max(0, state.tension - tensionRelease);
        state.distance += fishEscape;

        if (state.distance > 100) {
          // 距离太远，失败
          await e.reply([
            `🌊 鱼跑得太远了！`,
            `📏 距离超过了100！`,
            `❌ 溜鱼失败... 鱼逃走了`,
          ]);

          fishingManager.recordCatch(userId, 0, fish.id, false);
          this.finish("handleFishing", stateKey);
          if (state.cleanup) state.cleanup();
          await this.setCooldownAndIncrement(groupId, userId);
          return;
        }

        // 继续溜鱼
        await e.reply([
          `🌊 放松鱼线...`,
          `📏 距离：${state.distance}`,
          `⚡ 张力：${state.tension}`,
        ]);
        return;
      }

      return;
    }
  }

  // 设置冷却并增加计数
  async setCooldownAndIncrement(groupId, userId) {
    // 设置冷却
    const cooldownKey = `sakura:fishing:cooldown:${groupId}:${userId}`;
    await redis.set(
      cooldownKey,
      String(Math.floor(Date.now() / 1000)),
      "EX",
      300 // 5分钟冷却
    );

    // 增加群钓鱼计数
    const groupFishingKey = `sakura:fishing:group_daily:${groupId}`;
    const now = new Date();
    const nextReset = new Date(now);
    if (now.getHours() >= 4) {
      nextReset.setDate(nextReset.getDate() + 1);
    }
    nextReset.setHours(4, 0, 0, 0);
    const secondsUntilReset = Math.floor((nextReset - now) / 1000);
    await redis.incr(groupFishingKey);
    await redis.expire(groupFishingKey, secondsUntilReset);
  }

  // 钓鱼成功的统一处理
  async finishSuccess(e, state, fishingManager) {
    const groupId = e.group_id;
    const userId = e.user_id;
    const { fish, rodConfig, lineConfig } = state;
    
    // 清理状态
    this.finish("handleFishing", `${groupId}:${userId}`);
    if (state.cleanup) state.cleanup();

    const rarity = RARITY_CONFIG[fish.rarity] || { color: "⚪", level: 0 };
    const fishWeight = fish.actualWeight;
    const fishDifficulty = fish.difficulty;
    
    // 钓鱼成功
    const price = calculateFishPrice(fish);
    
    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, price);
    fishingManager.recordCatch(userId, price, fish.id, true);

    // 设置冷却和计数
    await this.setCooldownAndIncrement(groupId, userId);

    // 获取鱼的图片
    const fishImagePath = getFishImagePath(fish.id);
    const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
    const maxControl = rodConfig.control;
    const controlInfo = currentControl < maxControl ? `\n🔧 鱼竿当前控制力：${currentControl}/${maxControl}` : "";
    
    // 尝试发送图片，失败则发送文字


        const resultMsg = [
          segment.image(`file:///${fishImagePath}`),
          `🎉 钓鱼成功！\n`,
          `🐟 钓到了${rarity.color}【${fish.name}】！\n`,
          `📝 ${fish.description}\n`,
          `📊 稀有度：${rarity.color}${fish.rarity}\n`,
          `⚖️ 重量：${fishWeight}斤\n`,
          `🎯 困难度：${fishDifficulty}\n`,
          `💰 获得：${price} 樱花币${controlInfo}`,
        ];
        await e.reply(resultMsg);
  
     
  }

  // 检查鱼竿是否断裂
  async checkRodBreak(e, fishingManager, userId, rodConfig) {
    const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
    if (currentControl <= 0) {
      await e.reply([
        `💥 鱼竿也断了！`,
        `🎣 失去了【${rodConfig.name}】`,
      ]);
      const inventoryManager = new InventoryManager(e.group_id, userId);
      inventoryManager.removeItem(rodConfig.id, 1);
      fishingManager.clearEquippedRod(userId);
      fishingManager.clearRodDamage(userId, rodConfig.id);
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

    // 鱼竿没有耐久度了，直接按80%原价出售
    const sellPrice = Math.round(rod.price * 0.8);

    const economyManager = new EconomyManager(e);
    economyManager.addCoins(e, sellPrice);

    // 修改回复文案，去掉计算公式，直接显示全额退款
    await e.reply(
      `💰 成功出售【${rod.name}】！\n💵 原价 ${rod.price} × 80% = ${sellPrice} 樱花币`
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
    await e.reply(`🧵 鱼线换好啦！当前使用【${line.name}】，承重 ${line.capacity} 斤。`);
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

    // 将鱼类ID映射到鱼类名称
    for (const item of history) {
      const fishInfo = fishData.find(f => f.id === item.fishId);
      if (fishInfo) {
        const rarity = RARITY_CONFIG[fishInfo.rarity] || { color: "⚪" };
        item.name = `${rarity.color} ${fishInfo.name}`;
        item.rarity = fishInfo.rarity;
      } else {
        item.name = item.fishId || "未知鱼类";
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
      // 文字版钓鱼记录
      let recordMsg = `🎣 【${targetName}】的钓鱼记录\n`;
      recordMsg += `━━━━━━━━━━━━━━━\n`;
      recordMsg += `📊 总钓鱼次数：${userData.totalCatch || 0}\n`;
      recordMsg += `💰 总收益：${userData.totalEarnings || 0} 樱花币\n`;
      recordMsg += `━━━━━━━━━━━━━━━\n`;
      recordMsg += `🐟 钓到的鱼类：\n`;
      history.slice(0, 10).forEach(item => {
        recordMsg += `  ${item.name} × ${item.count}\n`;
      });
      await e.reply(recordMsg);
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
      // 文字版排行榜
      let rankMsg = "🎣 钓鱼排行榜\n━━━━━━━━━━━━━━━\n";
      list.forEach(item => {
        rankMsg += `${item.rank}. ${item.nickname}\n   💰 ${item.totalEarnings} 樱花币 | 🐟 ${item.totalCatch} 条\n`;
      });
      await e.reply(rankMsg);
    }
    return true;
  });

  // 查看钓鱼装备状态
  fishingStatus = Command(/^#?(钓鱼状态|钓具状态|装备状态)$/, async (e) => {
    const fishingManager = new FishingManager(e.group_id);
    const userId = e.user_id;

    const equippedRodId = fishingManager.getEquippedRod(userId);
    const equippedLineId = fishingManager.getEquippedLine(userId);
    const equippedBaitId = fishingManager.getEquippedBait(userId);

    const rodConfig = equippedRodId ? fishingManager.getRodConfig(equippedRodId) : null;
    const lineConfig = equippedLineId ? fishingManager.getLineConfig(equippedLineId) : null;
    const baitConfig = equippedBaitId ? fishingManager.getBaitConfig(equippedBaitId) : null;

    let statusMsg = "🎣 你的钓鱼装备状态\n━━━━━━━━━━━━━━━\n";
    
    if (rodConfig) {
      const currentControl = fishingManager.getRodControl(userId, rodConfig.id);
      const maxControl = rodConfig.control;
      const damage = maxControl - currentControl;
      
      statusMsg += `🎣 鱼竿：【${rodConfig.name}】\n   控制力：${currentControl}/${maxControl}`;
      
      if (damage > 0) {
        statusMsg += ` ⚠️ 已损耗 ${damage}`;
      }
      statusMsg += "\n";
    } else {
      statusMsg += `🎣 鱼竿：未装备\n`;
    }

    if (lineConfig) {
      statusMsg += `🧵 鱼线：【${lineConfig.name}】\n   承重：${lineConfig.capacity} 斤\n`;
    } else {
      statusMsg += `🧵 鱼线：未装备\n`;
    }

    if (baitConfig) {
      const baitCount = fishingManager.getBaitCount(userId, equippedBaitId);
      statusMsg += `🪱 鱼饵：【${baitConfig.name}】\n   品质：${baitConfig.quality}级 | 库存：${baitCount}\n`;
    } else {
      statusMsg += `🪱 鱼饵：未装备\n`;
    }

    statusMsg += `━━━━━━━━━━━━━━━\n`;
    statusMsg += `💡 提示：鱼竿控制力决定能否钓难度高的鱼\n`;
    statusMsg += `💡 鱼线承重决定能否钓重量大的鱼\n`;
    statusMsg += `💡 鱼饵品质决定钓到稀有鱼的概率\n`;
    statusMsg += `⚠️ 鱼竿控制力归零时会断裂！`;

    await e.reply(statusMsg);
    return true;
  });
}
