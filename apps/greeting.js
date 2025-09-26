import moment from "moment"
import _ from "lodash"
import path from "path"
import fs from "fs/promises"
import { plugindata } from "../lib/path.js"
import { getAI } from "../lib/AIUtils/getAI.js"

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
    const Channel = "2.5"
    try {
      const result = await getAI(Channel, e, queryParts, systemInstruction, false, false, [])
      return result.text || "嗯嗯~"
    } catch (error) {
      logger.error(`[AI回复失败]`, error)
      return "嗯嗯~"
    }
  }

  async nightinfo(e) {
    const userId = e.user_id

    let userdata = (await this.readUserData(userId)) || {}

    const Member = e.bot.pickMember(e.group_id, userId)
    const Info = await Member.getInfo(true)
    const nickname = Info?.card || Info?.nickname || senderId || "未知用户"

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

    let replyMsg = `【${nickname}】的睡眠信息：\n`
    replyMsg += `性别：${sexDisplay}\n`
    replyMsg += `过去7天睡眠时长记录：\n`

    for (let i = 0; i < daylist.length; i++) {
      replyMsg += `${daylist[i]}: ${ntimelist[i]} 小时\n`
    }

    replyMsg += `平均睡眠时长：${average} 小时`

    e.reply(replyMsg)
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
    const todayData = userdata[moment().format("YYYY-MM-DD")]
    const yesterdayData = userdata[moment().subtract(1, "days").format("YYYY-MM-DD")]
    const lastNtime = todayData?.ntime || yesterdayData?.ntime

    if (lastNtime) {
      const sleepDuration = moment().diff(moment(lastNtime), "hours")
      if (sleepDuration < 4) {
        return this.getAIReply(e, e.msg).then(aiReply => e.reply(aiReply, true))
      }
    }

    if (e.msg === "早安" && !monightlist[groupId].mlist.includes(userId)) {
      let userdata = (await this.readUserData(userId)) || {}
      const today = moment().format("YYYY-MM-DD")

      userdata[today] = {
        ...userdata[today],
        mtime: moment().toISOString(),
      }
      await this.saveUserData(userId, userdata)

      const daydata = userdata[today]
      monightlist[groupId].mnum += 1
      monightlist[groupId].mlist.push(userId)

      let msg = ""
      if (
        daydata.ntime &&
        (moment(daydata.ntime).date() === moment().subtract(1, "d").date() ||
          moment(daydata.ntime).date() === moment().date())
      ) {
        msg = `早安成功！你的睡眠时长为${this.update(daydata.ntime, moment().toISOString())},`
      }
      return e.reply(msg + `你是本群今天第${monightlist[groupId].mnum}个起床的！`, true)
    }

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
    const todayData = userdata[moment().format("YYYY-MM-DD")]
    const lastMtime = todayData?.mtime

    if (lastMtime) {
      const awakeDuration = moment().diff(moment(lastMtime), "hours")
      if (awakeDuration < 4) {
        return this.getAIReply(e, e.msg).then(aiReply => e.reply(aiReply, true))
      }
    }

    if (e.msg === "晚安" && !monightlist[groupId].nlist.includes(userId)) {
      let userdata = (await this.readUserData(userId)) || {}
      const today = moment().format("YYYY-MM-DD")

      userdata[today] = {
        ...userdata[today],
        ntime: moment().toISOString(),
      }
      await this.saveUserData(userId, userdata)

      const daydata = userdata[today]
      monightlist[groupId].nnum += 1
      monightlist[groupId].nlist.push(userId)

      let msg = ""
      if (
        daydata.mtime &&
        (moment(daydata.mtime).date() === moment().date() ||
          moment(daydata.mtime).date() === moment().add(1, "d").date())
      ) {
        msg = `晚安成功！你的清醒时长为${this.update(daydata.mtime, moment().toISOString())},`
      }
      return e.reply(msg + `你是本群今天第${monightlist[groupId].nnum}个睡觉的！`, true)
    }

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
