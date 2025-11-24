import { AbstractTool } from "./AbstractTool.js"
import fs from "fs"
import path from "path"
import { plugindata } from "../../path.js"
import cfg from "../../../../../lib/config/config.js"
import Setting from "../../setting.js"

const blockListPath = path.join(plugindata, "blocklist.json")

export class BlockUserTool extends AbstractTool {
  name = "BlockUser"
  parameters = {
    properties: {
      qq: {
        type: "string",
        description: "目标QQ号",
      },
      time: {
        type: "string",
        description: "拉黑时长，单位为秒。如果需要解除拉黑则填0。如果不填默认为300秒（5分钟）。",
      },
    },
    required: ["qq"],
  }

  description = "当用户发表不当言论需要拉黑时使用此工具。请优先尝试使用 GroupAdmin 工具进行禁言。"

  func = async function (opts, e) {
    const { qq: qqStr, time: timeStr } = opts

    const qq = Number(qqStr)
    if (isNaN(qq)) {
      return "QQ号格式不正确"
    }

    const senderId = e.sender.user_id
    const senderName = e.sender?.card || e.sender?.nickname || senderId

    let targetName = qq
    if (e.isGroup) {
      try {
        const mm = await e.group.getMemberMap(true)
        const targetMember = mm.get(qq)
        if (targetMember) {
          targetName = targetMember.card || targetMember.nickname || qq
        }
      } catch (err) {}
    }

    const masterQQs = Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]
    const permissionConfig = Setting.getConfig("Permission")
    const authorizedUsers = permissionConfig?.enable || []

    if (masterQQs.includes(qq)) {
      return `无法拉黑主人 ${targetName}(QQ:${qq}) ，喵~`
    }

    let hasPermission = false

    if (senderId === qq) {
      hasPermission = true
    } else if (masterQQs.includes(senderId)) {
      hasPermission = true
    } else if (authorizedUsers.includes(senderId)) {
      hasPermission = true
    }

    if (!hasPermission) {
      return `${senderName} 没有权限执行拉黑操作。`
    }

    let time
    if (timeStr === undefined || timeStr === null) {
      time = 300
    } else {
      time = parseInt(timeStr)
      if (isNaN(time)) return "拉黑时长格式不正确"
    }

    let data = {}
    if (fs.existsSync(blockListPath)) {
      try {
        data = JSON.parse(fs.readFileSync(blockListPath, "utf8"))
      } catch (err) {
        logger.error("读取黑名单失败", err)
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
  }
}
