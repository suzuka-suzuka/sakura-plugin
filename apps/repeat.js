import _ from "lodash"
import Setting from "../lib/setting.js"
import path from "path"
import { pluginresources } from "../lib/path.js"
import fs from "fs/promises"
let msg = {}

export class repeatPlugin extends plugin {
  constructor() {
    super({
      name: "repeat",
      event: "message.group",
      priority: 35,
      rule: [
        {
          reg: "",
          fnc: "fd",
          log: false,
        },
      ],
    })
  }

  get appconfig() {
    return Setting.getConfig("repeat")
  }

  async fd(e) {
    const fdConfig = this.appconfig
    if (!fdConfig.enable) {
      return false
    }

    if (!msg[e.group_id]) {
      msg[e.group_id] = { message: e.message, times: 1, lastSender: e.sender.user_id }
      return false
    }

    if (await this.isSameMessage(e.message, msg[e.group_id].message)) {
      if (msg[e.group_id].lastSender === e.sender.user_id) return false
      msg[e.group_id].times++
      msg[e.group_id].lastSender = e.sender.user_id

      if (msg[e.group_id].times === 3) {
        await e.reply(msg[e.group_id].message)
        return false
      } else if (msg[e.group_id].times === 5) {
        const breakMessages = [
          "复读机来了！",
          "复读一时爽，一直复读一直爽……才怪！",
          "请停止你的复读行为！",
          "好了好了，知道你能复读了",
          "检测到复读姬能量波动异常，正在进行强制关停！",
        ]

        let randomAction
        const isRepeatedMessageNonText =
          Array.isArray(msg[e.group_id].message) &&
          msg[e.group_id].message.some(m => m.type !== "text")

        if (isRepeatedMessageNonText) {
          randomAction = _.sample([0, 2])
        } else {
          randomAction = _.random(0, 2)
        }

        let replyContent

        if (randomAction === 0) {
          replyContent = breakMessages[_.random(0, breakMessages.length - 1)]
          await e.reply(replyContent)
        } else if (randomAction === 1) {
          replyContent = this.randomString(e.msg)
          await e.reply(replyContent)
        } else {
          const repeatImagePath = path.join(pluginresources, "repeat")
          const files = await fs.readdir(repeatImagePath)
          const randomImage = files[_.random(0, files.length - 1)]
          const fullImagePath = path.join(repeatImagePath, randomImage)
          await e.reply(segment.image(fullImagePath))
        }
        return false
      } else if (msg[e.group_id].times === 7) {
        const muteTargetId = msg[e.group_id].lastSender
        const muteDuration = 60
        let botMember
        try {
          botMember = await e.group.pickMember(e.self_id).getInfo(true)
        } catch {
          botMember = (await e.group.pickMember(Number(e.self_id))).info
        }
        let muteTarget
        try {
          muteTarget = await e.group.pickMember(muteTargetId).getInfo(true)
        } catch {
          muteTarget = (await e.group.pickMember(Number(muteTargetId))).info
        }

        if (
          botMember &&
          botMember.role !== "member" &&
          muteTarget &&
          muteTarget.role !== "owner" &&
          muteTarget.role !== "admin"
        ) {
          await e.group.muteMember(muteTargetId, muteDuration)
          await e.reply(`好孩子不要复读哦！`)
        } else {
          logger.warn(`机器人无权限`)
        }
        return false
      } else {
        return false
      }
    } else {
      msg[e.group_id].message = e.message
      msg[e.group_id].times = 1
      msg[e.group_id].lastSender = e.sender.user_id
      return false
    }
  }

  async isSameMessage(message1, message2) {
    if (!Array.isArray(message1) || !Array.isArray(message2)) {
      return message1 === message2
    }

    if (message1.length !== message2.length) return false

    for (let i = 0; i < message1.length; i++) {
      const m1 = message1[i]
      const m2 = message2[i]

      if (m1.type !== m2.type) return false

      if (m1.type === "text") {
        if (m1.text !== m2.text) return false
      } else if (m1.type === "image") {
        if (m1.file !== m2.file) {
          if (m1.url && m2.url) {
            if (m1.url !== m2.url) {
              return false
            }
          } else {
            return false
          }
        }
      } else {
        if (!_.isEqual(m1, m2)) return false
      }
    }
    return true
  }

  randomString(str) {
    if (!str) return "阿巴阿巴"
    let newStrAll = []
    str.split("").forEach(item => {
      let newIndex = _.random(0, newStrAll.length)
      newStrAll.splice(newIndex, 0, item)
    })
    return newStrAll.join("")
  }
}
