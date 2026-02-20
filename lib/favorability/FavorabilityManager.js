import { plugindata } from "../path.js";
import db from "../Database.js";

class FavorabilityManager {
  constructor() {
  }

  addFavorability(groupId, from, to, value) {
    const gId = String(groupId);
    const fromId = String(from);
    const toId = String(to);

    db.prepare(`
        INSERT INTO favorability (group_id, from_user_id, to_user_id, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(group_id, from_user_id, to_user_id)
        DO UPDATE SET value = value + ?
    `).run(gId, fromId, toId, value, value);
  }

  getFavorability(groupId, from, to) {
    const gId = String(groupId);
    const fromId = String(from);
    const toId = String(to);

    const row = db.prepare(`
        SELECT value 
        FROM favorability 
        WHERE group_id = ? AND from_user_id = ? AND to_user_id = ?
    `).get(gId, fromId, toId);

    return row ? row.value : 0;
  }

  decreaseFavorabilityForTarget(groupId, targetUser, amount) {
    const gId = String(groupId);
    const tId = String(targetUser);

    db.prepare(`
        UPDATE favorability 
        SET value = value - ?
        WHERE group_id = ? AND to_user_id = ?
    `).run(amount, gId, tId);
  }

  getInboundFavorability(groupId, userId) {
    const gId = String(groupId);
    const rows = db.prepare(`
        SELECT from_user_id as userId, value as favorability
        FROM favorability
        WHERE group_id = ? AND to_user_id = ?
        ORDER BY value DESC
        LIMIT 20
    `).all(gId, String(userId));
    return rows;
  }

  getOutboundFavorability(groupId, userId) {
    const gId = String(groupId);
    const rows = db.prepare(`
        SELECT to_user_id as userId, value as favorability
        FROM favorability
        WHERE group_id = ? AND from_user_id = ?
        ORDER BY value DESC
        LIMIT 20
    `).all(gId, String(userId));
    return rows;
  }

  cleanupFavorability() {
    // Optional cleanup
  }
}

export default new FavorabilityManager();
