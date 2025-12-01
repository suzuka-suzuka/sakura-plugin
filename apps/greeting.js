import moment from "moment"
import _ from "lodash"
import path from "path"
import fs from "fs/promises"
import { createCanvas } from "@napi-rs/canvas"
import { plugindata } from "../lib/path.js"
import { getAI } from "../lib/AIUtils/getAI.js"
import Setting from "../lib/setting.js"

let monightlist = {}

export class greeting extends plugin {
  constructor() {
    super({
      name: "早晚安",
      dsc: "群内早安晚安打卡及睡眠信息查询",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^(早|早安|早上好)$",
          fnc: "morning",
          log: false,
        },
        {
          reg: "^(睡觉|晚安|好梦)$",
          fnc: "night",
          log: false,
        },
        {
          reg: "^睡眠信息$",
          fnc: "nightinfo",
          log: false,
        },
      ],
    })

    this.dataDir = path.join(plugindata, "greeting")
    this.initDirectories()
  }

  task = {
    name: "clearTime",
    fnc: () => this.clearTime(),
    cron: "10 0 0 * * ?",
  }

  async initDirectories() {
    await this.mkdir(this.dataDir)
  }

  async getAIReply(e, promptText) {
    let systemInstruction = `你是一个元气萝莉，有点小迷糊但很热情。你的核心任务是判断我发的消息（如'早'、'晚安'）是否符合当前时间。如果符合，就正常地用元气满满的口语回复；如果不符合，就要根据当前时间用俏皮、疑惑或吐槽的语气来回应这不合时宜的问候。回复必须非常简短。当前时间是：${moment().format("HH:mm")}。`
    const queryParts = [{ text: promptText }]
    const Channel = Setting.getConfig("AI").appschannel
    try {
      const result = await getAI(Channel, e, queryParts, systemInstruction, false, false, [])
      return result.text || "嗯嗯~"
    } catch (error) {
      logger.error(`[AI回复失败]`, error)
      return "嗯嗯~"
    }
  }

  async nightinfo(e) {
    let userdata = (await this.readUserData(e.user_id)) || {}
    let Info
    try {
      Info = e.group.pickMember(e.user_id).getInfo(true)
    } catch (error) {
      Info = (await e.group.pickMember(Number(e.user_id))).info
    }
    const nickname =
      Info?.card || Info?.nickname || e.sender.card || e.sender.nickname || "未知用户"

    let sexDisplay = "魅魔小萝莉"
    if (Info.sex === "male") {
      sexDisplay = "男"
    } else if (Info.sex === "female") {
      sexDisplay = "女"
    }

    const { daylist, ntimelist } = this.getdiffHours(userdata)

    let totalSleepHours = 0
    let validSleepDays = 0

    for (const hours of ntimelist) {
      if (hours > 0) {
        totalSleepHours += hours
        validSleepDays++
      }
    }
    const average = validSleepDays > 0 ? (totalSleepHours / validSleepDays).toFixed(1) : 0

    const width = 800
    const height = 600
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext("2d")

    ctx.fillStyle = "#f0f2f5"
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = "#333"
    ctx.font = "bold 30px sans-serif"
    ctx.textAlign = "center"
    ctx.fillText(`${nickname} 的睡眠报告`, width / 2, 50)

    ctx.font = "20px sans-serif"
    ctx.fillStyle = "#666"
    ctx.fillText(`性别: ${sexDisplay}   平均睡眠: ${average} 小时`, width / 2, 90)

    const chartX = 80
    const chartY = 120
    const chartWidth = 640
    const chartHeight = 400

    ctx.beginPath()
    ctx.strokeStyle = "#999"
    ctx.lineWidth = 2
    ctx.moveTo(chartX, chartY)
    ctx.lineTo(chartX, chartY + chartHeight)
    ctx.lineTo(chartX + chartWidth, chartY + chartHeight)
    ctx.stroke()

    const maxHour = Math.max(12, ...ntimelist) + 2
    ctx.textAlign = "right"
    ctx.font = "14px sans-serif"
    ctx.fillStyle = "#666"
    for (let i = 0; i <= maxHour; i += 2) {
      const y = chartY + chartHeight - (i / maxHour) * chartHeight
      ctx.fillText(i.toString(), chartX - 10, y + 5)
      ctx.beginPath()
      ctx.strokeStyle = "#e0e0e0"
      ctx.lineWidth = 1
      ctx.moveTo(chartX, y)
      ctx.lineTo(chartX + chartWidth, y)
      ctx.stroke()
    }

    const barWidth = 40
    const gap = (chartWidth - barWidth * daylist.length) / (daylist.length + 1)

    daylist.forEach((day, index) => {
      const hours = ntimelist[index]
      const barHeight = (hours / maxHour) * chartHeight
      const x = chartX + gap + index * (barWidth + gap)
      const y = chartY + chartHeight - barHeight

      if (hours < 6) ctx.fillStyle = "#ff6b6b"
      else if (hours > 9) ctx.fillStyle = "#fcc419"
      else ctx.fillStyle = "#51cf66"

      ctx.fillRect(x, y, barWidth, barHeight)

      if (hours > 0) {
        ctx.fillStyle = "#333"
        ctx.textAlign = "center"
        ctx.fillText(hours.toString(), x + barWidth / 2, y - 10)
      }

      ctx.fillStyle = "#666"
      ctx.textAlign = "center"
      ctx.fillText(day, x + barWidth / 2, chartY + chartHeight + 25)
    })

    if (average > 0) {
      const avgY = chartY + chartHeight - (average / maxHour) * chartHeight
      ctx.beginPath()
      ctx.strokeStyle = "#339af0"
      ctx.lineWidth = 2
      ctx.setLineDash([10, 5])
      ctx.moveTo(chartX, avgY)
      ctx.lineTo(chartX + chartWidth, avgY)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = "#339af0"
      ctx.textAlign = "left"
      ctx.fillText(`Avg: ${average}h`, chartX + chartWidth + 5, avgY + 5)
    }

    const buffer = await canvas.encode("png")
    e.reply(segment.image(buffer))
  }

  async morning(e) {
    const groupId = e.group_id
    const userId = e.user_id

    if (!monightlist[groupId]) {
      monightlist[groupId] = {
        mlist: [],
        mnum: 0,
        nlist: [],
        nnum: 0,
      }
    }

    if (monightlist[groupId].mlist.includes(userId)) {
      return
    }

    let userdata = (await this.readUserData(userId)) || {}
    const today = moment().format("YYYY-MM-DD")
    const todayData = userdata[today] || {}
    const yesterdayData = userdata[moment().subtract(1, "days").format("YYYY-MM-DD")] || {}

    const lastNtime = userdata.last_sleep_time || todayData.ntime || yesterdayData.ntime

    if (lastNtime) {
      const sleepDuration = moment().diff(moment(lastNtime), "hours")
    }

    if (!monightlist[groupId].mlist.includes(userId)) {
      userdata[today] = {
        ...todayData,
        mtime: moment().toISOString(),
      }
      userdata.last_wake_time = moment().toISOString()

      await this.saveUserData(userId, userdata)

      monightlist[groupId].mnum += 1
      monightlist[groupId].mlist.push(userId)

      let msg = ""
      if (lastNtime) {
        msg = `早安成功！你的睡眠时长为${this.update(lastNtime, moment().toISOString())},`
      }

      if (lastNtime) {
        const sleepHours = moment().diff(moment(lastNtime), "hours")
        if (sleepHours < 4) {
        }
      }

      return e.reply(msg + `你是本群今天第${monightlist[groupId].mnum}个起床的！`, true)
    }

    const cdKey = `sakura:greeting:ai_cd:${groupId}`
    if (await redis.get(cdKey)) {
      return
    }
    await redis.set(cdKey, "1", { EX: 300 })
    const promptText = e.msg
    const aiReply = await this.getAIReply(e, promptText)
    e.reply(aiReply, true)
  }

  async night(e) {
    const groupId = e.group_id
    const userId = e.user_id

    if (!monightlist[groupId]) {
      monightlist[groupId] = {
        mlist: [],
        mnum: 0,
        nlist: [],
        nnum: 0,
      }
    }

    if (monightlist[groupId].nlist.includes(userId)) {
      return
    }

    let userdata = (await this.readUserData(userId)) || {}
    const today = moment().format("YYYY-MM-DD")
    const todayData = userdata[today] || {}

    const lastMtime = userdata.last_wake_time || todayData.mtime

    if (lastMtime) {
      const awakeDuration = moment().diff(moment(lastMtime), "hours")
    }

    if (!monightlist[groupId].nlist.includes(userId)) {
      userdata[today] = {
        ...todayData,
        ntime: moment().toISOString(),
      }
      userdata.last_sleep_time = moment().toISOString()

      await this.saveUserData(userId, userdata)

      monightlist[groupId].nnum += 1
      monightlist[groupId].nlist.push(userId)

      let msg = ""
      if (lastMtime) {
        msg = `晚安成功！你的清醒时长为${this.update(lastMtime, moment().toISOString())},`
      }
      return e.reply(msg + `你是本群今天第${monightlist[groupId].nnum}个睡觉的！`, true)
    }

    const cdKey = `sakura:greeting:ai_cd:${groupId}`
    if (await redis.get(cdKey)) {
      return
    }
    await redis.set(cdKey, "1", { EX: 300 })
    const promptText = e.msg
    const aiReply = await this.getAIReply(e, promptText)
    e.reply(aiReply, true)
  }

  clearTime() {
    monightlist = {}
    logger.info("[早晚安插件] 每日打卡记录已清空。")
  }

  getdiffHours(data) {
    if (!data) return { daylist: [], ntimelist: [] }

    let daylist = []
    let ntimelist = []
    const today = moment()

    for (let i = 6; i >= 0; i--) {
      const date = today.clone().subtract(i, "days")
      const formattedDate = date.format("YYYY-MM-DD")
      const t = data[formattedDate]

      daylist.push(`${date.date()}日`)

      if (!t || !t.mtime) {
        ntimelist.push(0)
        continue
      }

      let sleepDuration = 0
      if (t.ntime) {
        const m = moment(t.mtime)
        const n = moment(t.ntime)

        if (m.isAfter(n)) {
          sleepDuration = this.diffTime(m, n)
        } else {
          const yesterdayData =
            data[
              today
                .clone()
                .subtract(i + 1, "days")
                .format("YYYY-MM-DD")
            ]
          if (yesterdayData && yesterdayData.ntime) {
            sleepDuration = this.diffTime(m, moment(yesterdayData.ntime))
          }
        }
      } else {
        const yesterdayData =
          data[
            today
              .clone()
              .subtract(i + 1, "days")
              .format("YYYY-MM-DD")
          ]
        if (yesterdayData && yesterdayData.ntime) {
          const m = moment(t.mtime)
          const n = moment(yesterdayData.ntime)
          if (m.diff(n, "hours") < 36) {
            sleepDuration = this.diffTime(m, n)
          }
        }
      }
      ntimelist.push(sleepDuration)
    }
    return { daylist, ntimelist }
  }

  diffTime(date1, date2) {
    const diffMs = moment(date1).diff(moment(date2))
    const hours = moment.duration(diffMs).asHours()
    return Math.abs(hours.toFixed(1))
  }

  update(startTime, endTime) {
    const diffMs = moment(endTime).diff(moment(startTime))
    const duration = moment.duration(diffMs)

    const hours = duration.hours()
    const minutes = duration.minutes()
    const seconds = duration.seconds()

    return `${hours}时${minutes}分${seconds}秒`
  }

  async readUserData(userId) {
    const filePath = path.join(this.dataDir, `${userId}.json`)
    try {
      const data = await fs.readFile(filePath, "utf8")
      return JSON.parse(data)
    } catch (error) {
      if (error.code === "ENOENT") {
        return {}
      }
      logger.error(`读取用户 ${userId} 数据失败: ${error.message}`)
      return {}
    }
  }

  async saveUserData(userId, data) {
    const filePath = path.join(this.dataDir, `${userId}.json`)
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8")
    } catch (error) {
      logger.error(`保存用户 ${userId} 数据失败: ${error.message}`)
    }
  }

  async mkdir(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      if (error.code !== "EEXIST") {
        logger.error(`创建目录 ${dirPath} 失败: ${error.message}`)
      }
    }
  }
}
