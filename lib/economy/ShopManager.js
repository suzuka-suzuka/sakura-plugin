import Setting from "../setting.js";
import db from "../Database.js";
import InventoryManager from "./InventoryManager.js";
import EconomyManager from "./EconomyManager.js";

class ShopManager {
  constructor() { }

  getShopConfig() {
    return Setting.getEconomy("shop") || { categories: {} };
  }

  getSpecialItemsConfig() {
    return Setting.getEconomy("special_items") || { categories: {} };
  }

  getAllCategories() {
    const config = this.getShopConfig();
    return config.categories || {};
  }

  getSpecialCategories() {
    const config = this.getSpecialItemsConfig();
    return config.categories || {};
  }

  getAllItems() {
    const categories = this.getAllCategories();
    const specialCategories = this.getSpecialCategories();
    const allCategories = { ...categories, ...specialCategories };
    const items = [];
    for (const [categoryId, category] of Object.entries(allCategories)) {
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

  getShopItems() {
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

  findShopItemByName(name) {
    const items = this.getShopItems();
    return items.find((item) => item.name === name) || null;
  }

  findShopItemById(id) {
    const items = this.getShopItems();
    return items.find((item) => item.id === id) || null;
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
    const item = this.findShopItemByName(itemName);
    if (!item) {
      return { success: false, msg: `商店里没有【${itemName}】这个商品哦~` };
    }

    if (!item.price || item.price <= 0) {
      return { success: false, msg: `【${item.name}】是非卖品，无法购买~` };
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
        msg: `樱花币不足！购买${count > 1 ? ` ${count} 个` : ""}【${item.name
          }】需要 ${totalPrice} 樱花币，你只有 ${coins}。`,
      };
    }

    economyManager.reduceCoins(e, totalPrice);

    const result = await this.handlePurchase(e, item, count);

    if (!result.success) {
      economyManager.addCoins(e, totalPrice);
      return result;
    }

    const msg = `🎉 购买成功！\n${count > 1 ? `${count} 个` : ""}【${item.name
      }】已到账！\n💰 花费：${totalPrice} 樱花币`;

    return {
      success: true,
      msg,
      item,
      count,
    };
  }

  async handlePurchase(e, item, count) {
    const inventoryManager = new InventoryManager(e);
    let itemId = item.name;
    if (item.type === 'equipment' || item.handler === 'fishing_bait' || item.handler === 'fishing_torpedo') {
      itemId = item.id;
    }

    const result = await inventoryManager.addItem(itemId, count);
    if (!result.success) {
      return result;
    }

    if (item.handler === 'fishing_rod' || item.handler === 'fishing_bait' || item.handler === 'fishing_line') {
      const FishingManager = (await import("./FishingManager.js")).default;
      const fishingManager = new FishingManager(e.group_id);

      if (item.handler === 'fishing_rod') {
        const currentRod = fishingManager.getEquippedRod(e.user_id);
        if (!currentRod) {
          fishingManager.equipRod(e.user_id, item.id);
        }
      } else if (item.handler === 'fishing_bait') {
        const currentBait = fishingManager.getEquippedBait(e.user_id);
        if (!currentBait) {
          fishingManager.equipBait(e.user_id, item.id);
        }
      } else if (item.handler === 'fishing_line') {
        const currentLine = fishingManager.getEquippedLine(e.user_id);
        if (!currentLine) {
          fishingManager.equipLine(e.user_id, item.id);
        }
      }
    }

    return {
      success: true,
      actualCount: count,
      msg: `🎉 购买成功！\n${count > 1 ? `${count} 个` : ""}【${item.name
        }】已到账！\n💰 花费：${item.price * count} 樱花币`,
      item,
      count,
    };
  }

  async checkEquipmentOwned(e, item) {
    const inventoryManager = new InventoryManager(e);
    let itemId = item.name;
    if (item.type === 'equipment') {
      itemId = item.id;
    }
    return inventoryManager.getItemCount(itemId) > 0;
  }

  handleBuffPurchase(e, item) {
    this.activateBuff(e.group_id, e.user_id, item);
    return { success: true };
  }

  getInventory(groupId, userId) {
    const inventoryManager = new InventoryManager({ group_id: groupId, user_id: userId });
    return inventoryManager.getInventory();
  }

  addToInventory(groupId, userId, itemName, count = 1) {
    const inventoryManager = new InventoryManager({ group_id: groupId, user_id: userId });
    inventoryManager.forceAddItem(itemName, count);
  }

  removeFromInventory(groupId, userId, itemName, count = 1) {
    const inventoryManager = new InventoryManager({ group_id: groupId, user_id: userId });
    return inventoryManager.removeItem(itemName, count);
  }

  hasItem(groupId, userId, itemName, count = 1) {
    const inventoryManager = new InventoryManager({ group_id: groupId, user_id: userId });
    return inventoryManager.getItemCount(itemName) >= count;
  }

  getActiveBuffs(groupId, userId) {
    const now = Date.now();
    const rows = db.prepare(`
        SELECT buff_id, name, effect, activated_at, expire_time
        FROM user_buffs
        WHERE group_id = ? AND user_id = ? AND expire_time > ?
    `).all(String(groupId), String(userId), now);

    const activeBuffs = {};
    for (const row of rows) {
      activeBuffs[row.buff_id] = {
        name: row.name,
        effect: JSON.parse(row.effect),
        activatedAt: row.activated_at,
        expireTime: row.expire_time
      };
    }
    return activeBuffs;
  }

  activateBuff(groupId, userId, item) {
    const now = Date.now();
    const expireTime = now + (item.duration || 3600) * 1000;

    db.prepare(`
        INSERT INTO user_buffs (group_id, user_id, buff_id, name, effect, activated_at, expire_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id, user_id, buff_id)
        DO UPDATE SET activated_at = ?, expire_time = ?
    `).run(
      String(groupId),
      String(userId),
      item.id,
      item.name,
      JSON.stringify(item.effect),
      now,
      expireTime,
      now,
      expireTime
    );
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
        "🏪 欢迎光临「樱神社商店」！\n\n💡 购买指令：购买商品名 数量",
    });

    for (const [categoryId, category] of Object.entries(categories)) {
      if (!category.items || category.items.length === 0) continue;

      let msg = `${category.name}\n${category.description}\n━━━━━━━━━━━━━━━━\n`;

      for (const item of category.items) {
        msg += `\n📦 ${item.name}\n`;
        msg += `💰 价格：${item.price} 樱花币\n`;
        if (item.type === "equipment") {
          msg += `🔧 类型：装备\n`;
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
