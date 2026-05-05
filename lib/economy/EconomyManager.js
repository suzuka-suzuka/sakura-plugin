import Setting from "../setting.js"
import db from "../Database.js"

export default class EconomyManager {
  constructor(e) {
    this.groupId = e.group_id ? String(e.group_id) : null;
    this.config = Setting.getConfig("economy")
  }

  _initUser(e) {
    const userId = String(e.user_id);
    if (!this.groupId) {
      return userId;
    }

    db.prepare(`
        INSERT OR IGNORE INTO economy (group_id, user_id, coins, experience, level, bag_level)
        VALUES (?, ?, 0, 0, 1, 1)
    `).run(this.groupId, userId);

    return userId;
  }

  getUserData(userId) {
    if (!this.groupId) return { coins: 0, experience: 0, level: 1, bag_level: 1 };

    let row = db.prepare('SELECT * FROM economy WHERE group_id = ? AND user_id = ?').get(this.groupId, userId);
    if (!row) {
      db.prepare(`
            INSERT OR IGNORE INTO economy (group_id, user_id, coins, experience, level, bag_level)
            VALUES (?, ?, 0, 0, 1, 1)
        `).run(this.groupId, userId);
      row = { coins: 0, experience: 0, level: 1, bag_level: 1 };
    }
    return row;
  }

  getCoins(e) {
    this._initUser(e);
    const data = this.getUserData(String(e.user_id));
    return data.coins;
  }

  getLevel(e) {
    this._initUser(e);
    const data = this.getUserData(String(e.user_id));
    return data.level;
  }

  getExperience(e) {
    this._initUser(e);
    const data = this.getUserData(String(e.user_id));
    return data.experience;
  }

