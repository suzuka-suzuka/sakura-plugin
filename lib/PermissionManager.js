import fs from "fs"
import path from "path"
import { plugindata } from "./path.js"
import cfg from "../../../lib/config/config.js"

const PERMISSION_DIR = path.join(plugindata, "permissions")
const TRANSFER_COOLDOWN = 7 * 24 * 60 * 60 * 1000

export class PermissionManager {
  static get masterQQs() {
    return Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]
  }

  static ensurePermissionDir() {
    if (!fs.existsSync(PERMISSION_DIR)) {
      fs.mkdirSync(PERMISSION_DIR, { recursive: true })
    }
  }

  static getGroupPermissionPath(groupId) {
    this.ensurePermissionDir()
    return path.join(PERMISSION_DIR, `${groupId}.json`)
  }

  static readGroupPermission(groupId) {
    const filePath = this.getGroupPermissionPath(groupId)

    if (!fs.existsSync(filePath)) {
      return {
        groupEnabled: false,
        users: {},
      }
    }

    try {
      const data = fs.readFileSync(filePath, "utf8")
      return JSON.parse(data)
    } catch (err) {
      console.error(`读取群 ${groupId} 权限配置失败:`, err)
      return {
        groupEnabled: false,
        users: {},
      }
    }
  }

  static saveGroupPermission(groupId, data) {
    const filePath = this.getGroupPermissionPath(groupId)

    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
      return true
    } catch (err) {
      console.error(`保存群 ${groupId} 权限配置失败:`, err)
      return false
    }
  }

  static hasPermission(groupId, userId) {
    if (this.masterQQs.includes(userId)) {
      return true
    }

    const config = this.readGroupPermission(groupId)

    if (config.groupEnabled) {
      return true
    }

    return config.users[userId] !== undefined
  }

  static hasExplicitPermission(groupId, userId) {
    if (this.masterQQs.includes(userId)) {
      return true
    }

    const config = this.readGroupPermission(groupId)
    return config.users[userId] !== undefined
  }

  static grantByMaster(groupId, targetUserId) {
    const config = this.readGroupPermission(groupId)

    config.users[targetUserId] = {
      grantedBy: "master",
      grantTime: Date.now(),
      remainingGrants: 1,
      lastTransferTime: null,
      receivedTransferTime: null,
    }

    return this.saveGroupPermission(groupId, config)
  }

  static grantByUser(groupId, fromUserId, targetUserId) {
    const config = this.readGroupPermission(groupId)

    const fromUser = config.users[fromUserId]
    if (!fromUser) {
      return { success: false }
    }

    if (!this.masterQQs.includes(fromUserId) && fromUser.grantedBy !== "master") {
      return { success: false }
    }

    if (fromUser.remainingGrants <= 0) {
      return { success: false, message: "你的赋权名额已用完" }
    }

    if (config.users[targetUserId]) {
      return { success: false, message: "该用户已有权限" }
    }

    config.users[targetUserId] = {
      grantedBy: fromUserId,
      grantTime: Date.now(),
      remainingGrants: 0,
      lastTransferTime: null,
      receivedTransferTime: null,
    }

    fromUser.remainingGrants--

    return {
      success: this.saveGroupPermission(groupId, config),
      message: "赋权成功",
    }
  }

  static revokePermission(groupId, targetUserId) {
    const config = this.readGroupPermission(groupId)

    if (!config.users[targetUserId]) {
      return { success: false }
    }

    delete config.users[targetUserId]

    return {
      success: this.saveGroupPermission(groupId, config),
      message: "取消权限成功",
    }
  }

  static transferPermission(groupId, fromUserId, targetUserId) {
    const config = this.readGroupPermission(groupId)

    if (this.masterQQs.includes(fromUserId)) {
      return { success: false }
    }

    const fromUser = config.users[fromUserId]
    if (!fromUser) {
      return { success: false }
    }

    if (fromUser.receivedTransferTime) {
      const cooldownEnd = fromUser.receivedTransferTime + TRANSFER_COOLDOWN
      if (Date.now() < cooldownEnd) {
        const remainingDays = Math.ceil((cooldownEnd - Date.now()) / (24 * 60 * 60 * 1000))
        return {
          success: false,
          message: `你在 ${remainingDays} 天内不能移交权力（接收移权后需等待7天）`,
        }
      }
    }

    if (config.users[targetUserId]) {
      return { success: false, message: "目标用户已有权限" }
    }

    let newGrants = 0
    if (fromUser.grantedBy === "master" && fromUser.remainingGrants > 0) {
      newGrants = 1
    }

    config.users[targetUserId] = {
      grantedBy: fromUser.grantedBy,
      grantTime: Date.now(),
      remainingGrants: newGrants,
      lastTransferTime: null,
      receivedTransferTime: Date.now(),
    }

    delete config.users[fromUserId]

    return {
      success: this.saveGroupPermission(groupId, config),
      message: "移交权限成功",
      hasGrant: newGrants > 0,
    }
  }

  static toggleGroupPermission(groupId, enabled) {
    const config = this.readGroupPermission(groupId)
    config.groupEnabled = enabled

    return this.saveGroupPermission(groupId, config)
  }

  static getUserPermissionInfo(groupId, userId) {
    if (this.masterQQs.includes(userId)) {
      return {
        hasPermission: true,
        isMaster: true,
        canGrant: true,
        remainingGrants: Infinity,
        canRevoke: true,
        canTransfer: false,
      }
    }

    const config = this.readGroupPermission(groupId)

    if (config.groupEnabled) {
      return {
        hasPermission: true,
        isMaster: false,
        isGroupEnabled: true,
        canGrant: false,
        remainingGrants: 0,
        canRevoke: false,
        canTransfer: false,
      }
    }

    const userInfo = config.users[userId]
    if (!userInfo) {
      return {
        hasPermission: false,
        canGrant: false,
        remainingGrants: 0,
        canRevoke: false,
        canTransfer: false,
      }
    }

    const canGrant = userInfo.grantedBy === "master" && userInfo.remainingGrants > 0
    const canTransfer =
      !userInfo.receivedTransferTime ||
      Date.now() - userInfo.receivedTransferTime >= TRANSFER_COOLDOWN

    return {
      hasPermission: true,
      isMaster: false,
      grantedBy: userInfo.grantedBy,
      canGrant: canGrant,
      remainingGrants: userInfo.remainingGrants,
      canRevoke: false,
      canTransfer: canTransfer,
      receivedTransferTime: userInfo.receivedTransferTime,
    }
  }

  static getGroupPermissionSummary(groupId) {
    const config = this.readGroupPermission(groupId)
    const userCount = Object.keys(config.users).length

    return {
      groupEnabled: config.groupEnabled,
      userCount: userCount,
      users: config.users,
    }
  }
}
