import path from "node:path"
import fs from "node:fs"
import { plugindata } from "../path.js"

const dataPath = path.join(plugindata, "sleep")
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const LOGIC_DAY_OFFSET_MS = 4 * HOUR_MS
const SHORT_SLEEP_MS = 4 * HOUR_MS
const LONG_SLEEP_MS = 24 * HOUR_MS
const LOGIC_TIME_ZONE = "Asia/Shanghai"
const logicDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: LOGIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function formatLogicDate(timestamp) {
  const parts = logicDateFormatter.formatToParts(new Date(timestamp - LOGIC_DAY_OFFSET_MS))

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function parseStoredDate(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(value || ""))
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export class SleepData {
  constructor({ directory = dataPath, now = () => Date.now() } = {}) {
    this.dataPath = directory
    this.now = now
    fs.mkdirSync(this.dataPath, { recursive: true })
  }

  getGroupFile(groupId) {
    return path.join(this.dataPath, `${groupId}.json`)
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

  getLogicDate(timestamp = this.now()) {
    return formatLogicDate(timestamp)
  }

  checkReset(groupData, timestamp = this.now()) {
    const logicDate = this.getLogicDate(timestamp)

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
    const now = this.now()
    const groupData = this.getGroupData(groupId)
    this.checkReset(groupData, now)

    const userData = this.getOrCreateUser(groupData, userId)
    const today = this.getLogicDate(now)

    if (userData.lastSleepSignDate === today) {
      return false
    }

    userData.sleepTime = now
    userData.isSleeping = true
    userData.lastSleepSignDate = today

    groupData.sleepCount++
    const order = groupData.sleepCount

    this.saveGroupData(groupId, groupData)
    return order
  }

  wakeUp(groupId, userId) {
    groupId = String(groupId)
    const wakeTime = this.now()
    const groupData = this.getGroupData(groupId)
    this.checkReset(groupData, wakeTime)

    const userData = this.getOrCreateUser(groupData, userId)
    const today = this.getLogicDate(wakeTime)

    if (!userData.isSleeping) {
      return false
    }

    const sleepTime = Number(userData.sleepTime)
    const duration = wakeTime - sleepTime
    if (!Number.isFinite(sleepTime) || sleepTime <= 0 || duration <= 0) {
      return false
    }

    const status = duration < SHORT_SLEEP_MS
      ? "short"
      : duration > LONG_SLEEP_MS
        ? "long"
        : "normal"

    userData.history.push({
      date: today,
      sleepTime,
      wakeTime,
      duration,
      status,
    })

    const todayDate = parseStoredDate(today)
    userData.history = userData.history.filter(h => {
      const historyDate = parseStoredDate(h.date)
      return Number.isFinite(historyDate) && todayDate - historyDate < 7 * DAY_MS
    })

    userData.isSleeping = false

    let order = null
    if (userData.lastWakeSignDate !== today) {
      userData.lastWakeSignDate = today
      groupData.wakeCount++
      order = groupData.wakeCount
    }

    this.saveGroupData(groupId, groupData)

    return { duration, order, status }
  }

  getHistory(groupId, userId) {
    const groupData = this.getGroupData(groupId)
    const userData = this.getOrCreateUser(groupData, userId)
    return userData.history || []
  }
}

export const sleepData = new SleepData()
