import plugin from "../../../lib/plugins/plugin.js"
import fs from "fs"
import path from "path"
import { plugindata } from "../lib/path.js"
import adapter from "../lib/adapter.js"
import FavorabilityImageGenerator from "../lib/favorability/ImageGenerator.js"

const dataPath = path.join(plugindata, "favorability")

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true })
}

const lastSender = new Map()

export class Favorability extends plugin {
  constructor() {
    super({
      name: "好感度",
      dsc: "记录群友之间的好感度",
      event: "message.group",
      priority: 35,
      rule: [
        {
          reg: "^#?好感度.*$",
          fnc: "queryFavorability",
          log: false,
        },
        {
          reg: "^#?(谁在意我|喜欢我的人)$",
          fnc: "whoLikesMe",
          log: false,
        },
        {
          reg: "^#?(我在意谁|我喜欢的人)$",
          fnc: "whoILike",
          log: false,
        },
      ],
    })
  }

  getDataFile(groupId) {
    return path.join(dataPath, `${groupId}.json`)
  }

  readData(groupId) {
    const file = this.getDataFile(groupId)
    if (!fs.existsSync(file)) {
      return { favorability: {}, lastUpdate: {} }
    }
    try {
      const data = fs.readFileSync(file, "utf-8")
      return JSON.parse(data)
    } catch (err) {
      logger.error(`[好感度] 读取数据失败: ${err}`)
      return { favorability: {}, lastUpdate: {} }
    }
  }

