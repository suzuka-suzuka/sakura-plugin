import { plugindata } from "../path.js";
import Setting from "../setting.js";
import InventoryManager from "./InventoryManager.js";
import db from "../Database.js";

export default class FishingManager {
  constructor(groupId) {
    this.groupId = String(groupId);
  }

  // ==================== 职业系统 ====================

  static getProfessionYaml() {
    return Setting.getEconomy('profession') || {};
  }

  static getUnlockRequirements() {
    const yaml = FishingManager.getProfessionYaml();
    return yaml.unlock_requirements || { level_1: 60, level_2: 120 };
  }

  static getProfessionConfig(professionId) {
    const yaml = FishingManager.getProfessionYaml();
    const professions = yaml.professions || {};
    return professions[professionId] || null;
  }

  static getAllProfessions() {
    const yaml = FishingManager.getProfessionYaml();
    const professions = yaml.professions || {};
    return Object.keys(professions).map(id => ({
      id,
      ...professions[id]
    }));
  }

  _ensureUser(userId) {
    userId = String(userId);
    const row = db.prepare('SELECT 1 FROM fishing_stats WHERE group_id = ? AND user_id = ?').get(this.groupId, userId);
    if (!row) {
      db.prepare(`
              INSERT INTO fishing_stats (group_id, user_id, total_catch, total_earnings, torpedo_hits, profession, profession_level)
              VALUES (?, ?, 0, 0, 0, NULL, 0)
          `).run(this.groupId, userId);
    }
  }

  getUserData(userId) {
    userId = String(userId);
    this._ensureUser(userId);
    return db.prepare('SELECT * FROM fishing_stats WHERE group_id = ? AND user_id = ?').get(this.groupId, userId);
  }

