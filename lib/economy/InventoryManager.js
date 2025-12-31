import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../path.js";
import EconomyManager from "./EconomyManager.js";

const inventoryPath = path.join(plugindata, "economy", "inventory");
if (!fs.existsSync(inventoryPath)) {
  fs.mkdirSync(inventoryPath, { recursive: true });
}

export default class InventoryManager {
  constructor(eOrGroupId, userId) {
    if (typeof eOrGroupId === 'object' && eOrGroupId.group_id) {
      this.e = eOrGroupId;
      this.groupId = eOrGroupId.group_id;
      this.userId = eOrGroupId.user_id;
    } else {
      this.groupId = eOrGroupId;
      this.userId = userId;
      this.e = { group_id: this.groupId, user_id: this.userId };
    }
    
    this.file = path.join(inventoryPath, `${this.groupId}.json`);
    this.data = this._load();
    this.economyManager = new EconomyManager(this.e);
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

  _initUser() {
    if (!this.data[this.userId]) {
      this.data[this.userId] = {};
    }
    return this.data[this.userId];
  }

  getInventory() {
    return this._initUser();
  }

  getItemCount(itemId) {
    const inventory = this._initUser();
    return inventory[itemId] || 0;
  }

  getCurrentSize() {
    const inventory = this._initUser();
    return Object.values(inventory).reduce((sum, count) => sum + count, 0);
  }

  async addItem(itemId, count = 1) {
    const inventory = this._initUser();
    const maxCapacity = this.economyManager.getBagCapacity(this.e);
    const currentSize = this.getCurrentSize();
    
    if (currentSize + count > maxCapacity) {
      return { success: false, msg: `背包空间不足！当前剩余空间：${maxCapacity - currentSize}，需要空间：${count}` };
    }
    
    if (!inventory[itemId]) {
      inventory[itemId] = 0;
    }
    
    inventory[itemId] += count;
    this._save();
    return { success: true, msg: "添加成功" };
  }

  async forceAddItem(itemId, count = 1) {
    const inventory = this._initUser();
    if (!inventory[itemId]) {
      inventory[itemId] = 0;
    }
    inventory[itemId] += count;
    this._save();
    return true;
  }

  removeItem(itemId, count = 1) {
    const inventory = this._initUser();
    if (!inventory[itemId] || inventory[itemId] < count) {
      return false;
    }
    
    inventory[itemId] -= count;
    if (inventory[itemId] <= 0) {
      delete inventory[itemId];
    }
    this._save();
    return true;
  }
}
