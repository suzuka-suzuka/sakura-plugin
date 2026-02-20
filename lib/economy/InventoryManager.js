import { plugindata } from "../path.js";
import EconomyManager from "./EconomyManager.js";
import db from "../Database.js";

export default class InventoryManager {
  constructor(eOrGroupId, userId) {
    if (typeof eOrGroupId === 'object' && eOrGroupId.group_id) {
      this.e = eOrGroupId;
      this.groupId = String(eOrGroupId.group_id);
      this.userId = String(eOrGroupId.user_id);
    } else {
      this.groupId = String(eOrGroupId);
      this.userId = String(userId);
      this.e = { group_id: this.groupId, user_id: this.userId };
    }

    this.economyManager = new EconomyManager(this.e);
  }

  getInventory() {
    const rows = db.prepare(`
        SELECT item_id, count 
        FROM inventory 
        WHERE group_id = ? AND user_id = ?
    `).all(this.groupId, this.userId);

    const inventory = {};
    for (const row of rows) {
      inventory[row.item_id] = row.count;
    }
    return inventory;
  }

  getItemCount(itemId) {
    const row = db.prepare(`
        SELECT count 
        FROM inventory 
        WHERE group_id = ? AND user_id = ? AND item_id = ?
    `).get(this.groupId, this.userId, itemId);

    return row ? row.count : 0;
  }

  getCurrentSize() {
    const row = db.prepare(`
        SELECT SUM(count) as total
        FROM inventory 
        WHERE group_id = ? AND user_id = ?
    `).get(this.groupId, this.userId);

    return row ? (row.total || 0) : 0;
  }

  async addItem(itemId, count = 1) {
    const maxCapacity = this.economyManager.getBagCapacity(this.e);
    const currentSize = this.getCurrentSize();

    if (currentSize + count > maxCapacity) {
      return { success: false, msg: `背包空间不足！当前剩余空间：${maxCapacity - currentSize}，需要空间：${count}` };
    }

    db.prepare(`
        INSERT INTO inventory (group_id, user_id, item_id, count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(group_id, user_id, item_id) 
        DO UPDATE SET count = count + ?
    `).run(this.groupId, this.userId, itemId, count, count);

    return { success: true, msg: "添加成功" };
  }

  async forceAddItem(itemId, count = 1) {
    db.prepare(`
        INSERT INTO inventory (group_id, user_id, item_id, count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(group_id, user_id, item_id) 
        DO UPDATE SET count = count + ?
    `).run(this.groupId, this.userId, itemId, count, count);

    return true;
  }

  removeItem(itemId, count = 1) {
    const currentCount = this.getItemCount(itemId);

    if (currentCount < count) {
      return false;
    }

    if (currentCount === count) {
      db.prepare(`
            DELETE FROM inventory 
            WHERE group_id = ? AND user_id = ? AND item_id = ?
        `).run(this.groupId, this.userId, itemId);
    } else {
      db.prepare(`
            UPDATE inventory 
            SET count = count - ?
            WHERE group_id = ? AND user_id = ? AND item_id = ?
        `).run(count, this.groupId, this.userId, itemId);
    }

    return true;
  }
}