  saveData(groupId, data) {
    const file = this.getDataFile(groupId)
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8")
    } catch (err) {
      logger.error(`[好感度] 保存数据失败: ${err}`)
    }
  }

  addFavorability(groupId, from, to, value) {
    const data = this.readData(groupId)

    if (!data.favorability) {
      data.favorability = {}
    }
    if (!data.lastUpdate) {
      data.lastUpdate = {}
    }

    if (!data.favorability[from]) {
      data.favorability[from] = {}
    }

    if (!data.favorability[from][to]) {
      data.favorability[from][to] = 0
    }

    data.favorability[from][to] += value

    if (!data.lastUpdate[from]) {
      data.lastUpdate[from] = {}
    }
    data.lastUpdate[from][to] = Date.now()

    this.saveData(groupId, data)
  }

  getFavorability(groupId, from, to) {
    const data = this.readData(groupId)
    return data.favorability[from]?.[to] || 0
  }

  checkAndDecayFavorability(groupId) {
    const data = this.readData(groupId)

    if (!data.favorability) {
      data.favorability = {}
    }
    if (!data.lastUpdate) {
      data.lastUpdate = {}
    }

    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000
    let hasChange = false

    for (const from in data.favorability) {
      if (!data.lastUpdate[from]) {
        data.lastUpdate[from] = {}
      }

      for (const to in data.favorability[from]) {
        const lastUpdate = data.lastUpdate[from][to] || 0
        if (now - lastUpdate > oneDayMs) {
          data.favorability[from][to] -= 10
          data.lastUpdate[from][to] = now
          hasChange = true
        }
      }
    }

    if (hasChange) {
      this.saveData(groupId, data)
    }
  }

  applyConsecutiveMessagePenalty(groupId, userId) {
    const data = this.readData(groupId)

    if (!data.favorability[userId]) {
      return
    }

    let hasChange = false
    for (const targetUser in data.favorability[userId]) {
      data.favorability[userId][targetUser] -= 1
      hasChange = true
    }

    if (hasChange) {
      this.saveData(groupId, data)
    }
  }

  async accept(e) {
    if (/^#?好感度.*$/.test(e.msg)) {
      return false
    }

    if (/^#?(谁在意我|喜欢我的人|我在意谁|我喜欢的人)$/.test(e.msg)) {
      return false
    }

    const groupId = e.group_id.toString()
    const currentSender = e.user_id.toString()

    this.checkAndDecayFavorability(groupId)

    let targetUsers = []
    let shouldAddFavorability = false

    const atMsgs = e.message?.filter(
      msg => msg.type === "at" && msg.qq && !isNaN(msg.qq) && msg.qq !== e.self_id,
    )
    if (atMsgs && atMsgs.length > 0) {
      targetUsers = [...new Set(atMsgs.map(msg => msg.qq.toString()))].filter(qq => qq !== currentSender)

      if (targetUsers.length > 0) {
        shouldAddFavorability = true
      }
    }

    if (targetUsers.length === 0) {
      const replySegment = e.message?.find(segment => segment.type === "reply")

      if (adapter === 0 && e.source) {
        const reply = (await e.group.getChatHistory(e.source.seq, 1)).pop()

        if (reply && reply.user_id) {
          const sourceUserId = reply.user_id.toString()
          if (sourceUserId !== currentSender) {
            targetUsers.push(sourceUserId)
            shouldAddFavorability = true
          }
        }
      } else if (replySegment?.id) {
        try {
          const sourceMessageData = await e.group.getMsg(replySegment.id)

          if (sourceMessageData?.user_id) {
            const sourceUserId = sourceMessageData.user_id.toString()
            if (sourceUserId !== currentSender) {
              targetUsers.push(sourceUserId)
              shouldAddFavorability = true
            }
          }
        } catch (err) {}
      }
    }

    const lastSenderInGroup = lastSender.get(groupId)
    if (lastSenderInGroup === currentSender && !shouldAddFavorability) {
      this.applyConsecutiveMessagePenalty(groupId, currentSender)
    }

    if (shouldAddFavorability && targetUsers.length > 0) {
      for (const targetUser of targetUsers) {
        this.addFavorability(groupId, currentSender, targetUser, 2)
      }
    } else if (lastSenderInGroup && lastSenderInGroup !== currentSender) {
      this.addFavorability(groupId, currentSender, lastSenderInGroup, 1)
    }

    lastSender.set(groupId, currentSender)

    return false
  }

  async queryFavorability(e) {
    const groupId = e.group_id.toString()
    const currentUser = e.user_id.toString()

    let targetUser = null
    const atMsg = e.message?.find(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
    if (atMsg) {
      targetUser = atMsg.qq.toString()
    }

    if (!targetUser) {
      return false
    }


    const favorabilityAtoB = this.getFavorability(groupId, currentUser, targetUser)
    const favorabilityBtoA = this.getFavorability(groupId, targetUser, currentUser)

    const currentUserName = e.member?.card || e.member?.nickname || currentUser

    let targetUserName = targetUser
    try {
      let targetInfo
      try {
        targetInfo = await e.group.pickMember(targetUser).getInfo(true)
      } catch {
        targetInfo = (await e.group.pickMember(Number(targetUser))).info
      }
      targetUserName = targetInfo?.card || targetInfo?.nickname || targetUser
    } catch (err) {
      logger.error(`[好感度] 获取用户 ${targetUser} 信息失败:`, err)
    }

    const generator = new FavorabilityImageGenerator()
    const imageBuffer = await generator.generate(
      currentUserName,
      targetUserName,
      favorabilityAtoB,
      favorabilityBtoA,
      currentUser,
      targetUser,
    )

    await e.reply(segment.image(imageBuffer))
    return true
  }

  async whoLikesMe(e) {
    const groupId = e.group_id.toString()
    const currentUser = e.user_id.toString()
    const data = this.readData(groupId)

    const othersToMe = []
    for (const fromUser in data.favorability) {
      if (data.favorability[fromUser][currentUser] !== undefined) {
        othersToMe.push({
          userId: fromUser,
          favorability: data.favorability[fromUser][currentUser],
        })
      }
    }
    othersToMe.sort((a, b) => b.favorability - a.favorability)

    if (othersToMe.length === 0) {
      await e.reply("还没有人对你有好感哦~")
      return true
    }

    const top10 = othersToMe.slice(0, 10)
    const rankingData = []
    for (const item of top10) {
      const userName = await this.getUserName(e, item.userId)
      rankingData.push({
        name: userName,
        favorability: item.favorability,
        userId: item.userId,
      })
    }

    const generator = new FavorabilityImageGenerator()
    const imageBuffer = await generator.generateRanking(
      "谁在意我",
      rankingData,
      e.member?.card || e.member?.nickname || currentUser,
    )

    await e.reply(segment.image(imageBuffer))
    return true
  }

  async whoILike(e) {
    const groupId = e.group_id.toString()
    const currentUser = e.user_id.toString()
    const data = this.readData(groupId)

    const myToOthers = []
    if (data.favorability[currentUser]) {
      for (const targetUser in data.favorability[currentUser]) {
        myToOthers.push({
          userId: targetUser,
          favorability: data.favorability[currentUser][targetUser],
        })
      }
    }
    myToOthers.sort((a, b) => b.favorability - a.favorability)

    if (myToOthers.length === 0) {
      await e.reply("你还没有对任何人产生好感哦~")
      return true
    }

    const top10 = myToOthers.slice(0, 10)
    const rankingData = []
    for (const item of top10) {
      const userName = await this.getUserName(e, item.userId)
      rankingData.push({
        name: userName,
        favorability: item.favorability,
        userId: item.userId,
      })
    }

    const generator = new FavorabilityImageGenerator()
    const imageBuffer = await generator.generateRanking(
      "我在意谁",
      rankingData,
      e.member?.card || e.member?.nickname || currentUser,
    )

    await e.reply(segment.image(imageBuffer))
    return true
  }

  async getUserName(e, userId) {
    try {
      let userInfo
      try {
        userInfo = await e.group.pickMember(userId).getInfo(true)
      } catch {
        userInfo = (await e.group.pickMember(Number(userId))).info
      }
      return userInfo?.card || userInfo?.nickname || userId
    } catch (err) {
      return userId
    }
  }
}
