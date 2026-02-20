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
    if (!this.groupId) return;
    const userId = this._initUser(e);

    this.getUserData(userId);

    db.prepare(`
        UPDATE economy 
        SET coins = coins + ?
        WHERE group_id = ? AND user_id = ?
    `).run(amount, this.groupId, userId);
  }

  reduceCoins(e, amount) {
    if (!this.groupId) return;
    const userId = this._initUser(e);

    this.getUserData(userId);

    db.prepare(`
        UPDATE economy 
        SET coins = MAX(0, coins - ?)
        WHERE group_id = ? AND user_id = ?
    `).run(amount, this.groupId, userId);
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

    const cost = config.levels[nextLevel].cost
    if (data.coins < cost) {
      return { success: false, msg: `金币不足，升级需要 ${cost} 金币` }
    }

    const transaction = db.transaction(() => {
      db.prepare(`
            UPDATE economy 
            SET coins = coins - ?
            WHERE group_id = ? AND user_id = ?
        `).run(cost, this.groupId, userId);

      db.prepare(`
            UPDATE economy 
            SET bag_level = ?
            WHERE group_id = ? AND user_id = ?
        `).run(nextLevel, this.groupId, userId);
    });

    try {
      transaction();
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
