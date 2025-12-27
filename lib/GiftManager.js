import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { plugindata, pluginresources } from "./path.js";
import EconomyManager from "./EconomyManager.js";
import FavorabilityManager from "./FavorabilityManager.js";

const inventoryPath = path.join(plugindata, "economy", "inventory");
const giftConfigPath = path.join(pluginresources, "economy", "gifts.yaml");

if (!fs.existsSync(inventoryPath)) {
  fs.mkdirSync(inventoryPath, { recursive: true });
}

class GiftManager {
  constructor() {
    this.gifts = [];
    this.loadConfig();
  }

  loadConfig() {
    if (fs.existsSync(giftConfigPath)) {
      try {
        const file = fs.readFileSync(giftConfigPath, "utf8");
        this.gifts = yaml.load(file);
      } catch (err) {
        console.error(`[礼物系统] 读取配置文件失败: ${err}`);
      }
    }
  }

  getGift(name) {
    return this.gifts.find((g) => g.name === name);
  }

  getAllGifts() {
    return this.gifts;
  }

  getInventoryFile(groupId) {
    return path.join(inventoryPath, `${groupId}.json`);
  }

  getInventory(groupId, userId) {
    const file = this.getInventoryFile(groupId);
    if (!fs.existsSync(file)) return {};
    
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return data[userId] || {};
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

    if (!data[userId]) data[userId] = {};
    if (!data[userId][giftName]) data[userId][giftName] = 0;
    data[userId][giftName] += count;

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

    if (!data[userId] || !data[userId][giftName] || data[userId][giftName] < count) {
      return false;
    }

    data[userId][giftName] -= count;
    if (data[userId][giftName] <= 0) {
      delete data[userId][giftName];
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

    FavorabilityManager.addFavorability(e.group_id, e.user_id, targetId, gift.favorability);

    return { success: true, msg: `成功送出了 ${giftName}，好感度 +${gift.favorability}！` };
  }
}

export default new GiftManager();
