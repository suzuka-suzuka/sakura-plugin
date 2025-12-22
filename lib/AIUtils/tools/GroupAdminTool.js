import { AbstractTool } from "./AbstractTool.js"

export class GroupAdminTool extends AbstractTool {
  name = "GroupAdmin"
  parameters = {
    properties: {
      action: {
        type: "string",
        enum: ["mute", "editCard"],
        description: "操作类型：mute(禁言) 或 editCard(修改群名片)",
      },
      qq: {
        type: "string",
        description: "目标QQ号",
      },
      card: {
        type: "string",
        description: "新的群昵称（仅在action为editCard时需要）",
      },
      time: {
        type: "string",
        description: "禁言时长，单位为秒。如果需要解除禁言则填0。（仅在action为mute时需要）",
      },
    },
    required: ["action", "qq"],
  }

  description = "当需要管理群成员（如禁言或修改群名片）时使用此工具。"

  func = async function (opts, e) {
    const { action, qq: qqStr, card, time: timeStr } = opts

    if (!e.group_id) return "这个功能只能在群聊中使用，喵~"

    const qq = Number(qqStr)
    if (isNaN(qq)) return "QQ号格式不正确"

    // 获取目标成员信息
    let targetMember
    try {
      targetMember = await e.getInfo(qq)
    } catch (err) {
      return `获取成员信息失败，可能是 ${qq} 不在群内`
    }

    // 获取Bot在群内的信息
    let botMember
    try {
      botMember = await e.getInfo(e.bot.self_id)
    } catch (err) {
      return "获取Bot成员信息失败"
    }

    const senderId = e.sender.user_id
    const senderName = e.sender.card || e.sender.nickname || senderId
    const targetName = targetMember?.card || targetMember?.nickname || qq

    // 检查Bot权限
    if (botMember.role === "member") {
      if (!(action === "editCard" && qq === e.bot.self_id)) {
        return `失败了，我没有权限在群 ${e.group_id} 中执行管理操作。建议尝试使用 BlackList 工具进行拉黑。`
      }
    }

    // 检查发送者权限
    if (!e.isAdmin && !e.isWhite && senderId !== qq) {
      return `${senderName}(QQ:${senderId})没有权限让你执行此操作`
    }

    const isTargetAdminOrOwner = targetMember.role === "admin" || targetMember.role === "owner"

    if (action === "editCard") {
      if (!card) return "请提供新的群名片内容"

      if (isTargetAdminOrOwner && !e.isAdmin && qq !== e.bot.self_id) {
        await e.card(card) // 惩罚发送者
        return `${senderName} 没有权限让你修改管理员或群主 ${targetName}(QQ:${qq}) 的名片。作为惩罚，${senderName} 的名片已被修改为"${card}"。`
      }

      try {
        await e.card(card, qq)
        return `${targetName}(QQ:${qq}) 的群名片已成功修改为 "${card}"`
      } catch (err) {
        return `修改群名片失败: ${err.message}`
      }
    } else if (action === "mute") {
      let time = timeStr === undefined || timeStr === null ? 300 : parseInt(timeStr)
      if (isNaN(time)) return "禁言时长格式不正确"
      if (time > 86400 * 30) time = 86400 * 30

      if (isTargetAdminOrOwner) {
        if (!e.isAdmin) {
           await e.ban(time) // 惩罚发送者
           return `${senderName} 没有权限让你禁言管理员或群主 ${targetName}(QQ:${qq}) 。作为惩罚，${senderName} 已被禁言 ${time} 秒。`
        } else {
           return `无法禁言管理员或群主 ${targetName}(QQ:${qq}) 。建议尝试使用 BlackList 工具进行拉黑。`
        }
      }

      try {
        await e.ban(time, qq)
        const actionText = time === 0 ? "解除禁言" : `禁言 ${time} 秒`
        return `${targetName}(QQ:${qq}) 已被${actionText}。`
      } catch (err) {
        return `禁言失败: ${err.message}`
      }
    }

    return `未知的操作类型: ${action}`
  }
}
