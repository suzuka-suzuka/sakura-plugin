import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../path.js";
import Setting from "../setting.js";

const fishingDataPath = path.join(plugindata, "economy", "fishing");
if (!fs.existsSync(fishingDataPath)) {
  fs.mkdirSync(fishingDataPath, { recursive: true });
}

export default class FishingManager {
  constructor(groupId) {
    this.groupId = groupId;
    this.file = path.join(fishingDataPath, `${groupId}.json`);
    this.data = this._load();
  }

  _load() {
    if (fs.existsSync(this.file)) {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    }
    return {};
  }

  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  _initUser(userId) {
    if (!this.data[userId]) {
      this.data[userId] = {
        rod: null,       // 当前装备的鱼竿ID
        bait: null,      // 当前装备的鱼饵ID
        baitCount: 0,    // 鱼饵数量
        rods: [],        // 拥有的鱼竿ID列表
        baits: {},       // 拥有的鱼饵 {baitId: count}
        totalCatch: 0,   // 总钓鱼次数
        totalEarnings: 0, // 总收益
        catchCounts: {}   // 钓到的鱼的统计 {targetUserId: count}
      };
    }
    if (!this.data[userId].catchCounts) {
      this.data[userId].catchCounts = {};
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
    const userData = this._initUser(userId);
    return userData.rods.includes(rodId);
  }

  // 检查用户是否有任何鱼竿
  hasAnyRod(userId) {
    const userData = this._initUser(userId);
    return userData.rods.length > 0;
  }

  // 购买鱼竿
  buyRod(userId, rodId) {
    const userData = this._initUser(userId);
    if (!userData.rods.includes(rodId)) {
      userData.rods.push(rodId);
      // 如果没有装备鱼竿，自动装备
      if (!userData.rod) {
        userData.rod = rodId;
      }
      this._save();
      return true;
    }
    return false;
  }

  // 装备鱼竿
  equipRod(userId, rodId) {
    const userData = this._initUser(userId);
    if (userData.rods.includes(rodId)) {
      userData.rod = rodId;
      this._save();
      return true;
    }
    return false;
  }

  // 获取当前装备的鱼竿
  getEquippedRod(userId) {
    const userData = this._initUser(userId);
    return userData.rod;
  }

  // 获取鱼饵数量
  getBaitCount(userId, baitId) {
    const userData = this._initUser(userId);
    return userData.baits[baitId] || 0;
  }

  // 购买鱼饵
  buyBait(userId, baitId, count = 1) {
    const userData = this._initUser(userId);
    if (!userData.baits[baitId]) {
      userData.baits[baitId] = 0;
    }
    userData.baits[baitId] += count;
    // 如果没有装备鱼饵，自动装备
    if (!userData.bait) {
      userData.bait = baitId;
    }
    this._save();
    return true;
  }

  // 装备鱼饵
  equipBait(userId, baitId) {
    const userData = this._initUser(userId);
    if (userData.baits[baitId] > 0) {
      userData.bait = baitId;
      this._save();
      return true;
    }
    return false;
  }

  // 获取当前装备的鱼饵
  getEquippedBait(userId) {
    const userData = this._initUser(userId);
    return userData.bait;
  }

  // 消耗鱼饵
  consumeBait(userId) {
    const userData = this._initUser(userId);
    const baitId = userData.bait;
    if (baitId && userData.baits[baitId] > 0) {
      userData.baits[baitId]--;
      // 如果鱼饵用完了，清除装备
      if (userData.baits[baitId] <= 0) {
        delete userData.baits[baitId];
        userData.bait = null;
        // 尝试自动装备其他鱼饵
        const otherBait = Object.keys(userData.baits).find(id => userData.baits[id] > 0);
        if (otherBait) {
          userData.bait = otherBait;
        }
      }
      this._save();
      return true;
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
    const userData = this._initUser(userId);
    return userData.baits;
  }

  // 获取用户拥有的所有鱼竿
  getUserRods(userId) {
    const userData = this._initUser(userId);
    return userData.rods;
  }

  // 删除用户的鱼竿（被大型生物吞掉）
  removeEquippedRod(userId) {
    const userData = this._initUser(userId);
    const rodId = userData.rod;
    if (rodId) {
      // 从拥有列表中删除
      const index = userData.rods.indexOf(rodId);
      if (index > -1) {
        userData.rods.splice(index, 1);
      }
      // 清除装备
      userData.rod = null;
      // 尝试自动装备其他鱼竿
      if (userData.rods.length > 0) {
        userData.rod = userData.rods[0];
      }
      this._save();
      return rodId;
    }
    return null;
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
