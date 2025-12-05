import { AbstractTool } from "./AbstractTool.js"
import { addBlackList, removeBlackList } from "../../utils.js"
import setting from "../../setting.js"
import cfg from "../../../../../lib/config/config.js"

export class BlackListTool extends AbstractTool {
  name = "BlackList"
  parameters = {
    properties: {
      qq: {
        type: "string",
        description: "目标QQ号",
      },
      time: {
        type: "number",
        description: "拉黑时长（秒）。0表示解除拉黑，正数表示拉黑指定时长。",
      },
    },
    required: ["qq", "time"],
  }

  description = "当你想不再理会某人（即拉黑），或者解除拉黑时使用此工具。"

  func = async function (opts, e) {
    const { qq: qqStr, time } = opts
    const targetQQ = Number(qqStr)
    const senderId = e.user_id || e.sender?.user_id

    if (isNaN(targetQQ)) {
      return "QQ号格式不正确"
    }

    let masterQQ = []
    let permissionList = []

    try {
      masterQQ = cfg.masterQQ || []
      if (!Array.isArray(masterQQ)) {
        masterQQ = [masterQQ]
      }
      masterQQ = masterQQ.map(Number)

      const permissionConfig = setting.getConfig("Permission")
      permissionList = permissionConfig.enable || []
      permissionList = permissionList.map(Number)
    } catch (err) {
      logger.error("[BlackListTool] 读取配置失败", err)
      return "读取配置文件失败，无法执行操作"
    }

    const isMaster = masterQQ.includes(Number(senderId))
    const isPermission = permissionList.includes(Number(senderId))
    const isSelf = Number(senderId) === targetQQ
    const targetIsMaster = masterQQ.includes(targetQQ)

    if (targetIsMaster) {
      return "不能拉黑主人哦"
    }

    let allowed = false

    if (isMaster) {
      allowed = true
    } else if (isPermission) {
      if (!targetIsMaster) {
        allowed = true
      } else {
        return "不能拉黑主人哦"
      }
    } else if (isSelf) {
      allowed = true
    }

    if (!allowed) {
      return `${senderId}没有权限执行此操作`
    }

    if (time === 0) {
      const success = removeBlackList(targetQQ)
      return success ? `已将 ${targetQQ} 移出黑名单` : `移出黑名单失败`
    } else {
      const success = addBlackList(targetQQ)
      if (success) {
        let msg = `已将 ${targetQQ} 加入黑名单`
        if (time <= 86400) {
          msg += `，时长 ${time} 秒`
          setTimeout(() => {
            removeBlackList(targetQQ)
          }, time * 1000)
        }
        return msg
      } else {
        return `加入黑名单失败`
      }
    }
  }
}
