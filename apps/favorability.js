import plugin from "../../../lib/plugins/plugin.js"
import fs from "fs"
import path from "path"
import { _path } from "../lib/path.js"
import adapter from "../lib/adapter.js"

const dataPath = path.join(_path, "data", "favorability")

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true })
}

export class Favorability extends plugin {
  constructor() {
    super({
      name: "好感度",
      dsc: "记录群友之间的好感度",
      event: "message.group",
      priority: 5000,
      rule: [
        {
          reg: "^#?好感度.*$",
          fnc: "queryFavorability",
        },
      ],
    })

    this.lastSender = new Map()
  }

  getDataFile(groupId) {
    return path.join(dataPath, `${groupId}.json`)
  }

  readData(groupId) {
    const file = this.getDataFile(groupId)
    if (!fs.existsSync(file)) {
      return {}
    }
    try {
      const data = fs.readFileSync(file, "utf-8")
      return JSON.parse(data)
    } catch (err) {
      logger.error(`[好感度] 读取数据失败: ${err}`)
      return {}
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

    if (!data[from]) {
      data[from] = {}
    }

    if (!data[from][to]) {
      data[from][to] = 0
    }

    data[from][to] += value
    this.saveData(groupId, data)
  }

  getFavorability(groupId, from, to) {
    const data = this.readData(groupId)
    return data[from]?.[to] || 0
  }

  async accept(e) {
    const groupId = e.group_id.toString()
    const currentSender = e.user_id.toString()

    let targetUsers = []
    let shouldAddFavorability = false

    const atMsgs = e.message?.filter(
      msg => msg.type === "at" && msg.qq && !isNaN(msg.qq) && msg.qq !== e.self_id,
    )
    if (atMsgs && atMsgs.length > 0) {
      targetUsers = atMsgs.map(msg => msg.qq.toString()).filter(qq => qq !== currentSender)

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
        } catch (err) {
        }
      }
    }

    if (shouldAddFavorability && targetUsers.length > 0) {
      for (const targetUser of targetUsers) {
        this.addFavorability(groupId, currentSender, targetUser, 2)
      }
    } else {
      const lastSender = this.lastSender.get(groupId)

      if (lastSender && lastSender !== currentSender) {
        this.addFavorability(groupId, currentSender, lastSender, 1)
      }
    }

    this.lastSender.set(groupId, currentSender)

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

    const favorability = this.getFavorability(groupId, currentUser, targetUser)

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

    await e.reply(`${currentUserName} 对 ${targetUserName} 的好感度为：${favorability}`)
    return true
  }
}
