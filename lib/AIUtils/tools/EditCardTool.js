import { AbstractTool } from "./AbstractTool.js"

export class EditCardTool extends AbstractTool {
  name = "editCard"
  parameters = {
    properties: {
      qq: {
        type: "string",
        description: "QQ号。",
      },
      card: {
        type: "string",
        description: "新的群昵称（群名片）。",
      },
    },
    required: ["qq", "card"],
  }

  description = "当你想要修改群内成员的群昵称（群名片）时，可以使用此工具。"

  func = async function (opts, e) {
    let { qq, card } = opts
    if (!e.isGroup) {
      return "这个功能只能在群聊中使用，喵~"
    }

    qq = Number(qq)
    const groupId = e.group_id
    const senderId = e.sender.user_id

    const group = e.group
    if (!group) {
      return `未找到群 ${groupId}，喵~`
    }

    try {
      let mm = await e.group.getMemberMap(true)
      const targetMember = mm.get(qq)
      const senderMember = mm.get(senderId)

      const targetName = targetMember?.card || targetMember?.nickname || qq
      const senderName = senderMember?.card || senderMember?.nickname || senderId

      if (!mm.has(qq)) {
        return `失败了， ${qq} 不在群 ${groupId} 中`
      }
      if (mm.get(e.bot.uin) && mm.get(e.bot.uin).role === "member") {
        return `失败了，你没有权限在群 ${groupId} 中修改名片`
      }

      const senderRole = senderMember?.role
      const targetRole = targetMember?.role
      const isSenderAdminOrOwner = senderRole === "admin" || senderRole === "owner"
      const isTargetAdminOrOwner = targetRole === "admin" || targetRole === "owner"

      if (isTargetAdminOrOwner && !isSenderAdminOrOwner) {
        await group.setCard(senderId, card)
        return `${senderName} 没有权限让你修改管理员或群主 ${targetName}(QQ:${qq}) 的名片。作为惩罚，${senderName} 的名片已被修改为"${card}"。`
      }

      await group.setCard(qq, card)
    } catch (err) {
      console.error(`获取群信息或设置名片失败:`, err)
      return "获取群信息或设置名片失败，可能是底层协议问题或权限不足"
    }
    const targetMember = (await e.group.getMemberMap(true)).get(qq)
    const targetName = targetMember?.card || targetMember?.nickname || qq
    return `${targetName}(QQ:${qq}) 的群名片已成功修改为 "${card}"`
  }
}
