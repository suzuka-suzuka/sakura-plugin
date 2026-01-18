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
        rod: null,
        line: null,
        bait: null,
        totalCatch: 0,
        totalEarnings: 0,
        fishCounts: {},
        rodDamage: {},
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

  getRodControl(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return 0;
    
    const userData = this._initUser(userId);
    const damage = userData.rodDamage[rodId] || 0;
    return Math.max(0, rodConfig.control - damage);
  }

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

  damageRod(userId, rodId, damage) {
    const userData = this._initUser(userId);
    if (!userData.rodDamage[rodId]) {
      userData.rodDamage[rodId] = 0;
    }
    userData.rodDamage[rodId] += damage;
    this._save();
  }

  clearRodDamage(userId, rodId) {
    const userData = this._initUser(userId);
    if (userData.rodDamage[rodId]) {
      delete userData.rodDamage[rodId];
      this._save();
    }
  }

  getAllRods() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.rods?.items || [];
  }

  getAllLines() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.lines?.items || [];
  }

  getAllBaits() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.baits?.items || [];
  }

  getRodConfig(rodId) {
    return this.getAllRods().find(r => r.id === rodId);
  }

  getLineConfig(lineId) {
    return this.getAllLines().find(l => l.id === lineId);
  }

  getBaitConfig(baitId) {
    return this.getAllBaits().find(b => b.id === baitId);
  }

  getUserData(userId) {
    return this._initUser(userId);
  }

  hasRod(userId, rodId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(rodId) > 0;
  }

  hasAnyRod(userId) {
    const allRods = this.getAllRods();
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    return allRods.some(rod => inventory[rod.id]);
  }

  hasLine(userId, lineId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(lineId) > 0;
  }

  hasAnyLine(userId) {
    const allLines = this.getAllLines();
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    return allLines.some(line => inventory[line.id]);
  }

  equipRod(userId, rodId) {
    if (this.hasRod(userId, rodId)) {
      const userData = this._initUser(userId);
      userData.rod = rodId;
      this._save();
      return true;
    }
    return false;
  }

  getEquippedRod(userId) {
    const userData = this._initUser(userId);
    if (userData.rod && !this.hasRod(userId, userData.rod)) {
        userData.rod = null;
        this._save();
    }
    return userData.rod;
  }

  clearEquippedRod(userId) {
    const userData = this._initUser(userId);
    userData.rod = null;
    this._save();
  }

  equipLine(userId, lineId) {
    if (this.hasLine(userId, lineId)) {
      const userData = this._initUser(userId);
      userData.line = lineId;
      this._save();
      return true;
    }
    return false;
  }

  getEquippedLine(userId) {
    const userData = this._initUser(userId);
    if (userData.line && !this.hasLine(userId, userData.line)) {
        userData.line = null;
        this._save();
    }
    return userData.line;
  }

  clearEquippedLine(userId) {
    const userData = this._initUser(userId);
    userData.line = null;
    this._save();
  }

  getBaitCount(userId, baitId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(baitId);
  }

  equipBait(userId, baitId) {
    if (this.getBaitCount(userId, baitId) > 0) {
      const userData = this._initUser(userId);
      userData.bait = baitId;
      this._save();
      return true;
    }
    return false;
  }

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

  consumeBait(userId) {
    const userData = this._initUser(userId);
    const baitId = userData.bait;
    if (baitId) {
      const inventoryManager = new InventoryManager(this.groupId, userId);
      if (inventoryManager.getItemCount(baitId) > 0) {
          inventoryManager.removeItem(baitId, 1);
          
          if (inventoryManager.getItemCount(baitId) <= 0) {
              userData.bait = null;
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

  getFishingRanking(limit = 10) {
    const ranking = [];
    for (const userId in this.data) {
      if (userId.startsWith('_')) continue;
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

  getUserRods(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    const allRods = this.getAllRods();
    return allRods.filter(r => inventory[r.id]).map(r => r.id);
  }

  getUserLines(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    const allLines = this.getAllLines();
    return allLines.filter(l => inventory[l.id]).map(l => l.id);
  }
}
