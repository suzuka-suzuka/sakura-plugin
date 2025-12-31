import fs from "fs";
import path from "path";
import { plugindata } from "../path.js";
import EconomyManager from "./EconomyManager.js";
import FishingManager from "./FishingManager.js";
import InventoryManager from "./InventoryManager.js";
import Setting from "../setting.js";

const inventoryPath = path.join(plugindata, "economy", "inventory");
const buffPath = path.join(plugindata, "economy", "buffs");

if (!fs.existsSync(inventoryPath)) {
  fs.mkdirSync(inventoryPath, { recursive: true });
}
if (!fs.existsSync(buffPath)) {
  fs.mkdirSync(buffPath, { recursive: true });
}

class ShopManager {
  constructor() {}

  getShopConfig() {
    return Setting.getEconomy("shop") || { categories: {} };
  }

  getAllCategories() {
    const config = this.getShopConfig();
    return config.categories || {};
  }

  getCategory(categoryId) {
    const categories = this.getAllCategories();
    return categories[categoryId] || null;
  }

  getAllItems() {
    const categories = this.getAllCategories();
    const items = [];
    for (const [categoryId, category] of Object.entries(categories)) {
      if (category.items) {
        for (const item of category.items) {
          items.push({
            ...item,
            categoryId,
            handler: category.handler,
          });
        }
      }
    }
    return items;
  }

  findItemByName(name) {
    const items = this.getAllItems();
    return items.find((item) => item.name === name) || null;
  }

  findItemById(id) {
    const items = this.getAllItems();
    return items.find((item) => item.id === id) || null;
  }

  async buyItem(e, itemName, count = 1) {
    const item = this.findItemByName(itemName);
    if (!item) {
      return { success: false, msg: `商店里没有【${itemName}】这个商品哦~` };
    }

    if (item.type === "equipment") {
      const hasItem = await this.checkEquipmentOwned(e, item);
      if (hasItem) {
        return {
          success: false,
          msg: `你已经拥有【${item.name}】了，无需重复购买~`,
        };
      }
      count = 1;
    }

    const totalPrice = item.price * count;
    const economyManager = new EconomyManager(e);
    const coins = economyManager.getCoins(e);

    if (coins < totalPrice) {
      return {
        success: false,
        msg: `樱花币不足！购买${count > 1 ? ` ${count} 个` : ""}【${
          item.name
        }】需要 ${totalPrice} 樱花币，你只有 ${coins}。`,
      };
    }

    economyManager.reduceCoins(e, totalPrice);

    const result = await this.handlePurchase(e, item, count);

    if (!result.success) {
      economyManager.addCoins(e, totalPrice);
      return result;
    }

    return {
      success: true,
      msg: `🎉 购买成功！\n${count > 1 ? `${count} 个` : ""}【${
        item.name
      }】已到账！\n💰 花费：${totalPrice} 樱花币`,
      item,
      count,
    };
  }

