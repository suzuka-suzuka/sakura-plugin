import Setting from "../lib/setting.js"
import cfg from "../../../lib/config/config.js"
import { addBlackList, removeBlackList } from "../lib/utils.js"
export class Permission extends plugin {
  constructor() {
    super({
      name: "权限管理",
      dsc: "权限管理",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^#?(取消)?赋权\\s*",
          fnc: "managePermission",
          log: false,
        },
        {
          reg: "^#?(拉黑|取消拉黑|解黑)",
          fnc: "manageBlackList",
          log: false,
        },
      ],
    })
  }
  get appconfig() {
    return Setting.getConfig("Permission")
  }
  async managePermission(e) {
    if (
      !this.appconfig?.enable?.includes(e.sender.user_id) &&
      !cfg.masterQQ.includes(e.sender.user_id)
    ) {
      return false
    }

    const isRemove = e.msg.includes("取消")
    const commandRegex = /^#?(取消)?赋权\s*/
    const rawTargetQQ = e.msg.replace(commandRegex, "").trim().replace("@", "") || e.at

    if (!rawTargetQQ) {
      return false
    }

    const targetQQ = Number(rawTargetQQ)
    if (isNaN(targetQQ)) {
      return false
    }
    let memberInfo
    try {
      memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
    } catch {
      memberInfo = (await e.group.pickMember(targetQQ)).info
    }

    const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
    const config = this.appconfig

    let replyMsg = ""
    let needSave = false
    const userExists = config.enable.includes(targetQQ)

    const masterQQs = Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]

    if (isRemove) {
      if (masterQQs.includes(targetQQ)) {
        replyMsg = "❎操作无效，不能取消主人的权限"
      } else if (!userExists) {
        replyMsg = `❎「${memberName}」没有权限，无需移除`
      } else {
        config.enable = config.enable.filter(id => id !== targetQQ)
        replyMsg = `✅已移除「${memberName}」的权限`
        needSave = true
      }
    } else {
      if (userExists) {
        replyMsg = `❎用户「${memberName}」已经拥有权限，无需重复添加`
      } else {
        config.enable.push(targetQQ)
        replyMsg = `✅已赋予「${memberName}」权限`
        needSave = true
      }
    }

    if (needSave) {
      const success = Setting.setConfig("Permission", config)
      if (success) {
        await this.reply(replyMsg, false, { recallMsg: 10 })
      } else {
        await this.reply("❎赋权失败", false, { recallMsg: 10 })
      }
    } else {
      await this.reply(replyMsg, false, { recallMsg: 10 })
    }

    return true
  }

  async manageBlackList(e) {
    if (!e.isMaster) {
      return false
    }

    const cleanMsg = e.msg.replace(/^#?/, "")
    const isRemove = cleanMsg.startsWith("取消拉黑") || cleanMsg.startsWith("解黑")

    if (isRemove) {
      const targetQQ =
        cleanMsg
          .replace(/取消拉黑|解黑/g, "")
          .trim()
          .replace("@", "") || e.at
      if (!targetQQ) return false

      let memberInfo
      try {
        memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
      } catch {
        memberInfo = (await e.group.pickMember(targetQQ)).info
      }
      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ

      const success = removeBlackList(targetQQ)
      if (success) {
        await this.reply(`✅已将 ${memberName} 移出黑名单`, false, { recallMsg: 10 })
      } else {
        await this.reply(`❎移出黑名单失败`, false, { recallMsg: 10 })
      }
    } else {
      let { targetQQ, duration, unit } = this.parseBlackListCommand(cleanMsg)
      if (!targetQQ) return false

      let memberInfo
      try {
        memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
      } catch {
        memberInfo = (await e.group.pickMember(targetQQ)).info
      }
      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ

      const masterQQs = Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]
      if (masterQQs.includes(Number(targetQQ))) {
        await this.reply(`❎不能拉黑主人哦`, false, { recallMsg: 10 })
        return true
      }

      const success = addBlackList(targetQQ)
      if (success) {
        let msg = `✅已将 ${memberName} 加入黑名单`
        if (duration > 0 && duration <= 86400) {
          msg += `，时长 ${unit}`
          setTimeout(() => {
            removeBlackList(targetQQ)
          }, duration * 1000)
        }
        await this.reply(msg, false, { recallMsg: 10 })
      } else {
        await this.reply(`❎加入黑名单失败`, false, { recallMsg: 10 })
      }
    }
    return true
  }

  parseBlackListCommand(msg) {
    let targetQQ = msg.match(/(\d{5,12})/) ? msg.match(/(\d{5,12})/)[1] : this.e.at
    let msgWithoutQQ = msg
    if (targetQQ) {
      msgWithoutQQ = msg.replace(targetQQ, "")
      let timeMatch = msgWithoutQQ.match(/(\d+)\s*(分钟|小时|天|分|时|秒)?/)
      let duration = 0
      let unitText = ""

      if (timeMatch) {
        const time = parseInt(timeMatch[1])
        const unit = timeMatch[2] || "秒"

        switch (unit) {
          case "秒":
            duration = time
            unitText = `${time}秒`
            break
          case "分":
          case "分钟":
            duration = time * 60
            unitText = `${time}分钟`
            break
          case "时":
          case "小时":
            duration = time * 3600
            unitText = `${time}小时`
            break
          case "天":
            duration = time * 86400
            unitText = `${time}天`
            break
        }
      }

      return { targetQQ, duration, unit: unitText }
    }
    return { targetQQ, duration, unit: unitText }
  }
}
