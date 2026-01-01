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
        rodCapacityLoss: {} // 鱼竿承重损耗 {rodId: lossAmount}
      };
    }

    if (!this.data[userId].catchCounts) {
      this.data[userId].catchCounts = {};
    }
    if (!this.data[userId].rodCapacityLoss) {
      this.data[userId].rodCapacityLoss = {};
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

  // 获取用户的钓鱼历史
  getUserCatchHistory(userId) {
    const userData = this._initUser(userId);
    const history = [];
    if (userData.catchCounts) {
      for (const targetId in userData.catchCounts) {
        history.push({
          targetUserId: targetId,
          count: userData.catchCounts[targetId]
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
}
