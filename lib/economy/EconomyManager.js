import fs from "node:fs"
import path from "node:path"
import { plugindata } from "../path.js"
import Setting from "../setting.js"

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

  getCoins(e) {
    const userId = this._initUser(e)
    return this.data[userId].coins
  }

  getLevel(e) {
    const userId = this._initUser(e)
    return this.data[userId].level
  }
  
  getExperience(e) {
      const userId = this._initUser(e)
      return this.data[userId].experience
  }

  checkRequirement(e, type, value) {
    const userId = this._initUser(e)
    if (type === 'coins') {
      return this.data[userId].coins >= value
    } else if (type === 'level') {
      return this.data[userId].level >= value
    }
    return false
  }

  addExperience(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].experience += amount
    this._updateLevel(userId)
    this._save()
  }

  reduceExperience(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].experience = Math.max(0, this.data[userId].experience - amount)
    this._updateLevel(userId)
    this._save()
  }

  addCoins(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].coins += amount
    this._save()
  }

  reduceCoins(e, amount) {
    const userId = this._initUser(e)
    this.data[userId].coins = Math.max(0, this.data[userId].coins - amount)
    this._save()
  }

  pay(e, amount) {
    if (!Array.isArray(this.config.Groups) || !this.config.Groups.includes(Number(this.groupId))) {
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

  transfer(e, toUserId, amount) {
    const fromUserId = this._initUser(e)
    const targetUserId = this._initUser({ user_id: toUserId })
    
    if (this.data[fromUserId].coins >= amount) {
      this.data[fromUserId].coins -= amount
      this.data[targetUserId].coins += amount
      this._save()
      return true
    }
    return false
  }

  getRanking(type, limit = 10) {
    const sorted = Object.keys(this.data).map(userId => ({
      userId,
      ...this.data[userId]
    })).sort((a, b) => b[type] - a[type])
    
    return sorted.slice(0, limit)
  }

  _updateLevel(userId) {
    const exp = this.data[userId].experience
    this.data[userId].level = Math.floor(Math.sqrt(exp / 100)) + 1
  }
}