  getUserProfession(userId) {
    const userData = this.getUserData(userId);
    const professionId = userData.profession;
    const level = userData.profession_level || 0;

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

  canChooseProfession(userId) {
    const userData = this.getUserData(userId);
    const requirements = FishingManager.getUnlockRequirements();
    return userData.total_catch >= requirements.level_1 && !userData.profession;
  }

  canAdvanceProfession(userId) {
    const userData = this.getUserData(userId);
    const requirements = FishingManager.getUnlockRequirements();
    return userData.total_catch >= requirements.level_2 &&
      userData.profession &&
      userData.profession_level === 1;
  }

  chooseProfession(userId, professionId) {
    userId = String(userId);
    const userData = this.getUserData(userId);
    const requirements = FishingManager.getUnlockRequirements();

    if (userData.profession) {
      return { success: false, msg: "你已经有职业了，无法再选择其他职业！" };
    }

    if (userData.total_catch < requirements.level_1) {
      return { success: false, msg: `钓鱼次数不足！需要${requirements.level_1}次，当前${userData.total_catch}次` };
    }

    const professionConfig = FishingManager.getProfessionConfig(professionId);
    if (!professionConfig) {
      return { success: false, msg: "无效的职业！" };
    }

    db.prepare('UPDATE fishing_stats SET profession = ?, profession_level = 1 WHERE group_id = ? AND user_id = ?')
      .run(professionId, this.groupId, userId);

    const levelConfig = professionConfig.levels[1];

    return {
      success: true,
      msg: `成功选择职业【${professionConfig.icon}${professionConfig.name}】！`,
      profession: professionConfig,
      title: levelConfig.title
    };
  }

  advanceProfession(userId) {
    userId = String(userId);
    const userData = this.getUserData(userId);
    const requirements = FishingManager.getUnlockRequirements();

    if (!userData.profession) {
      return { success: false, msg: "你还没有职业，请先选择一个职业！" };
    }

    if (userData.profession_level >= 2) {
      return { success: false, msg: "你的职业已经达到最高等级！" };
    }

    if (userData.total_catch < requirements.level_2) {
      return { success: false, msg: `钓鱼次数不足！进阶需要${requirements.level_2}次，当前${userData.total_catch}次` };
    }

    const professionConfig = FishingManager.getProfessionConfig(userData.profession);

    db.prepare('UPDATE fishing_stats SET profession_level = 2 WHERE group_id = ? AND user_id = ?')
      .run(this.groupId, userId);

    const levelConfig = professionConfig.levels[2];

    return {
      success: true,
      msg: `职业【${professionConfig.icon}${professionConfig.name}】进阶成功！现在是【${levelConfig.title}】！`,
      profession: professionConfig,
      title: levelConfig.title
    };
  }

  getTreasureBonus(userId) {
    const userData = this.getUserData(userId);
    if (userData.profession !== 'treasure_hunter' || userData.profession_level <= 0) {
      return 0;
    }
    const config = FishingManager.getProfessionConfig('treasure_hunter');
    if (!config || !config.levels || !config.levels[userData.profession_level]) {
      return 0;
    }
    return config.levels[userData.profession_level].treasure_bonus || 0;
  }

  getLineBonusFromMastery(userId, rodId) {
    const userData = this.getUserData(userId);
    if (userData.profession !== 'fishing_master' || userData.profession_level <= 0) {
      return 0;
    }
    const mastery = this.getRodMastery(userId, rodId);
    const config = FishingManager.getProfessionConfig('fishing_master');
    if (!config || !config.levels || !config.levels[userData.profession_level]) {
      return 0;
    }
    const multiplier = config.levels[userData.profession_level].mastery_multiplier || 0;
    return Math.floor(mastery * multiplier);
  }

  getMerchantCoinMultiplier(userId) {
    const userData = this.getUserData(userId);
    if (userData.profession !== 'merchant' || userData.profession_level <= 0) {
      return 1;
    }
    const config = FishingManager.getProfessionConfig('merchant');
    if (!config || !config.levels || !config.levels[userData.profession_level]) {
      return 1;
    }
    const bonus = config.levels[userData.profession_level].coin_bonus || 0;
    return 1 + bonus;
  }

  getRodControl(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return 0;

    const damage = this.getRodStats(userId, rodId).damage || 0;
    return Math.max(0, rodConfig.control - damage);
  }

  getRodStats(userId, rodId) {
    userId = String(userId);
    const row = db.prepare('SELECT damage, mastery FROM rod_stats WHERE group_id = ? AND user_id = ? AND rod_id = ?')
      .get(this.groupId, userId, rodId);
    return row || { damage: 0, mastery: 0 };
  }

  getRodDurabilityInfo(userId, rodId) {
    const rodConfig = this.getRodConfig(rodId);
    if (!rodConfig) return { damage: 0, currentControl: 0, maxControl: 0 };

    const damage = this.getRodStats(userId, rodId).damage || 0;

    return {
      damage,
      currentControl: Math.max(0, rodConfig.control - damage),
      maxControl: rodConfig.control
    };
  }

  damageRod(userId, rodId, damage) {
    userId = String(userId);
    db.prepare(`
        INSERT INTO rod_stats (group_id, user_id, rod_id, damage, mastery)
        VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(group_id, user_id, rod_id)
        DO UPDATE SET damage = damage + ?
    `).run(this.groupId, userId, rodId, damage, damage);
  }

  clearRodDamage(userId, rodId) {
    userId = String(userId);
    db.prepare(`
        UPDATE rod_stats
        SET damage = 0
        WHERE group_id = ? AND user_id = ? AND rod_id = ?
    `).run(this.groupId, userId, rodId);
  }

  getRodMastery(userId, rodId) {
    return this.getRodStats(userId, rodId).mastery || 0;
  }

  increaseRodMastery(userId, rodId) {
    userId = String(userId);
    db.prepare(`
        INSERT INTO rod_stats (group_id, user_id, rod_id, damage, mastery)
        VALUES (?, ?, ?, 0, 1)
        ON CONFLICT(group_id, user_id, rod_id)
        DO UPDATE SET mastery = mastery + 1
    `).run(this.groupId, userId, rodId);
  }

  clearRodMastery(userId, rodId) {
    userId = String(userId);
    db.prepare(`
        UPDATE rod_stats
        SET mastery = 0
        WHERE group_id = ? AND user_id = ? AND rod_id = ?
    `).run(this.groupId, userId, rodId);
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

  recordTorpedoHit(userId) {
    userId = String(userId);
    this._ensureUser(userId);
    db.prepare('UPDATE fishing_stats SET torpedo_hits = torpedo_hits + 1 WHERE group_id = ? AND user_id = ?')
      .run(this.groupId, userId);
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
    userId = String(userId);
    if (this.hasRod(userId, rodId)) {
      this._ensureUser(userId);
      db.prepare('UPDATE fishing_stats SET rod = ? WHERE group_id = ? AND user_id = ?')
        .run(rodId, this.groupId, userId);
      return true;
    }
    return false;
  }

  getEquippedRod(userId) {
    const userData = this.getUserData(userId);
    if (userData.rod && !this.hasRod(userId, userData.rod)) {
      this.clearEquippedRod(userId, userData.rod);
      return null;
    }
    return userData.rod;
  }

  clearEquippedRod(userId, rodId = null) {
    userId = String(userId);
    this._ensureUser(userId);
    const userData = this.getUserData(userId);
    const targetRodId = rodId || userData.rod;

    if (targetRodId) {
      db.transaction(() => {
        // Also clear rod damage and mastery when clearing equipped rod??
        // The original logic did:
        // if (rodId || userData.rod === rodId) { userData.rod = null; }
        // delete userData.rodDamage[targetRodId];
        // delete userData.rodMastery[targetRodId];

        // Wait, clearing the rod stats when unequipped? That sounds harsh.
        // Oh, the method name is clearEquippedRod, but it acted like "Destroy Rod".
        // If the intention is to unequip, it should just set rod = null.
        // But if the rod is broken or lost, then yes.
        // Let's assume this is used when rod breaks or is removed.
        // But the method name is ambiguous.
        // In ShopManager, it calls equipRod.
        // Let's look at fishing.js usage.
        // Usually used when rod breaks.

        db.prepare('DELETE FROM rod_stats WHERE group_id = ? AND user_id = ? AND rod_id = ?')
          .run(this.groupId, userId, targetRodId);

        if (!rodId || userData.rod === targetRodId) {
          db.prepare('UPDATE fishing_stats SET rod = NULL WHERE group_id = ? AND user_id = ?')
            .run(this.groupId, userId);
        }
      })();
    }
  }

  equipLine(userId, lineId) {
    userId = String(userId);
    if (this.hasLine(userId, lineId)) {
      this._ensureUser(userId);
      db.prepare('UPDATE fishing_stats SET line = ? WHERE group_id = ? AND user_id = ?')
        .run(lineId, this.groupId, userId);
      return true;
    }
    return false;
  }

  getEquippedLine(userId) {
    const userData = this.getUserData(userId);
    if (userData.line && !this.hasLine(userId, userData.line)) {
      this.clearEquippedLine(userId);
      return null;
    }
    return userData.line;
  }

  clearEquippedLine(userId) {
    userId = String(userId);
    this._ensureUser(userId);
    db.prepare('UPDATE fishing_stats SET line = NULL WHERE group_id = ? AND user_id = ?')
      .run(this.groupId, userId);
  }

  getUserBaits(userId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getInventory();
  }

  getBaitCount(userId, baitId) {
    const inventoryManager = new InventoryManager(this.groupId, userId);
    return inventoryManager.getItemCount(baitId);
  }

  equipBait(userId, baitId) {
    userId = String(userId);
    if (this.getBaitCount(userId, baitId) > 0) {
      this._ensureUser(userId);
      db.prepare('UPDATE fishing_stats SET bait = ? WHERE group_id = ? AND user_id = ?')
        .run(baitId, this.groupId, userId);
      return true;
    }
    return false;
  }

  getEquippedBait(userId) {
    userId = String(userId);
    const userData = this.getUserData(userId);
    if (!userData.bait) return null;

    if (this.getBaitCount(userId, userData.bait) > 0) {
      return userData.bait;
    }

    this._ensureUser(userId);
    db.prepare('UPDATE fishing_stats SET bait = NULL WHERE group_id = ? AND user_id = ?')
      .run(this.groupId, userId);
    return null;
  }

  consumeBait(userId) {
    userId = String(userId);
    this._ensureUser(userId);
    const userData = this.getUserData(userId);
    const baitId = userData.bait;

    if (baitId) {
      const inventoryManager = new InventoryManager(this.groupId, userId);
      if (inventoryManager.getItemCount(baitId) > 0) {
        inventoryManager.removeItem(baitId, 1);

        if (inventoryManager.getItemCount(baitId) <= 0) {
          const inventory = inventoryManager.getInventory();
          const allBaits = this.getAllBaits();
          const availableBaits = allBaits
            .filter(b => inventory[b.id] > 0)
            .sort((a, b) => (a.price || 0) - (b.price || 0));

          const nextBait = availableBaits.length > 0 ? availableBaits[0].id : null;

          db.prepare('UPDATE fishing_stats SET bait = ? WHERE group_id = ? AND user_id = ?')
            .run(nextBait, this.groupId, userId);
        }
        return true;
      }
    }
    return false;
  }

  recordCatch(userId, earnings, fishId, isSuccess = true) {
    userId = String(userId);
    this._ensureUser(userId);

    db.transaction(() => {
      db.prepare(`
            UPDATE fishing_stats 
            SET total_catch = total_catch + 1, total_earnings = total_earnings + ?
            WHERE group_id = ? AND user_id = ?
        `).run(earnings, this.groupId, userId);

      if (fishId) {
        const successIncrement = isSuccess ? 1 : 0;
        db.prepare(`
                INSERT INTO fishing_counts (group_id, user_id, fish_id, count, success_count)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(group_id, user_id, fish_id)
                DO UPDATE SET count = count + 1, success_count = success_count + ?
            `).run(this.groupId, userId, fishId, successIncrement, successIncrement);
      }
    })();
  }

  getFishingRanking(limit = 10) {
    const rows = db.prepare(`
        SELECT user_id as userId, total_earnings as totalEarnings, total_catch as totalCatch
        FROM fishing_stats
        WHERE group_id = ? AND (total_earnings > 0 OR total_catch > 0)
        ORDER BY total_earnings DESC
        LIMIT ?
    `).all(this.groupId, limit);
    return rows;
  }

  getUserCatchHistory(userId) {
    userId = String(userId);
    const rows = db.prepare(`
        SELECT fish_id as fishId, count, success_count as successCount
        FROM fishing_counts
        WHERE group_id = ? AND user_id = ?
        ORDER BY success_count DESC
    `).all(this.groupId, userId);
    return rows;
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
    const rows = db.prepare('SELECT user_id, timestamp FROM pond_torpedoes WHERE group_id = ?').all(this.groupId);
    const result = {};
    for (const row of rows) {
      result[row.user_id] = row.timestamp;
    }
    return result;
  }

  getUserTorpedoCount(userId) {
    userId = String(userId);
    const row = db.prepare('SELECT 1 FROM pond_torpedoes WHERE group_id = ? AND user_id = ?').get(this.groupId, userId);
    return row ? 1 : 0;
  }

  getTotalTorpedoCount() {
    const row = db.prepare('SELECT COUNT(*) as count FROM pond_torpedoes WHERE group_id = ?').get(this.groupId);
    return row ? row.count : 0;
  }

  deployTorpedo(userId) {
    userId = String(userId);
    if (this.getUserTorpedoCount(userId) > 0) {
      return { success: false, msg: "你在鱼塘中已有一个鱼雷了！" };
    }

    db.prepare(`
        INSERT INTO pond_torpedoes (group_id, user_id, timestamp)
        VALUES (?, ?, ?)
    `).run(this.groupId, userId, Date.now());

    return { success: true, msg: "鱼雷投放成功！" };
  }

  getAvailableTorpedoCount(excludeUserId) {
    excludeUserId = String(excludeUserId);
    const row = db.prepare('SELECT COUNT(*) as count FROM pond_torpedoes WHERE group_id = ? AND user_id != ?').get(this.groupId, excludeUserId);
    return row ? row.count : 0;
  }

  triggerTorpedo(fisherId) {
    fisherId = String(fisherId);
    // Select a random user (excluding fisherId)
    // SQLite: ORDER BY RANDOM() LIMIT 1
    const row = db.prepare(`
        SELECT user_id 
        FROM pond_torpedoes 
        WHERE group_id = ? AND user_id != ? 
        ORDER BY RANDOM() 
        LIMIT 1
    `).get(this.groupId, fisherId);

    if (row) {
      db.prepare('DELETE FROM pond_torpedoes WHERE group_id = ? AND user_id = ?').run(this.groupId, row.user_id);
      return row.user_id;
    }

    return null;
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
