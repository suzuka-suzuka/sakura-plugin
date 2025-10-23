import Setting from "../lib/setting.js"
import cfg from "../../../lib/config/config.js"
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
      }
    } else {
      if (userExists) {
        replyMsg = `❎用户「${memberName}」已经拥有权限，无需重复添加`
      } else {
        config.enable.push(targetQQ)
        replyMsg = `✅已赋予「${memberName}」权限`
      }
    }

    const success = Setting.setConfig("Permission", config)

    if (success) {
      await this.reply(replyMsg)
    } else {
      await this.reply("❎写入配置文件时遇到问题，请检查后台日志")
    }

    return true
  }
}
