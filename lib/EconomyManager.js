import fs from "node:fs"
import path from "node:path"
import { plugindata } from "./path.js"
import Setting from "./setting.js"

const economyPath = path.join(plugindata, "economy")
if (!fs.existsSync(economyPath)) {
  fs.mkdirSync(economyPath, { recursive: true })
}

export default class EconomyManager {
  constructor(e) {
    this.groupId = e.group_id
    if (this.groupId) {
      this.file = path.join(economyPath, `${this.groupId}.json`)
      this.data = this._load()
    } else {
      this.data = {}
    }
    this.config = Setting.getConfig("economy")
  }

  _load() {
    if (this.file && fs.existsSync(this.file)) {
      return JSON.parse(fs.readFileSync(this.file, "utf8"))
    }
    return {}
  }

  _save() {
    if (this.file) {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    }
  }

  _initUser(e) {
    const userId = e.user_id
    // 如果是私聊（无群号），强制重置数据为初始值，确保操作无效且返回0
    if (!this.groupId) {
      this.data[userId] = {
        coins: 0,
        experience: 0,
        level: 1
      }
      return userId
    }

    if (!this.data[userId]) {
      this.data[userId] = {
        coins: 0,
        experience: 0,
        level: 1
      }
    }
    return userId
  }

  // 获取金币
  getCoins(e) {
    const userId = this._initUser(e)
    return this.data[userId].coins
  }

  // 获取等级
  getLevel(e) {
    const userId = this._initUser(e)
    return this.data[userId].level
  }
  
  // 获取经验
  getExperience(e) {
      const userId = this._initUser(e)
      return this.data[userId].experience
  }

  // 判断金币或等级是否符合
  checkRequirement(e, type, value) {
    const userId = this._initUser(e)
    if (type === 'coins') {
      return this.data[userId].coins >= value
    } else if (type === 'level') {
      return this.data[userId].level >= value
    }
    return false
  }

  // 增加经验
  addExperience(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].experience += amount
    this._updateLevel(userId)
    this._save()
  }

  // 减少经验
  reduceExperience(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].experience = Math.max(0, this.data[userId].experience - amount)
    this._updateLevel(userId)
    this._save()
  }

  // 增加金币
  addCoins(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].coins += amount
    this._save()
  }

  // 减少金币
  reduceCoins(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].coins = Math.max(0, this.data[userId].coins - amount)
    this._save()
  }

  // 检查金币数量是否足够后扣除相应金币
  pay(e, amount) {
    // 如果经济系统未开启，直接返回 true，不扣费
    if (!this.config.enable) {
      return true
    }

    const userId = this._initUser(e)
    if (this.data[userId].coins >= amount) {
      this.data[userId].coins -= amount
      this._save()
      return true
    }
    return false
  }

  // 转账
  transfer(e, toUserId, amount) {
    const fromUserId = this._initUser(e)
    // 构造一个临时对象以复用 _initUser 逻辑，因为 toUserId 只是一个 ID
    const targetUserId = this._initUser({ user_id: toUserId })
    
    if (this.data[fromUserId].coins >= amount) {
      this.data[fromUserId].coins -= amount
      this.data[targetUserId].coins += amount
      this._save()
      return true
    }
    return false
  }

  // 排行榜
  getRanking(type, limit = 10) {
    // type: 'coins' or 'level' or 'experience'
    const sorted = Object.keys(this.data).map(userId => ({
      userId,
      ...this.data[userId]
    })).sort((a, b) => b[type] - a[type])
    
    return sorted.slice(0, limit)
  }

  // 内部方法：根据经验更新等级
  _updateLevel(userId) {
    const exp = this.data[userId].experience
    this.data[userId].level = Math.floor(Math.sqrt(exp / 100)) + 1
  }
}