  _normalizeCoinAmount(amount) {
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) {
      return null;
    }
    return value;
  }

  checkRequirement(e, type, value) {
    this._initUser(e);
    const data = this.getUserData(String(e.user_id));
    if (type === 'coins') {
      return data.coins >= value
    } else if (type === 'level') {
      return data.level >= value
    }
    return false
  }

  addExperience(e, amount) {
    if (!this.groupId) return;
    const userId = this._initUser(e);

    const currentData = this.getUserData(userId);
    const newExp = currentData.experience + amount;
    const newLevel = Math.floor(Math.sqrt(newExp / 100)) + 1;

    db.prepare(`
        UPDATE economy 
        SET experience = ?, level = ?
        WHERE group_id = ? AND user_id = ?
    `).run(newExp, newLevel, this.groupId, userId);
  }

  reduceExperience(e, amount) {
    if (!this.groupId) return;
    const userId = this._initUser(e);

    const currentData = this.getUserData(userId);
    const newExp = Math.max(0, currentData.experience - amount);
    const newLevel = Math.floor(Math.sqrt(newExp / 100)) + 1;

    db.prepare(`
        UPDATE economy 
        SET experience = ?, level = ?
        WHERE group_id = ? AND user_id = ?
    `).run(newExp, newLevel, this.groupId, userId);
  }

  addCoins(e, amount) {
    if (!this.groupId) return false;
    const value = this._normalizeCoinAmount(amount);
    if (value == null) return false;

    const userId = this._initUser(e);

    this.getUserData(userId);

    const result = db.prepare(`
        UPDATE economy 
        SET coins = coins + ?
        WHERE group_id = ? AND user_id = ?
    `).run(value, this.groupId, userId);

    return result.changes > 0;
  }

  reduceCoins(e, amount) {
    if (!this.groupId) return false;
    const value = this._normalizeCoinAmount(amount);
    if (value == null) return false;

    const userId = this._initUser(e);

    this.getUserData(userId);

    const result = db.prepare(`
        UPDATE economy 
        SET coins = MAX(0, coins - ?)
        WHERE group_id = ? AND user_id = ?
    `).run(value, this.groupId, userId);

    return result.changes > 0;
  }

  tryReduceCoins(e, amount) {
    if (!this.groupId) return false;
    const value = this._normalizeCoinAmount(amount);
    if (value == null) return false;

    const userId = this._initUser(e);

    this.getUserData(userId);

    const result = db.prepare(`
        UPDATE economy
        SET coins = coins - ?
        WHERE group_id = ? AND user_id = ? AND coins >= ?
    `).run(value, this.groupId, userId, value);

    return result.changes === 1;
  }

  spendCoins(e, amount, creditEntries = []) {
    if (!this.groupId) return false;
    const value = this._normalizeCoinAmount(amount);
    if (value == null) return false;

    const normalizedCredits = [];
    let totalCredit = 0;
    for (const entry of creditEntries) {
      const creditAmount = this._normalizeCoinAmount(entry?.amount);
      if (creditAmount == null) continue;
      if (!entry?.e?.user_id) return false;
      normalizedCredits.push({ e: entry.e, amount: creditAmount });
      totalCredit += creditAmount;
    }

    if (totalCredit > value) return false;

    const fromUserId = this._initUser(e);
    const creditUsers = normalizedCredits.map((entry) => ({
      userId: this._initUser(entry.e),
      amount: entry.amount,
    }));

    const transaction = db.transaction(() => {
      const result = db.prepare(`
          UPDATE economy
          SET coins = coins - ?
          WHERE group_id = ? AND user_id = ? AND coins >= ?
      `).run(value, this.groupId, fromUserId, value);

      if (result.changes !== 1) {
        return false;
      }

      for (const entry of creditUsers) {
        db.prepare(`
            UPDATE economy
            SET coins = coins + ?
            WHERE group_id = ? AND user_id = ?
        `).run(entry.amount, this.groupId, entry.userId);
      }

      return true;
    });

    return transaction();
  }

  transferCoins(fromE, toE, amount) {
    return this.spendCoins(fromE, amount, [{ e: toE, amount }]);
  }


  getRanking(type, limit = 10) {
    if (!this.groupId) return [];

    const validTypes = ['coins', 'level', 'experience'];
    if (!validTypes.includes(type)) return [];

    const rows = db.prepare(`
        SELECT user_id as userId, coins, experience, level, bag_level
        FROM economy
        WHERE group_id = ?
        ORDER BY ${type} DESC
        LIMIT ?
    `).all(this.groupId, limit);

    return rows;
  }

  getBagLevel(e) {
    this._initUser(e);
    const data = this.getUserData(String(e.user_id));
    return data.bag_level || 1;
  }

  getBagConfig() {
    const config = Setting.getEconomy("bag")
    if (config && Object.keys(config).length > 0) {
      return config
    }
    return { levels: { 1: { capacity: 5, cost: 0 } } }
  }

  getBagCapacity(e) {
    const level = this.getBagLevel(e)
    const config = this.getBagConfig()
    return config.levels[level]?.capacity || 5
  }

  upgradeBag(e) {
    if (!this.groupId) return { success: false, msg: "群聊信息错误" };

    const userId = this._initUser(e);
    const data = this.getUserData(userId);
    const currentLevel = data.bag_level || 1;
    const nextLevel = currentLevel + 1;
    const config = this.getBagConfig();

    if (!config.levels[nextLevel]) {
      return { success: false, msg: "背包已达到最高等级" }
    }

    const cost = this._normalizeCoinAmount(config.levels[nextLevel].cost) || 0
    if (data.coins < cost) {
      return { success: false, msg: `金币不足，升级需要 ${cost} 金币` }
    }

    const transaction = db.transaction(() => {
      const result = db.prepare(`
            UPDATE economy
            SET coins = coins - ?, bag_level = ?
            WHERE group_id = ? AND user_id = ? AND coins >= ? AND COALESCE(bag_level, 1) = ?
        `).run(cost, nextLevel, this.groupId, userId, cost, currentLevel);

      return result.changes === 1;
    });

    try {
      const success = transaction();
      if (!success) {
        return { success: false, msg: "金币不足或背包等级已变化，请重试" };
      }
      return {
        success: true,
        msg: `背包升级成功！当前等级: ${nextLevel}, 容量: ${config.levels[nextLevel].capacity}`,
        newLevel: nextLevel,
        newCapacity: config.levels[nextLevel].capacity
      }
    } catch (err) {
      return { success: false, msg: "升级失败: " + err.message };
    }
  }
}
