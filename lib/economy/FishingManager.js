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
        torpedoHits: 0,
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
    if (!this.data[userId].rodMastery) {
      this.data[userId].rodMastery = {};
    }
    if (this.data[userId].torpedoHits === undefined) {
      this.data[userId].torpedoHits = 0;
    }
    // 职业系统初始化
    if (!this.data[userId].profession) {
      this.data[userId].profession = null; // 职业类型: treasure_hunter, fishing_master, merchant
    }
    if (this.data[userId].professionLevel === undefined) {
      this.data[userId].professionLevel = 0; // 职业等级: 0=无, 1=一级, 2=二级
    }
    return this.data[userId];
  }

  // ==================== 职业系统 ====================

  // 获取职业配置文件
  static getProfessionYaml() {
    return Setting.getEconomy('profession') || {};
  }

  // 获取解锁条件配置
  static getUnlockRequirements() {
    const yaml = FishingManager.getProfessionYaml();
    return yaml.unlock_requirements || { level_1: 60, level_2: 120 };
  }

  // 获取职业配置
  static getProfessionConfig(professionId) {
    const yaml = FishingManager.getProfessionYaml();
    const professions = yaml.professions || {};
    return professions[professionId] || null;
  }

  // 获取所有职业列表
  static getAllProfessions() {
    const yaml = FishingManager.getProfessionYaml();
    const professions = yaml.professions || {};
    return Object.keys(professions).map(id => ({
      id,
      ...professions[id]
    }));
  }

  // 获取用户职业信息（包含称号）
  getUserProfession(userId) {
    const userData = this._initUser(userId);
    const professionId = userData.profession;
    const level = userData.professionLevel || 0;
    
    let title = null;
    if (professionId && level > 0) {
      const config = FishingManager.getProfessionConfig(professionId);
      if (config && config.levels && config.levels[level]) {
        title = config.levels[level].title;
      }
    }
    
    return {
      profession: professionId,
      level: level,
      title: title
    };
  }

  // 检查用户是否可以选择职业
  canChooseProfession(userId) {
    const userData = this._initUser(userId);
    const requirements = FishingManager.getUnlockRequirements();
    return userData.totalCatch >= requirements.level_1 && !userData.profession;
  }

  // 检查用户是否可以进阶职业
  canAdvanceProfession(userId) {
    const userData = this._initUser(userId);
    const requirements = FishingManager.getUnlockRequirements();
    return userData.totalCatch >= requirements.level_2 && 
           userData.profession && 
           userData.professionLevel === 1;
  }

  // 选择职业
  chooseProfession(userId, professionId) {
    const userData = this._initUser(userId);
    const requirements = FishingManager.getUnlockRequirements();
    
    // 检查是否已有职业
    if (userData.profession) {
      return { success: false, msg: "你已经有职业了，无法再选择其他职业！" };
    }
    
    // 检查钓鱼次数
    if (userData.totalCatch < requirements.level_1) {
      return { success: false, msg: `钓鱼次数不足！需要${requirements.level_1}次，当前${userData.totalCatch}次` };
    }
    
    // 检查职业是否存在
    const professionConfig = FishingManager.getProfessionConfig(professionId);
    if (!professionConfig) {
      return { success: false, msg: "无效的职业！" };
    }
    
    userData.profession = professionId;
    userData.professionLevel = 1;
    this._save();
    
    const levelConfig = professionConfig.levels[1];
    
    return { 
      success: true, 
      msg: `成功选择职业【${professionConfig.icon}${professionConfig.name}】！`,
      profession: professionConfig,
      title: levelConfig.title
    };
  }

  // 进阶职业
  advanceProfession(userId) {
    const userData = this._initUser(userId);
    const requirements = FishingManager.getUnlockRequirements();
    
    // 检查是否有职业
    if (!userData.profession) {
      return { success: false, msg: "你还没有职业，请先选择一个职业！" };
    }
    
    // 检查是否已经满级
    if (userData.professionLevel >= 2) {
      return { success: false, msg: "你的职业已经达到最高等级！" };
    }
    
    // 检查钓鱼次数
    if (userData.totalCatch < requirements.level_2) {
      return { success: false, msg: `钓鱼次数不足！进阶需要${requirements.level_2}次，当前${userData.totalCatch}次` };
    }
    
    const professionConfig = FishingManager.getProfessionConfig(userData.profession);
    userData.professionLevel = 2;
    this._save();
    
    const levelConfig = professionConfig.levels[2];
    
    return { 
      success: true, 
      msg: `职业【${professionConfig.icon}${professionConfig.name}】进阶成功！现在是【${levelConfig.title}】！`,
      profession: professionConfig,
      title: levelConfig.title
    };
  }

  // 获取宝藏猎人加成 (返回额外的宝藏权重)
  getTreasureBonus(userId) {
    const userData = this._initUser(userId);
    if (userData.profession !== 'treasure_hunter' || userData.professionLevel <= 0) {
      return 0;
    }
    const config = FishingManager.getProfessionConfig('treasure_hunter');
    if (!config || !config.levels || !config.levels[userData.professionLevel]) {
      return 0;
    }
    return config.levels[userData.professionLevel].treasure_bonus || 0;
  }

  // 获取钓鱼大师加成 (返回鱼线承重加成值)
  getLineBonusFromMastery(userId, rodId) {
    const userData = this._initUser(userId);
    if (userData.profession !== 'fishing_master' || userData.professionLevel <= 0) {
      return 0;
    }
    const mastery = this.getRodMastery(userId, rodId);
    const config = FishingManager.getProfessionConfig('fishing_master');
    if (!config || !config.levels || !config.levels[userData.professionLevel]) {
      return 0;
    }
    const multiplier = config.levels[userData.professionLevel].mastery_multiplier || 0;
    return Math.floor(mastery * multiplier);
  }

  // 获取商人加成 (返回金币收益倍率，如 1.15 或 1.30)
  getMerchantCoinMultiplier(userId) {
    const userData = this._initUser(userId);
    if (userData.profession !== 'merchant' || userData.professionLevel <= 0) {
      return 1;
    }
    const config = FishingManager.getProfessionConfig('merchant');
    if (!config || !config.levels || !config.levels[userData.professionLevel]) {
      return 1;
    }
    const bonus = config.levels[userData.professionLevel].coin_bonus || 0;
    return 1 + bonus;
  }

  getRodControl(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return 0;
    
    const userData = this._initUser(userId);
    const damage = userData.rodDamage[rodId] || 0;
    return Math.max(0, rodConfig.control - damage);
  }

  getRodDurabilityInfo(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return { damage: 0, currentControl: 0, maxControl: 0 };
    
    const userData = this._initUser(userId);
    const damage = userData.rodDamage[rodId] || 0;
    
    return {
      damage,
      currentControl: Math.max(0, rodConfig.control - damage),
      maxControl: rodConfig.control
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

  getRodMastery(userId, rodId) {
    const userData = this._initUser(userId);
    return userData.rodMastery[rodId] || 0;
  }

  increaseRodMastery(userId, rodId) {
    const userData = this._initUser(userId);
    if (!userData.rodMastery[rodId]) {
      userData.rodMastery[rodId] = 0;
    }
    userData.rodMastery[rodId] += 1;
    this._save();
  }

  clearRodMastery(userId, rodId) {
    const userData = this._initUser(userId);
    if (userData.rodMastery[rodId]) {
      delete userData.rodMastery[rodId];
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

  recordTorpedoHit(userId) {
    const userData = this._initUser(userId);
    userData.torpedoHits = (userData.torpedoHits || 0) + 1;
    this._save();
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

  clearEquippedRod(userId, rodId = null) {
    const userData = this._initUser(userId);
    const targetRodId = rodId || userData.rod;
    
    if (targetRodId) {
      if (userData.rodDamage && userData.rodDamage[targetRodId]) {
        delete userData.rodDamage[targetRodId];
      }
      if (userData.rodMastery && userData.rodMastery[targetRodId]) {
        delete userData.rodMastery[targetRodId];
      }
      
      if (!rodId || userData.rod === rodId) {
        userData.rod = null;
      }
    }
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

  getUserBaits(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    const inventory = inventoryManager.getInventory();
    const allBaits = this.getAllBaits();
    const userBaits = {};
    for (const bait of allBaits) {
        if (inventory[bait.id]) {
            userBaits[bait.id] = inventory[bait.id];
        }
    }
    return userBaits;
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

  getTorpedoConfig() {
    const shopConfig = Setting.getEconomy('shop');
    return shopConfig?.categories?.torpedoes?.items?.find(t => t.id === 'torpedo');
  }

  getPondTorpedoes() {
    if (!this.data._pondTorpedoes) {
      this.data._pondTorpedoes = {};
    }
    return this.data._pondTorpedoes;
  }

  getUserTorpedoCount(userId) {
    const torpedoes = this.getPondTorpedoes();
    return torpedoes[userId] ? 1 : 0;
  }

  getTotalTorpedoCount() {
    const torpedoes = this.getPondTorpedoes();
    return Object.keys(torpedoes).length;
  }

  deployTorpedo(userId) {
    const torpedoes = this.getPondTorpedoes();
    if (torpedoes[userId]) {
      return { success: false, msg: "你在鱼塘中已有一个鱼雷了！" };
    }
    torpedoes[userId] = Date.now();
    this._save();
    return { success: true, msg: "鱼雷投放成功！" };
  }

  getAvailableTorpedoCount(excludeUserId) {
    const torpedoes = this.getPondTorpedoes();
    return Object.keys(torpedoes).filter(uid => uid !== String(excludeUserId)).length;
  }

  triggerTorpedo(fisherId) {
    const torpedoes = this.getPondTorpedoes();
    const userIds = Object.keys(torpedoes).filter(uid => uid !== String(fisherId));
    if (userIds.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * userIds.length);
    const ownerId = userIds[randomIndex];
    delete torpedoes[ownerId];
    this._save();
    return ownerId;
  }

  async setFishPriceBoost() {
    const key = `sakura:fishing:torpedo_explosion:${this.groupId}`;
    const oneHour = 60 * 60;
    await redis.set(key, String(Date.now()), "EX", oneHour);
  }

  async isFishPriceBoostActive() {
    const key = `sakura:fishing:torpedo_explosion:${this.groupId}`;
    const value = await redis.get(key);
    return value !== null;
  }

  async getFishPriceMultiplier() {
    const isActive = await this.isFishPriceBoostActive();
    return isActive ? 1.5 : 1;
  }

  async getFishPriceBoostRemainingMinutes() {
    const key = `sakura:fishing:torpedo_explosion:${this.groupId}`;
    const ttl = await redis.ttl(key);
    return ttl > 0 ? Math.ceil(ttl / 60) : 0;
  }
}
