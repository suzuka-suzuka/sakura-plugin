import path from "node:path"
import fs from "node:fs"
import { plugindata } from "../path.js"

const dataPath = path.join(plugindata, "sleep")
if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true })
}

class SleepData {
  getGroupFile(groupId) {
    return path.join(dataPath, `${groupId}.json`)
  }

  getGroupData(groupId) {
    groupId = String(groupId)
    const file = this.getGroupFile(groupId)
    let data
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"))
      } catch (error) {
        data = {}
      }
    } else {
      data = {}
    }

    if (!data.users) {
      data = {
        date: this.getLogicDate(),
        sleepCount: 0,
        wakeCount: 0,
        users: {},
      }
    }

    return data
  }

  saveGroupData(groupId, data) {
    groupId = String(groupId)
    const file = this.getGroupFile(groupId)
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  }

  getLogicDate() {
    return new Date(Date.now() - 4 * 60 * 60 * 1000).toLocaleDateString()
  }

  checkReset(groupData) {
    const logicDate = this.getLogicDate()

    if (groupData.date !== logicDate) {
      groupData.date = logicDate
      groupData.sleepCount = 0
      groupData.wakeCount = 0
    }
    return groupData
  }

  getOrCreateUser(groupData, userId) {
    userId = String(userId)
    if (!groupData.users[userId]) {
      groupData.users[userId] = {
        sleepTime: 0,
        isSleeping: false,
        lastSleepSignDate: "",
        lastWakeSignDate: "",
        history: [],
      }
    }
    if (!groupData.users[userId].history) {
      groupData.users[userId].history = []
    }
    return groupData.users[userId]
  }

  setSleep(groupId, userId) {
    groupId = String(groupId)
    const groupData = this.getGroupData(groupId)
    this.checkReset(groupData)
    
    const userData = this.getOrCreateUser(groupData, userId)
    const today = this.getLogicDate()

    if (userData.lastSleepSignDate === today) {
      return false
    }

    userData.sleepTime = Date.now()
    userData.isSleeping = true
    userData.lastSleepSignDate = today

    groupData.sleepCount++
    const order = groupData.sleepCount

    this.saveGroupData(groupId, groupData)
    return order
  }

  wakeUp(groupId, userId) {
    groupId = String(groupId)
    const groupData = this.getGroupData(groupId)
    this.checkReset(groupData)

    const userData = this.getOrCreateUser(groupData, userId)
    const today = this.getLogicDate()

    if (userData.lastWakeSignDate === today) {
      return false
    }

    let duration = null

    if (userData.isSleeping) {
      const sleepTime = userData.sleepTime
      const wakeTime = Date.now()
      const diff = wakeTime - sleepTime

      if (diff < 4 * 60 * 60 * 1000) {
        return false
      }

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

    groupData.wakeCount++
    const order = groupData.wakeCount

    this.saveGroupData(groupId, groupData)

    return { duration, order }
  }

  getHistory(groupId, userId) {
    const groupData = this.getGroupData(groupId)
    const userData = this.getOrCreateUser(groupData, userId)
    return userData.history || []
  }
}

export const sleepData = new SleepData()
