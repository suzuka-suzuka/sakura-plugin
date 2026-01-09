import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../path.js";
import Setting from "../setting.js";
import InventoryManager from "./InventoryManager.js";

const fishingDataPath = path.join(plugindata, "economy", "fishing");

export default class FishingManager {
  constructor(groupId) {
    this.groupId = groupId;
    this.file = path.join(fishingDataPath, `${groupId}.json`);
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        return JSON.parse(fs.readFileSync(this.file, "utf8"));
      }
    } catch (err) {
      logger.error(`[FishingManager] 加载数据失败: ${err.message}`);
    }
    return {};
  }

  _save() {
    try {
      if (!fs.existsSync(fishingDataPath)) {
        fs.mkdirSync(fishingDataPath, { recursive: true });
      }
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      logger.error(`[FishingManager] 保存数据失败: ${err.message}`);
    }
  }

  _initUser(userId) {
    if (!this.data[userId]) {
      this.data[userId] = {
        rod: null,       // 当前装备的鱼竿ID
        bait: null,      // 当前装备的鱼饵ID
        totalCatch: 0,   // 总钓鱼次数
        totalEarnings: 0, // 总收益
        catchCounts: {},  // 钓到的鱼的统计 {targetUserId: count}
        rodCapacityLoss: {}, // 鱼竿承重损耗 {rodId: lossAmount}
        dangerousCreatureCounts: {}, // 钓到的危险生物统计 {creatureName: count}
        torpedoStats: {   // 鱼雷统计
          deployed: 0,      // 投放次数
          detonated: 0,     // 成功引爆次数
          hitByOthers: 0,   // 被别人钓到次数
          hitOthers: 0      // 钓到别人的雷次数
        }
      };
    }

    if (!this.data[userId].catchCounts) {
      this.data[userId].catchCounts = {};
    }
    if (!this.data[userId].rodCapacityLoss) {
      this.data[userId].rodCapacityLoss = {};
    }
    if (!this.data[userId].dangerousCreatureCounts) {
      this.data[userId].dangerousCreatureCounts = {};
    }
    if (!this.data[userId].torpedoStats) {
      this.data[userId].torpedoStats = {
        deployed: 0,
        detonated: 0,
        hitByOthers: 0,
        hitOthers: 0
      };
    }
    return this.data[userId];
  }

  // 获取所有鱼竿配置
  getAllRods() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.rods?.items || [];
  }

  // 获取所有鱼饵配置
  getAllBaits() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.baits?.items || [];
  }

  // 获取鱼竿配置
  getRodConfig(rodId) {
    return this.getAllRods().find(r => r.id === rodId);
  }

  // 获取鱼饵配置
  getBaitConfig(baitId) {
    return this.getAllBaits().find(b => b.id === baitId);
  }

  // 获取垃圾物品配置
  getTrashItems() {
    const config = Setting.getEconomy('fishing');
    return config?.trashItems || [];
  }

  // 获取危险生物配置
  getDangerousCreatures() {
    const config = Setting.getEconomy('fishing');
    return config?.dangerousCreatures || [];
  }

  // 获取用户钓鱼数据
  getUserData(userId) {
    return this._initUser(userId);
  }

  // 检查用户是否拥有鱼竿
  hasRod(userId, rodId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(rodId) > 0;
  }

  // 检查用户是否有任何鱼竿
  hasAnyRod(userId) {
    const allRods = this.getAllRods();
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    return allRods.some(rod => inventory[rod.id]);
  }

  // 购买鱼竿
  buyRod(userId, rodId) {
    return true;
  }

  // 装备鱼竿
  equipRod(userId, rodId) {
    if (this.hasRod(userId, rodId)) {
      const userData = this._initUser(userId);
      userData.rod = rodId;
      this._save();
      return true;
    }
    return false;
  }

  // 获取当前装备的鱼竿
  getEquippedRod(userId) {
    const userData = this._initUser(userId);
    if (userData.rod && !this.hasRod(userId, userData.rod)) {
        userData.rod = null;
        this._save();
    }
    return userData.rod;
  }

  // 清除装备的鱼竿
  clearEquippedRod(userId) {
    const userData = this._initUser(userId);
    userData.rod = null;
    this._save();
  }

  // 清除指定鱼竿的承重损耗记录
  clearRodCapacityLoss(userId, rodId) {
    const userData = this._initUser(userId);
    if (userData.rodCapacityLoss && userData.rodCapacityLoss[rodId]) {
      delete userData.rodCapacityLoss[rodId];
      this._save();
    }
  }

  // 获取鱼饵数量
  getBaitCount(userId, baitId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(baitId);
  }

  // 购买鱼饵
  buyBait(userId, baitId, count = 1) {
    return true;
  }

  // 装备鱼饵
  equipBait(userId, baitId) {
    if (this.getBaitCount(userId, baitId) > 0) {
      const userData = this._initUser(userId);
      userData.bait = baitId;
      this._save();
      return true;
    }
    return false;
  }

  // 获取当前装备的鱼饵
  getEquippedBait(userId) {
    const userData = this._initUser(userId);
    if (!userData.bait) return null;
    
    if (this.getBaitCount(userId, userData.bait) > 0) {
        return userData.bait;
    }
    
    userData.bait = null;
    this._save();
    return null;
  }

  // 消耗鱼饵
  consumeBait(userId) {
    const userData = this._initUser(userId);
    const baitId = userData.bait;
    if (baitId) {
      const inventoryManager = new InventoryManager(this.groupId, userId);
      if (inventoryManager.getItemCount(baitId) > 0) {
          inventoryManager.removeItem(baitId, 1);
          
          if (inventoryManager.getItemCount(baitId) <= 0) {
              userData.bait = null;
              // 尝试自动装备其他鱼饵（优先低等级/低价格）
              const inventory = inventoryManager.getInventory();
              const allBaits = this.getAllBaits();
              const availableBaits = allBaits
                  .filter(b => inventory[b.id] > 0)
                  .sort((a, b) => (a.price || 0) - (b.price || 0));
              if (availableBaits.length > 0) {
                  userData.bait = availableBaits[0].id;
              }
              this._save();
          }
          return true;
      }
    }
    return false;
  }

  // 记录钓鱼结果
  recordCatch(userId, earnings, targetUserId) {
    const userData = this._initUser(userId);
    userData.totalCatch++;
    userData.totalEarnings += earnings;
    
    if (targetUserId) {
      if (!userData.catchCounts[targetUserId]) {
        userData.catchCounts[targetUserId] = 0;
      }
      userData.catchCounts[targetUserId]++;
    }

    this._save();
  }

  // 记录危险生物捕获（传说之竿专用）
  recordDangerousCatch(userId, earnings, creatureName) {
    const userData = this._initUser(userId);
    if (!userData.dangerousCreatureCounts) {
      userData.dangerousCreatureCounts = {};
    }
    
    userData.totalCatch++;
    userData.totalEarnings += earnings;
    
    if (!userData.dangerousCreatureCounts[creatureName]) {
      userData.dangerousCreatureCounts[creatureName] = 0;
    }
    userData.dangerousCreatureCounts[creatureName]++;

    this._save();
  }

  // 获取针对特定用户的钓鱼排行
  getCatchRanking(targetUserId, limit = 10) {
    const ranking = [];
    for (const userId in this.data) {
      const userData = this.data[userId];
      if (userData.catchCounts && userData.catchCounts[targetUserId]) {
        ranking.push({
          userId: userId,
          count: userData.catchCounts[targetUserId]
        });
      }
    }
    return ranking.sort((a, b) => b.count - a.count).slice(0, limit);
  }

  // 获取针对特定目标的熟练度（钓鱼次数）
  getProficiency(userId, targetUserId) {
    const userData = this._initUser(userId);
    return userData.catchCounts?.[targetUserId] || 0;
  }

  // 获取钓鱼排行榜（按累计财富排序）
  getFishingRanking(limit = 10) {
    const ranking = [];
    for (const userId in this.data) {
      if (userId.startsWith('_')) continue; // 跳过特殊数据如_fishNames
      const userData = this.data[userId];
      if (userData.totalEarnings > 0 || userData.totalCatch > 0) {
        ranking.push({
          userId: userId,
          totalEarnings: userData.totalEarnings || 0,
          totalCatch: userData.totalCatch || 0
        });
      }
    }
    return ranking.sort((a, b) => b.totalEarnings - a.totalEarnings).slice(0, limit);
  }

  // 获取用户的钓鱼历史
  getUserCatchHistory(userId) {
    const userData = this._initUser(userId);
    const history = [];
    if (userData.catchCounts) {
      for (const targetId in userData.catchCounts) {
        history.push({
          targetUserId: targetId,
          count: userData.catchCounts[targetId],
          isDangerous: false
        });
      }
    }
    if (userData.dangerousCreatureCounts) {
      for (const creatureName in userData.dangerousCreatureCounts) {
        history.push({
          targetUserId: creatureName,
          count: userData.dangerousCreatureCounts[creatureName],
          isDangerous: true
        });
      }
    }
    return history.sort((a, b) => b.count - a.count);
  }

  // 获取用户拥有的所有鱼饵及数量
  getUserBaits(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    const allBaits = this.getAllBaits();
    const baits = {};
    allBaits.forEach(b => {
        if (inventory[b.id]) {
            baits[b.id] = inventory[b.id];
        }
    });
    return baits;
  }

  // 获取用户拥有的所有鱼竿
  getUserRods(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    const allRods = this.getAllRods();
    return allRods.filter(r => inventory[r.id]).map(r => r.id);
  }

  // 删除用户的鱼竿（被大型生物吞掉）
  removeEquippedRod(userId) {
    const userData = this._initUser(userId);
    const rodId = userData.rod;
    if (rodId) {
      const inventoryManager = new InventoryManager(this.groupId, userId);
      inventoryManager.removeItem(rodId, 1);
      
      // 清除该鱼竿的承重损耗记录
      if (userData.rodCapacityLoss && userData.rodCapacityLoss[rodId]) {
        delete userData.rodCapacityLoss[rodId];
      }
      
      userData.rod = null;
      // 尝试自动装备其他鱼竿（优先低等级/低价格）
      const inventory = inventoryManager.getInventory();
      const allRods = this.getAllRods();
      const availableRods = allRods
          .filter(r => inventory[r.id] > 0)
          .sort((a, b) => (a.price || 0) - (b.price || 0));
      if (availableRods.length > 0) {
        userData.rod = availableRods[0].id;
      }
      this._save();
      return rodId;
    }
    return null;
  }

  // 获取鱼竿当前实际承重（考虑损耗）
  getCurrentRodCapacity(userId) {
    const userData = this._initUser(userId);
    const rodId = userData.rod;
    if (!rodId) return 0;
    
    const rodConfig = this.getRodConfig(rodId);
    const baseCapacity = rodConfig?.capacity || 40;
    const loss = userData.rodCapacityLoss?.[rodId] || 0;
    
    return Math.max(0, baseCapacity - loss);
  }

  // 获取指定鱼竿的承重信息
  getRodCapacityInfo(userId, rodId) {
    const userData = this._initUser(userId);
    const rodConfig = this.getRodConfig(rodId);
    const baseCapacity = rodConfig?.capacity || 40;
    const loss = userData.rodCapacityLoss?.[rodId] || 0;
    const currentCapacity = Math.max(0, baseCapacity - loss);
    const percentage = currentCapacity / baseCapacity;
    
    return {
      baseCapacity,
      currentCapacity,
      loss,
      percentage
    };
  }

  // 减少鱼竿承重（遇到可怕生物时调用）
  reduceRodCapacity(userId, amount = 10) {
    const userData = this._initUser(userId);
    const rodId = userData.rod;
    if (!rodId) return { success: false };
    
    const rodConfig = this.getRodConfig(rodId);
    const baseCapacity = rodConfig?.capacity || 40;
    const currentLoss = userData.rodCapacityLoss[rodId] || 0;
    const newLoss = currentLoss + amount;
    
    userData.rodCapacityLoss[rodId] = newLoss;
    this._save();
    
    const newCapacity = Math.max(0, baseCapacity - newLoss);
    return {
      success: true,
      rodId,
      baseCapacity,
      currentCapacity: newCapacity,
      totalLoss: newLoss
    };
  }

  // ==================== 鱼命名功能 ====================

  // 给群成员命名鱼名
  setFishName(targetUserId, fishName, namerId) {
    if (!this.data._fishNames) {
      this.data._fishNames = {};
    }
    this.data._fishNames[String(targetUserId)] = {
      name: fishName,
      namerId: namerId,
      createdAt: Date.now()
    };
    this._save();
  }

  // 获取群成员的鱼名
  getFishName(targetUserId) {
    if (!this.data._fishNames) return null;
    return this.data._fishNames[String(targetUserId)] || null;
  }

  // ==================== 鱼雷功能 ====================

  // 初始化鱼雷池（附带自动清理过期鱼雷逻辑）
  _initTorpedoPool() {
    if (!this.data._torpedoPool) {
      this.data._torpedoPool = [];
    }

    // 每次初始化时检查并清理过期鱼雷
    const now = Date.now();
    // 鱼雷过期时间设定为 18 小时
    const expirationTime = 18 * 60 * 60 * 1000;
    
    const originalCount = this.data._torpedoPool.length;
    this.data._torpedoPool = this.data._torpedoPool.filter(t => {
      if (!t.deployTime) return true;
      return now - t.deployTime < expirationTime;
    });

    if (this.data._torpedoPool.length < originalCount) {
      this._save();
    }

    return this.data._torpedoPool;
  }

  // 投放鱼雷到鱼塘
  deployTorpedo(userId) {
    this._initTorpedoPool();
    const userData = this._initUser(userId);
    
    // 检查用户是否已有未引爆的鱼雷
    const existingTorpedo = this.data._torpedoPool.find(t => t.ownerId === String(userId));
    if (existingTorpedo) {
      return { success: false, reason: 'already_deployed' };
    }

    // 添加鱼雷到池中
    const torpedo = {
      ownerId: String(userId),
      deployTime: Date.now(),
      canDetonateTime: Date.now() + 12 * 60 * 60 * 1000 // 12小时后可引爆
    };
    this.data._torpedoPool.push(torpedo);
    
    // 更新用户统计
    userData.torpedoStats.deployed++;
    
    this._save();
    return { success: true, torpedo };
  }

  // 检查用户是否有已投放的鱼雷
  hasDeployedTorpedo(userId) {
    this._initTorpedoPool();
    return this.data._torpedoPool.some(t => t.ownerId === String(userId));
  }

  // 获取用户的鱼雷信息
  getUserTorpedo(userId) {
    this._initTorpedoPool();
    return this.data._torpedoPool.find(t => t.ownerId === String(userId)) || null;
  }

  // 检查鱼雷是否可以引爆
  canDetonateTorpedo(userId) {
    const torpedo = this.getUserTorpedo(userId);
    if (!torpedo) return { canDetonate: false, reason: 'no_torpedo' };
    
    const now = Date.now();
    if (now < torpedo.canDetonateTime) {
      const remainingMs = torpedo.canDetonateTime - now;
      const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
      const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      return { 
        canDetonate: false, 
        reason: 'not_ready', 
        remainingMs,
        remainingHours,
        remainingMinutes
      };
    }
    
    return { canDetonate: true, torpedo };
  }

  // 引爆鱼雷
  detonateTorpedo(userId) {
    const canResult = this.canDetonateTorpedo(userId);
    if (!canResult.canDetonate) {
      return { success: false, ...canResult };
    }
    
    const userData = this._initUser(userId);
    
    // 移除鱼雷
    this.data._torpedoPool = this.data._torpedoPool.filter(t => t.ownerId !== String(userId));
    
    // 更新用户统计
    userData.torpedoStats.detonated++;
    
    this._save();
    return { success: true };
  }

  // 检查钓鱼时是否会钓到鱼雷（排除自己的雷）
  checkTorpedoCatch(userId) {
    this._initTorpedoPool();
    
    // 过滤掉自己的鱼雷
    const availableTorpedos = this.data._torpedoPool.filter(t => t.ownerId !== String(userId));
    
    if (availableTorpedos.length === 0) {
      return { hasTorpedo: false };
    }
    
    return { 
      hasTorpedo: true, 
      count: availableTorpedos.length,
      torpedos: availableTorpedos 
    };
  }

  // 触发鱼雷（被别人钓到）
  triggerTorpedo(catcherUserId, torpedoOwnerId) {
    this._initTorpedoPool();
    
    const torpedoIndex = this.data._torpedoPool.findIndex(t => t.ownerId === String(torpedoOwnerId));
    if (torpedoIndex === -1) {
      return { success: false, reason: 'torpedo_not_found' };
    }
    
    // 移除被触发的鱼雷
    this.data._torpedoPool.splice(torpedoIndex, 1);
    
    // 更新统计
    const catcherData = this._initUser(catcherUserId);
    catcherData.torpedoStats.hitOthers++;
    
    const ownerData = this._initUser(torpedoOwnerId);
    ownerData.torpedoStats.hitByOthers++;
    
    this._save();
    return { success: true };
  }

  // 获取鱼塘中的鱼雷数量（不含自己的）
  getTorpedoCount(excludeUserId = null) {
    this._initTorpedoPool();
    if (excludeUserId) {
      return this.data._torpedoPool.filter(t => t.ownerId !== String(excludeUserId)).length;
    }
    return this.data._torpedoPool.length;
  }

  // 获取所有鱼雷信息（管理用）
  getAllTorpedos() {
    this._initTorpedoPool();
    return [...this.data._torpedoPool];
  }

  // 获取用户的鱼雷统计
  getTorpedoStats(userId) {
    const userData = this._initUser(userId);
    return userData.torpedoStats;
  }

  // 随机选择一个鱼雷（排除自己的）
  getRandomTorpedo(excludeUserId) {
    this._initTorpedoPool();
    const availableTorpedos = this.data._torpedoPool.filter(t => t.ownerId !== String(excludeUserId));
    if (availableTorpedos.length === 0) return null;
    return availableTorpedos[Math.floor(Math.random() * availableTorpedos.length)];
  }

  // 清理过期鱼雷（18小时未引爆且未被触发）
  cleanupExpiredTorpedos() {
    this._initTorpedoPool();
    const now = Date.now();
    const expirationTime = 18 * 60 * 60 * 1000;
    
    // 找出所有已过期的鱼雷
    const originalCount = this.data._torpedoPool.length;
    this.data._torpedoPool = this.data._torpedoPool.filter(t => {
      return t.deployTime && (now - t.deployTime < expirationTime);
    });
    
    const removedCount = originalCount - this.data._torpedoPool.length;
    
    if (removedCount > 0) {
      this._save();
    }
    
    return removedCount;
  }
}