  async handlePurchase(e, item, count) {
    if (item.handler === 'buff') {
        this.activateBuff(e.group_id, e.user_id, item);
        return { success: true, msg: `购买成功！Buff 已激活` };
    }

    const inventoryManager = new InventoryManager(e);
    let itemId = item.name;
    if (item.handler === 'fishing_rod' || item.handler === 'fishing_bait') {
      itemId = item.id;
    }

    const result = await inventoryManager.addItem(itemId, count);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      actualCount: count,
      msg: `🎉 购买成功！\n${count > 1 ? `${count} 个` : ""}【${
        item.name
      }】已到账！\n💰 花费：${item.price * count} 樱花币`,
      item,
      count,
    };
  }

  async checkEquipmentOwned(e, item) {
    const inventoryManager = new InventoryManager(e);
    let itemId = item.name;
    if (item.handler === 'fishing_rod' || item.handler === 'fishing_bait') {
      itemId = item.id;
    }
    return inventoryManager.getItemCount(itemId) > 0;
  }

  handleGiftPurchase(e, item, count) {
    // Deprecated, handled by handlePurchase
    return { success: true };
  }

  handleFishingRodPurchase(e, item) {
    // Deprecated, handled by handlePurchase
    return { success: true };
  }

  handleFishingBaitPurchase(e, item, count) {
    // Deprecated, handled by handlePurchase
    return { success: true, actualCount: count };
  }

  handleBuffPurchase(e, item) {
    this.activateBuff(e.group_id, e.user_id, item);
    return { success: true };
  }

  handleDefaultPurchase(e, item, count) {
    // Deprecated, handled by handlePurchase
    return { success: true };
  }

  getInventoryFile(groupId) {
    return path.join(inventoryPath, `${groupId}.json`);
  }

  getInventory(groupId, userId) {
    const file = this.getInventoryFile(groupId);
    if (!fs.existsSync(file)) return {};

    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return data[String(userId)] || {};
    } catch (err) {
      return {};
    }
  }

  addToInventory(groupId, userId, itemName, count = 1) {
    const file = this.getInventoryFile(groupId);
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {}
    }

    const uid = String(userId);
    if (!data[uid]) data[uid] = {};
    if (!data[uid][itemName]) data[uid][itemName] = 0;
    data[uid][itemName] += count;

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  removeFromInventory(groupId, userId, itemName, count = 1) {
    const file = this.getInventoryFile(groupId);
    if (!fs.existsSync(file)) return false;

    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      return false;
    }

    const uid = String(userId);
    if (!data[uid] || !data[uid][itemName] || data[uid][itemName] < count) {
      return false;
    }

    data[uid][itemName] -= count;
    if (data[uid][itemName] <= 0) {
      delete data[uid][itemName];
    }

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  }

  hasItem(groupId, userId, itemName, count = 1) {
    const inventory = this.getInventory(groupId, userId);
    return (inventory[itemName] || 0) >= count;
  }

  getBuffFile(groupId) {
    return path.join(buffPath, `${groupId}.json`);
  }

  getActiveBuffs(groupId, userId) {
    const file = this.getBuffFile(groupId);
    if (!fs.existsSync(file)) return {};

    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const userBuffs = data[String(userId)] || {};
      const now = Date.now();

      const activeBuffs = {};
      for (const [buffId, buff] of Object.entries(userBuffs)) {
        if (buff.expireTime > now) {
          activeBuffs[buffId] = buff;
        }
      }

      return activeBuffs;
    } catch (err) {
      return {};
    }
  }

  activateBuff(groupId, userId, item) {
    const file = this.getBuffFile(groupId);
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {}
    }

    const uid = String(userId);
    if (!data[uid]) data[uid] = {};

    const now = Date.now();
    const expireTime = now + (item.duration || 3600) * 1000;

    data[uid][item.id] = {
      name: item.name,
      effect: item.effect,
      activatedAt: now,
      expireTime: expireTime,
    };

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  hasBuff(groupId, userId, effectType) {
    const buffs = this.getActiveBuffs(groupId, userId);
    for (const buff of Object.values(buffs)) {
      if (buff.effect?.type === effectType) {
        return buff;
      }
    }
    return null;
  }

  getBuffValue(groupId, userId, effectType, defaultValue = 1) {
    const buff = this.hasBuff(groupId, userId, effectType);
    return buff ? buff.effect?.value || defaultValue : defaultValue;
  }

  generateShopMessage(e) {
    const categories = this.getAllCategories();
    const forwardMsg = [];

    forwardMsg.push({
      nickname: "樱神社商店",
      user_id: e.self_id,
      content:
        "🏪 欢迎光临「樱神社商店」！\n\n💡 购买指令：#购买 商品名 [数量]\n例如：#购买 蚯蚓 10",
    });

    for (const [categoryId, category] of Object.entries(categories)) {
      if (!category.items || category.items.length === 0) continue;

      let msg = `${category.name}\n${category.description}\n━━━━━━━━━━━━━━━━\n`;

      for (const item of category.items) {
        msg += `\n📦 ${item.name}\n`;
        msg += `💰 价格：${item.price} 樱花币\n`;
        if (item.favorability) {
          msg += `❤️ 好感度：+${item.favorability}\n`;
        }
        if (item.duration) {
          msg += `⏱️ 持续：${this.formatDuration(item.duration)}\n`;
        }
        if (item.type === "equipment") {
          msg += `🔧 类型：永久装备\n`;
        }
        msg += `📝 ${item.description}\n`;
      }

      forwardMsg.push({
        nickname: "樱神社商店",
        user_id: e.self_id,
        content: msg.trim(),
      });
    }

    return forwardMsg;
  }

  formatDuration(seconds) {
    if (seconds >= 3600) {
      return `${Math.floor(seconds / 3600)} 小时`;
    } else if (seconds >= 60) {
      return `${Math.floor(seconds / 60)} 分钟`;
    }
    return `${seconds} 秒`;
  }
}

export default ShopManager;
