import { AbstractTool } from "./AbstractTool.js"
import fs from 'fs'
import path from 'path'
import { plugindata } from '../../path.js'

const blockListPath = path.join(plugindata, 'blocklist.json')

export class GroupAdminTool extends AbstractTool {
  name = "GroupAdmin"
  parameters = {
    properties: {
      action: {
        type: "string",
        enum: ["mute", "editCard", "block"],
        description: "操作类型：mute(禁言)、editCard(修改群名片) 或 block(拉黑)",
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
        description: "时长，单位为秒。如果需要解除禁言/拉黑则填0。（仅在action为mute或block时需要）",
      },
    },
    required: ["action", "qq"],
  }

  description = "当需要管理群成员（如禁言、修改群名片或拉黑用户）时使用此工具。"

  func = async function (opts, e) {
    const { action, qq: qqStr, card, time: timeStr } = opts

    if (!e.isGroup) {
      return "这个功能只能在群聊中使用，喵~"
    }

    const qq = Number(qqStr)
    if (isNaN(qq)) {
      return "QQ号格式不正确"
    }

    const groupId = e.group_id
    const senderId = e.sender.user_id
    const group = e.group

    if (!group) {
      return `未找到群 ${groupId}，喵~`
    }

    let mm
    try {
      mm = await e.group.getMemberMap(true)
    } catch (err) {
      console.error(`获取群成员失败:`, err)
      return "获取群成员信息失败"
    }

    if (!mm.has(qq)) {
      return `失败了， ${qq} 不在群 ${groupId} 中`
    }

    const targetMember = mm.get(qq)
    const senderMember = mm.get(senderId)
    const botMember = mm.get(e.bot.uin)

    const targetName = targetMember?.card || targetMember?.nickname || qq
    const senderName = senderMember?.card || senderMember?.nickname || senderId

    if (botMember && botMember.role === "member") {
      return `失败了，我没有权限在群 ${groupId} 中执行管理操作`
    }

    const senderRole = senderMember?.role
    const targetRole = targetMember?.role
    const isSenderAdminOrOwner = senderRole === "admin" || senderRole === "owner"
    const isTargetAdminOrOwner = targetRole === "admin" || targetRole === "owner"

    if (action === "editCard") {
      if (!card) return "请提供新的群名片内容"

      if (isTargetAdminOrOwner && !isSenderAdminOrOwner) {
        await group.setCard(senderId, card)
        return `${senderName} 没有权限让你修改管理员或群主 ${targetName}(QQ:${qq}) 的名片。作为惩罚，${senderName} 的名片已被修改为"${card}"。`
      }

      try {
        await group.setCard(qq, card)
        const newTargetMember = (await e.group.getMemberMap(true)).get(qq)
        const newTargetName = newTargetMember?.card || newTargetMember?.nickname || qq
        return `${newTargetName}(QQ:${qq}) 的群名片已成功修改为 "${card}"`
      } catch (err) {
        console.error(`设置名片失败:`, err)
        return "设置名片失败，可能是权限不足"
      }
    } else if (action === "mute") {
      if (timeStr === undefined || timeStr === null) return "请提供禁言时长"
      let time = parseInt(timeStr)
      if (isNaN(time)) return "禁言时长格式不正确"
      if (time > 86400 * 30) time = 86400 * 30

      if (isTargetAdminOrOwner) {
        if (!isSenderAdminOrOwner) {
          await e.group.muteMember(senderId, time)
          return `${senderName} 没有权限让你禁言管理员或群主 ${targetName}(QQ:${qq}) 。作为惩罚，${senderName} 已被禁言 ${time} 秒。`
        } else {
          return `无法禁言管理员或群主 ${targetName}(QQ:${qq}) 。`
        }
      }

      try {
        await e.group.muteMember(qq, time)
        const actionText = time === 0 ? "解除禁言" : `禁言 ${time} 秒`
        return `${targetName}(QQ:${qq}) 已被${actionText}。`
      } catch (err) {
        console.error(`禁言失败:`, err)
        return "禁言失败，可能是权限不足"
      }
    } else if (action === "block") {
      if (timeStr === undefined || timeStr === null) return "请提供拉黑时长"
      let time = parseInt(timeStr)
      if (isNaN(time)) return "拉黑时长格式不正确"

      const masterQQs = Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]
      if (masterQQs.includes(qq)) {
        return `无法拉黑主人 ${targetName}(QQ:${qq}) ，喵~`
      }

      if (isTargetAdminOrOwner && !isSenderAdminOrOwner) {
        return `${senderName} 没有权限拉黑管理员或群主 ${targetName}(QQ:${qq}) 。`
      }

      let data = {}
      if (fs.existsSync(blockListPath)) {
        try {
          data = JSON.parse(fs.readFileSync(blockListPath, 'utf8'))
        } catch (err) {
          logger.error('读取黑名单失败', err)
        }
      }

      if (time === 0) {
        if (data[qq]) {
          delete data[qq]
          fs.writeFileSync(blockListPath, JSON.stringify(data, null, 2))
          return `${targetName}(QQ:${qq}) 已被解除拉黑。`
        } else {
          return `${targetName}(QQ:${qq}) 未被拉黑。`
        }
      } else {
        const expireTime = Date.now() + time * 1000
        data[qq] = expireTime

        const dir = path.dirname(blockListPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        fs.writeFileSync(blockListPath, JSON.stringify(data, null, 2))
        return `${targetName}(QQ:${qq}) 已被拉黑 ${time} 秒，期间将无视其任何消息。`
      }
    } else {
      return `未知的操作类型: ${action}`
    }
  }
}
