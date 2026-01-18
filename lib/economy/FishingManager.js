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
        line: null,      // 当前装备的鱼线ID
        bait: null,      // 当前装备的鱼饵ID
        totalCatch: 0,   // 总钓鱼次数
        totalEarnings: 0, // 总收益
        fishCounts: {},  // 钓到的鱼的统计 {fishId: {count, successCount}}
        rodDamage: {},   // 鱼竿控制力损耗 {rodId: damage}
      };
    }

    if (!this.data[userId].fishCounts) {
      this.data[userId].fishCounts = {};
    }
    if (!this.data[userId].line) {
      this.data[userId].line = null;
    }
    if (!this.data[userId].rodDamage) {
      this.data[userId].rodDamage = {};
    }
    return this.data[userId];
  }

  // 获取鱼竿当前控制力（考虑损耗）
  getRodControl(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return 0;
    
    const userData = this._initUser(userId);
    const damage = userData.rodDamage[rodId] || 0;
    return Math.max(0, rodConfig.control - damage);
  }

  // 获取鱼竿损耗信息
  getRodCapacityInfo(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return { loss: 0, currentCapacity: 0 };
    
    const userData = this._initUser(userId);
    const damage = userData.rodDamage[rodId] || 0;
    
    return {
      loss: damage,
      currentCapacity: Math.max(0, rodConfig.control - damage)
    };
  }

  // 损耗鱼竿控制力
  damageRod(userId, rodId, damage) {
    const userData = this._initUser(userId);
    if (!userData.rodDamage[rodId]) {
      userData.rodDamage[rodId] = 0;
    }
    userData.rodDamage[rodId] += damage;
    this._save();
  }

  // 清除鱼竿损耗记录（鱼竿断裂时调用）
  clearRodDamage(userId, rodId) {
    const userData = this._initUser(userId);
    if (userData.rodDamage[rodId]) {
      delete userData.rodDamage[rodId];
      this._save();
    }
  }

  // 获取所有鱼竿配置
  getAllRods() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.rods?.items || [];
  }

  // 获取所有鱼线配置
  getAllLines() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.lines?.items || [];
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

  // 获取鱼线配置
  getLineConfig(lineId) {
    return this.getAllLines().find(l => l.id === lineId);
  }

  // 获取鱼饵配置
  getBaitConfig(baitId) {
    return this.getAllBaits().find(b => b.id === baitId);
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

  // 检查用户是否拥有鱼线
  hasLine(userId, lineId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(lineId) > 0;
  }

  // 检查用户是否有任何鱼线
  hasAnyLine(userId) {
    const allLines = this.getAllLines();
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    return allLines.some(line => inventory[line.id]);
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

  // 装备鱼线
  equipLine(userId, lineId) {
    if (this.hasLine(userId, lineId)) {
      const userData = this._initUser(userId);
      userData.line = lineId;
      this._save();
      return true;
    }
    return false;
  }

  // 获取当前装备的鱼线
  getEquippedLine(userId) {
    const userData = this._initUser(userId);
    if (userData.line && !this.hasLine(userId, userData.line)) {
        userData.line = null;
        this._save();
    }
    return userData.line;
  }

  // 清除装备的鱼线
  clearEquippedLine(userId) {
    const userData = this._initUser(userId);
    userData.line = null;
    this._save();
  }

  // 获取鱼饵数量
  getBaitCount(userId, baitId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(baitId);
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
  recordCatch(userId, earnings, fishId, isSuccess = true) {
    const userData = this._initUser(userId);
    userData.totalCatch++;
    userData.totalEarnings += earnings;
    
    if (fishId) {
      if (!userData.fishCounts) {
        userData.fishCounts = {};
      }
      if (!userData.fishCounts[fishId]) {
        userData.fishCounts[fishId] = { count: 0, successCount: 0 };
      }
      userData.fishCounts[fishId].count++;
      if (isSuccess) {
        userData.fishCounts[fishId].successCount++;
      }
    }

    this._save();
  }

  // 获取钓鱼排行榜（按累计财富排序）
  getFishingRanking(limit = 10) {
    const ranking = [];
    for (const userId in this.data) {
      if (userId.startsWith('_')) continue; // 跳过特殊数据
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
    if (userData.fishCounts) {
      for (const fishId in userData.fishCounts) {
        const fishData = userData.fishCounts[fishId];
        history.push({
          fishId: fishId,
          count: fishData.count || 0,
          successCount: fishData.successCount || 0
        });
      }
    }
    return history.sort((a, b) => b.successCount - a.successCount);
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

  // 获取用户拥有的所有鱼线
  getUserLines(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    const allLines = this.getAllLines();
    return allLines.filter(l => inventory[l.id]).map(l => l.id);
  }
}
