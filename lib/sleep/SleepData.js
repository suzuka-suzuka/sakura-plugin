import path from "node:path"
import fs from "node:fs"
import { plugindata } from "../path.js"

const dataPath = path.join(plugindata, "sleep")
if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true })
}

class SleepData {
  constructor() {
    this.file = path.join(dataPath, "sleep.json")
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, "{}")
    }
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"))
    } catch (error) {
      this.data = {}
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  getLogicDate() {
    return new Date(Date.now() - 4 * 60 * 60 * 1000).toLocaleDateString()
  }

  initGroupData(groupId) {
    if (!this.data[groupId] || !this.data[groupId].users) {
      this.data[groupId] = {
        date: this.getLogicDate(),
        sleepCount: 0,
        wakeCount: 0,
        users: {},
      }
    }
  }

  checkReset(groupId) {
    this.initGroupData(groupId)
    const logicDate = this.getLogicDate()
    if (this.data[groupId].date !== logicDate) {
      this.data[groupId].date = logicDate
      this.data[groupId].sleepCount = 0
      this.data[groupId].wakeCount = 0
      this.save()
    }
  }

  getUserData(groupId, userId) {
    groupId = String(groupId)
    userId = String(userId)

    this.checkReset(groupId)

    if (!this.data[groupId].users[userId]) {
      this.data[groupId].users[userId] = {
        sleepTime: 0,
        isSleeping: false,
        lastSleepSignDate: "",
        lastWakeSignDate: "",
        history: [],
      }
    }
    if (!this.data[groupId].users[userId].history) {
      this.data[groupId].users[userId].history = []
    }
    return this.data[groupId].users[userId]
  }

  setSleep(groupId, userId) {
    const userData = this.getUserData(groupId, userId)
    const today = this.getLogicDate()

    if (userData.lastSleepSignDate === today) {
      return false
    }

    userData.sleepTime = Date.now()
    userData.isSleeping = true
    userData.lastSleepSignDate = today

    this.data[groupId].sleepCount++
    const order = this.data[groupId].sleepCount

    this.save()
    return order
  }

  wakeUp(groupId, userId) {
    const userData = this.getUserData(groupId, userId)
    const today = this.getLogicDate()

    if (userData.lastWakeSignDate === today) {
      return false
    }

    let duration = null

    if (userData.isSleeping) {
      const sleepTime = userData.sleepTime
      const wakeTime = Date.now()
      const diff = wakeTime - sleepTime

      if (diff <= 24 * 60 * 60 * 1000) {
        duration = diff
        userData.history.push({
          date: today,
          duration: duration,
        })
        if (userData.history.length > 30) {
          userData.history = userData.history.slice(-30)
        }
      }
    }

    userData.isSleeping = false
    userData.lastWakeSignDate = today

    this.data[groupId].wakeCount++
    const order = this.data[groupId].wakeCount

    this.save()

    return { duration, order }
  }

  getHistory(groupId, userId) {
    const userData = this.getUserData(groupId, userId)
    return userData.history || []
  }
}

export const sleepData = new SleepData()
