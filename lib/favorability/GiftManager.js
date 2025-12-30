import fs from "fs";
import path from "path";
import { plugindata } from "../path.js";
import EconomyManager from "../economy/EconomyManager.js";
import FavorabilityManager from "./FavorabilityManager.js";
import Setting from "../setting.js";

const inventoryPath = path.join(plugindata, "economy", "inventory");

if (!fs.existsSync(inventoryPath)) {
  fs.mkdirSync(inventoryPath, { recursive: true });
}

class GiftManager {
  constructor() {
  }

  getGift(name) {
    const gifts = this.getAllGifts();
    return gifts ? gifts.find((g) => g.name === name) : null;
  }

  getAllGifts() {
    return Setting.getEconomy('gifts') || [];
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

  addGift(groupId, userId, giftName, count = 1) {
    const file = this.getInventoryFile(groupId);
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {}
    }

    const uid = String(userId);
    if (!data[uid]) data[uid] = {};
    if (!data[uid][giftName]) data[uid][giftName] = 0;
    data[uid][giftName] += count;

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  removeGift(groupId, userId, giftName, count = 1) {
    const file = this.getInventoryFile(groupId);
    if (!fs.existsSync(file)) return false;

    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      return false;
    }

    const uid = String(userId);
    if (!data[uid] || !data[uid][giftName] || data[uid][giftName] < count) {
      return false;
    }

    data[uid][giftName] -= count;
    if (data[uid][giftName] <= 0) {
      delete data[uid][giftName];
    }

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  }

  async buyGift(e, giftName) {
    const gift = this.getGift(giftName);
    if (!gift) return { success: false, msg: "没有这个礼物哦~" };

    const economyManager = new EconomyManager(e);
    const coins = economyManager.getCoins(e);

    if (coins < gift.price) {
      return { success: false, msg: `你的樱花币不足哦，需要 ${gift.price} 樱花币` };
    }

    economyManager.reduceCoins(e, gift.price);
    this.addGift(e.group_id, e.user_id, giftName);

    return { success: true, msg: `成功购买了 ${giftName}！` };
  }

  async sendGift(e, giftName, targetId) {
    const gift = this.getGift(giftName);
    if (!gift) return { success: false, msg: "没有这个礼物哦~" };

    const hasGift = this.removeGift(e.group_id, e.user_id, giftName);
    if (!hasGift) {
      return { success: false, msg: "你还没有这个礼物哦，快去买一个吧~" };
    }

    FavorabilityManager.addFavorability(e.group_id, targetId, e.user_id, gift.favorability);

    return { success: true, msg: `成功送出了 ${giftName}，好感度 +${gift.favorability}！` };
  }
}

export default new GiftManager();
