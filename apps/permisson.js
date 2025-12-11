import cfg from "../../../lib/config/config.js"
import { addBlackList, removeBlackList } from "../lib/utils.js"
import { PermissionManager } from "../lib/PermissionManager.js"

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
          reg: "^#?移权\\s*",
          fnc: "transferPermission",
          log: false,
        },
        {
          reg: "^#?(开启|关闭)全群权限",
          fnc: "toggleGroupPermission",
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

  get masterQQs() {
    return Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]
  }

  async managePermission(e) {
    const userId = e.sender.user_id
    const groupId = e.group_id
    const isMaster = this.masterQQs.includes(userId)

    if (!isMaster && !PermissionManager.hasPermission(groupId, userId)) {
      return false
    }

    const isRevoke = e.msg.includes("取消")
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
      memberInfo = (await e.group.pickMember(targetQQ))?.info
    }
    const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ

    if (isRevoke) {
      if (!isMaster) {
        return false
      }

      if (this.masterQQs.includes(targetQQ)) {
        return false
      }

      const result = PermissionManager.revokePermission(groupId, targetQQ)
      if (result.success) {
        const msg = `✅已取消「${memberName}」的权限`
        await this.reply(msg, false, { recallMsg: 10 })
        return true
      }
      return false
    }

    if (this.masterQQs.includes(targetQQ)) {
      return false
    }

    if (isMaster) {
      const success = PermissionManager.grantByMaster(groupId, targetQQ)
      if (success) {
        const msg = `✅已赋予「${memberName}」权限`
        await this.reply(msg, false, { recallMsg: 15 })
        return true
      }
      return false
    }

    const result = PermissionManager.grantByUser(groupId, userId, targetQQ)
    if (result.success) {
      let msg = `✅已赋予「${memberName}」权限`
      await this.reply(msg, false, { recallMsg: 15 })
      return true
    } else if (result.message?.includes("你的赋权名额已用完") || result.message?.includes("该用户已有权限")) {
      await this.reply(`❎${result.message}`, false, { recallMsg: 15 })
      return true
    }
    return false
  }

  async transferPermission(e) {
    const userId = e.sender.user_id
    const groupId = e.group_id

    if (!PermissionManager.hasPermission(groupId, userId)) {
      return false
    }

    const commandRegex = /^#?移权\s*/
    const rawTargetQQ = e.msg.replace(commandRegex, "").trim().replace("@", "") || e.at

    if (!rawTargetQQ) {
      return false
    }

    const targetQQ = Number(rawTargetQQ)
    if (isNaN(targetQQ)) {
      return false
    }

    if (targetQQ === userId) {
      return false
    }

    let memberInfo
    try {
      memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
    } catch {
      memberInfo = (await e.group.pickMember(targetQQ))?.info
    }
    const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ

    const result = PermissionManager.transferPermission(groupId, userId, targetQQ)

    if (result.success) {
      let msg = `✅已将权限移交给「${memberName}」`
      await this.reply(msg, false, { recallMsg: 20 })
      return true
    } else if (result.message?.includes("天内不能移交权力") || result.message?.includes("目标用户已有权限")) {
      await this.reply(`❎${result.message}`, false, { recallMsg: 10 })
      return true
    }

    return false
  }

  async toggleGroupPermission(e) {
    const userId = e.sender.user_id
    const groupId = e.group_id

    if (!this.masterQQs.includes(userId)) {
      return false
    }

    const enable = e.msg.includes("开启")
    const success = PermissionManager.toggleGroupPermission(groupId, enable)

    const msg = success
      ? enable
        ? "✅已开启全群权限"
        : "✅已关闭全群权限"
      : "❎操作失败"

    await this.reply(msg, false, { recallMsg: 10 })
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
        memberInfo = (await e.group.pickMember(targetQQ))?.info
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
        memberInfo = (await e.group.pickMember(targetQQ))?.info
      }
      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ

      if (this.masterQQs.includes(Number(targetQQ))) {
        return false
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
