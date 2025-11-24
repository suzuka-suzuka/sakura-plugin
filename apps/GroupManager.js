import Setting from "../lib/setting.js"
import fs from "fs"
import path from "path"
import { plugindata } from "../lib/path.js"
import cfg from "../../lib/config/config.js"

const conversationStateNeverSpoken = {}
const conversationStateInactive = {}
const conversationStateLevel = {}

export class GroupManager extends plugin {
  constructor() {
    super({
      name: "群管插件",
      dsc: "合并了入群指令、清理不活跃成员、禁言、踢人、精华消息等功能",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^#?开门\\s*(\\d+)$",
          fnc: "handleApprovalCommand",
          log: false,
        },
        {
          reg: "^#?清理从未发言的人$",
          fnc: "prepareCleanupNeverSpoken",
          log: false,
        },
        {
          reg: "^#?清理(\\d+)(天|个月)未发言的人$",
          fnc: "prepareCleanupInactive",
          log: false,
        },
        {
          reg: "^#?清理低于(\\d+)级的人$",
          fnc: "prepareCleanupByLevel",
          log: false,
        },
        {
          reg: "^#?(禁言|解禁)",
          fnc: "handleMuteAction",
          log: false,
        },
        {
          reg: "^#?(踢|踢黑)",
          fnc: "kickMember",
          log: false,
        },
        {
          reg: "^#?(设为|移出)精华$",
          fnc: "handleEssenceMessage",
          log: false,
        },
        {
          reg: "^#?(全员禁言|全员解禁)$",
          fnc: "handleMuteAll",
          log: false,
        },
        {
          reg: "^#?(拉黑|解黑)",
          fnc: "blockUser",
          log: false,
        },
      ],
    })
  }
  get appconfig() {
    return Setting.getConfig("Permission")
  }

  async handleApprovalCommand(e) {
    if (e.sender.role === "member" && !this.appconfig?.enable?.includes(e.sender.user_id)) {
      return false
    }
    if (!global.GroupRequests) {
      return false
    }

    const markerId = Number(e.msg.match(/^#?开门\s*(\d+)$/)[1])

    const groupRequests = global.GroupRequests.get(e.group_id)

    if (!groupRequests) {
      return false
    }

    if (!groupRequests.has(markerId)) {
      await this.reply(`门牌号${markerId}不存在`, false, { recallMsg: 10 })
      return true
    }
    await e.reply(`好的，我这就开门`)
    const flag = groupRequests.get(markerId)

    await e.bot.setGroupAddRequest(flag, true)
    groupRequests.delete(markerId)

    return true
  }

  async prepareCleanupNeverSpoken(e) {
    if (e.sender.role === "member" && !this.appconfig?.enable?.includes(e.sender.user_id)) {
      return false
    }
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    if (conversationStateNeverSpoken[e.user_id]) {
      delete conversationStateNeverSpoken[e.user_id]
      this.finish("confirmCleanupNeverSpoken", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[清理从未发言] 获取群成员列表失败`)
      return await e.reply("获取群成员列表失败，请稍后再试。")
    }

    const inactiveMembers = []
    memberMap.forEach(member => {
      if (member.user_id === e.bot.uin) {
        return
      }
      if (member.join_time === member.last_sent_time) {
        inactiveMembers.push({
          user_id: member.user_id,
          nickname: member.card || member.nickname,
        })
      }
    })

    if (inactiveMembers.length === 0) {
      return await e.reply("非常棒！本群所有成员都发言过啦！")
    }

    const forwardMsgNodes = [
      {
        message: `检测到 ${inactiveMembers.length} 位从未发言的成员，详情如下：`,
        nickname: bot.card || bot.nickname,
        user_id: e.bot.uin,
      },
    ]

    for (const member of inactiveMembers) {
      forwardMsgNodes.push({
        message: [
          segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`),
          `\n昵称: ${member.nickname}`,
          `\nQQ: ${member.user_id}`,
        ],
        nickname: bot.card || bot.nickname,
        user_id: e.bot.uin,
      })
    }

    const forwardMsg = await e.group.makeForwardMsg(forwardMsgNodes)
    await e.reply(forwardMsg)

    conversationStateNeverSpoken[e.user_id] = { inactiveMembers }
    this.setContext("confirmCleanupNeverSpoken", true, 30)

    await e.reply(
      `以上是所有从未发言的成员列表共${inactiveMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`,
    )
  }

  async confirmCleanupNeverSpoken() {
    const e = this.e
    const userInput = e.raw_message?.trim()
    const state = conversationStateNeverSpoken[e.user_id]

    if (!state) return

    if (userInput === "取消") {
      delete conversationStateNeverSpoken[e.user_id]
      this.finish("confirmCleanupNeverSpoken", true)
      await e.reply("操作已取消。")
      return
    }

    if (userInput !== "确认清理") return

    const { inactiveMembers } = state

    delete conversationStateNeverSpoken[e.user_id]
    this.finish("confirmCleanupNeverSpoken", true)

    let successCount = 0
    await e.reply(`正在开始清理 ${inactiveMembers.length} 位从未发言的成员...`)

    for (const member of inactiveMembers) {
      await e.group.kickMember(member.user_id)
      successCount++
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    let reportMsg = `清理完成。成功清理 ${successCount} 人。`
    await e.reply(reportMsg)
  }

  async prepareCleanupInactive(e) {
    if (e.sender.role === "member" && !this.appconfig?.enable?.includes(e.sender.user_id)) {
      return false
    }
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    const match = e.msg.match(/^#?清理(\d+)(天|个月)未发言的人$/)
    const value = parseInt(match[1])
    const unit = match[2]

    let days
    if (unit === "天") {
      days = value
    } else if (unit === "个月") {
      days = value * 30
    }

    if (isNaN(days) || days <= 0) {
      return await e.reply("请输入有效的时间！")
    }

    if (conversationStateInactive[e.user_id]) {
      delete conversationStateInactive[e.user_id]
      this.finish("confirmCleanupInactive", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[清理长时间未发言] 获取群成员列表失败`)
      return await e.reply("获取群成员列表失败，请稍后再试。")
    }

    const currentTime = Math.floor(Date.now() / 1000)
    const inactiveThreshold = days * 24 * 60 * 60
    const inactiveMembers = []

    memberMap.forEach(member => {
      if (member.user_id === e.bot.uin) {
        return
      }
      const timeDifference = currentTime - member.last_sent_time
      if (timeDifference > inactiveThreshold) {
        inactiveMembers.push({
          user_id: member.user_id,
          nickname: member.card || member.nickname,
          last_sent_time: member.last_sent_time,
        })
      }
    })

    if (inactiveMembers.length === 0) {
      return await e.reply(`非常棒！本群所有成员在最近 ${value}${unit} 内都发言过啦！`)
    }

    const forwardMsgNodes = [
      {
        message: `检测到 ${inactiveMembers.length} 位超过 ${value}${unit} 未发言的成员，详情如下：`,
        nickname: bot.card || bot.nickname,
        user_id: e.bot.uin,
      },
    ]

    for (const member of inactiveMembers) {
      const lastSentDate = new Date(member.last_sent_time * 1000).toLocaleString()
      forwardMsgNodes.push({
        message: [
          segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`),
          `\n昵称: ${member.nickname}`,
          `\nQQ: ${member.user_id}`,
          `\n最后发言: ${lastSentDate}`,
        ],
        nickname: bot.card || bot.nickname,
        user_id: e.bot.uin,
      })
    }

    const forwardMsg = await e.group.makeForwardMsg(forwardMsgNodes)
    await e.reply(forwardMsg)

    conversationStateInactive[e.user_id] = { inactiveMembers }
    this.setContext("confirmCleanupInactive", true, 30)

    await e.reply(
      `以上是超过 ${value}${unit} 未发言的成员列表共${inactiveMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`,
    )
  }

  async confirmCleanupInactive() {
    const e = this.e
    const userInput = e.raw_message?.trim()
    const state = conversationStateInactive[e.user_id]

    if (!state) return

    if (userInput === "取消") {
      delete conversationStateInactive[e.user_id]
      this.finish("confirmCleanupInactive", true)
      await e.reply("操作已取消。")
      return
    }

    if (userInput !== "确认清理") return

    const { inactiveMembers } = state

    delete conversationStateInactive[e.user_id]
    this.finish("confirmCleanupInactive", true)

    let successCount = 0
    await e.reply(`正在开始清理 ${inactiveMembers.length} 位长时间未发言的成员...`)

    for (const member of inactiveMembers) {
      await e.group.kickMember(member.user_id)
      successCount++
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    let reportMsg = `清理完成。成功清理 ${successCount} 人。`
    await e.reply(reportMsg)
  }
  async prepareCleanupByLevel(e) {
    if (e.sender.role === "member" && !this.appconfig?.enable?.includes(e.sender.user_id)) {
      return false
    }
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    const match = e.msg.match(/^#?清理低于(\d+)级的人$/)
    const level = parseInt(match[1])

    if (isNaN(level) || level <= 0) {
      return await e.reply("请输入有效的等级！")
    }

    if (conversationStateLevel[e.user_id]) {
      delete conversationStateLevel[e.user_id]
      this.finish("confirmCleanupByLevel", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[清理低等级成员] 获取群成员列表失败`)
      return await e.reply("获取群成员列表失败，请稍后再试。")
    }

    const lowLevelMembers = []
    memberMap.forEach(member => {
      if (member.user_id === e.bot.uin || member.role !== "member") {
        return
      }
      if (member.level < level) {
        lowLevelMembers.push({
          user_id: member.user_id,
          nickname: member.card || member.nickname,
          level: member.level,
        })
      }
    })

    if (lowLevelMembers.length === 0) {
      return await e.reply(`本群没有群等级低于 ${level} 级的成员。`)
    }

    const forwardMsgNodes = [
      {
        message: `检测到 ${lowLevelMembers.length} 位群等级低于 ${level} 级的成员，详情如下：`,
        nickname: bot.card || bot.nickname,
        user_id: e.bot.uin,
      },
    ]

    for (const member of lowLevelMembers) {
      forwardMsgNodes.push({
        message: [
          segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`),
          `\n昵称: ${member.nickname}`,
          `\nQQ: ${member.user_id}`,
          `\n群等级: ${member.level}`,
        ],
        nickname: bot.card || bot.nickname,
        user_id: e.bot.uin,
      })
    }

    const forwardMsg = await e.group.makeForwardMsg(forwardMsgNodes)
    await e.reply(forwardMsg)

    conversationStateLevel[e.user_id] = { lowLevelMembers }
    this.setContext("confirmCleanupByLevel", true, 30)

    await e.reply(
      `以上是群等级低于 ${level} 级的成员列表共${lowLevelMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`,
    )
  }
  async confirmCleanupByLevel() {
    const e = this.e
    const userInput = e.raw_message?.trim()
    const state = conversationStateLevel[e.user_id]

    if (!state) return

    if (userInput === "取消") {
      delete conversationStateLevel[e.user_id]
      this.finish("confirmCleanupByLevel", true)
      await e.reply("操作已取消。")
      return
    }

    if (userInput !== "确认清理") return

    const { lowLevelMembers } = state

    delete conversationStateLevel[e.user_id]
    this.finish("confirmCleanupByLevel", true)

    let successCount = 0
    await e.reply(`正在开始清理 ${lowLevelMembers.length} 位低等级的成员...`)

    for (const member of lowLevelMembers) {
      await e.group.kickMember(member.user_id)
      successCount++
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    let reportMsg = `清理完成。成功清理 ${successCount} 人。`
    await e.reply(reportMsg)
  }

  async handleMuteAction(e) {
    if (e.sender.role === "member" && !this.appconfig?.enable?.includes(e.sender.user_id)) {
      return false
    }
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    const cleanMsg = e.msg.replace(/^#?/, "")
    const isMute = cleanMsg.startsWith("禁言")

    if (isMute) {
      let { targetQQ, duration, unit } = this.parseMuteCommand(cleanMsg)
      if (!targetQQ) return false

      if (duration === 0) {
        duration = 300
        unit = "5分钟"
      }

      let memberInfo
      try {
        memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
      } catch {
        memberInfo = (await e.group.pickMember(Number(targetQQ))).info
      }
      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
      if (memberInfo?.role !== "member") {
        return false
      }
      await e.group.muteMember(targetQQ, duration)
      e.reply(`✅ 已将「${memberName}」禁言${unit}。`)
    } else {
      const targetQQ = cleanMsg.replace(/解禁/g, "").trim().replace("@", "") || e.at
      if (!targetQQ) return false

      let memberInfo
      try {
        memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
      } catch {
        memberInfo = (await e.group.pickMember(Number(targetQQ))).info
      }

      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
      if (memberInfo?.role !== "member") {
        return false
      }
      await e.group.muteMember(targetQQ, 0)
      e.reply(`✅ 已将「${memberName}」解除禁言。`)
    }
    return true
  }

  async kickMember(e) {
    if (e.sender.role === "member" && !this.appconfig?.enable?.includes(e.sender.user_id)) {
      return false
    }
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    const cleanMsg = e.msg.replace(/^#?/, "")
    const isBlacklist = cleanMsg.startsWith("踢黑")
    const command = isBlacklist ? "踢黑" : "踢"
    const targetQQ = cleanMsg.replace(command, "").trim().replace("@", "") || e.at

    if (!targetQQ) return false

    let memberInfo
    try {
      memberInfo = await e.group.pickMember(targetQQ).getInfo(true)
    } catch {
      memberInfo = (await e.group.pickMember(Number(targetQQ))).info
    }

    if (memberInfo.user_id === e.self_id) {
      return false
    }

    const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
    if (memberInfo?.role !== "member") {
      return false
    }
    await e.group.kickMember(targetQQ, isBlacklist)

    if (isBlacklist) {
      e.reply(`✅ 已将「${memberName}」移出本群并加入黑名单。`)
    } else {
      e.reply(`✅ 已将「${memberName}」移出本群。`)
    }
    return true
  }

  async handleEssenceMessage(e) {
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    const replySegment = e.message.find(segment => segment.type === "reply")
    if (!replySegment?.id) {
      return false
    }

    const action = e.msg.replace(/^#?/, "").includes("设为精华") ? "set" : "remove"
    const messageId = replySegment.id

    if (action === "set") {
      await this.e.bot.setEssenceMessage(messageId)
      e.reply("✅ 已将该消息设为群精华！")
    } else {
      await this.e.bot.removeEssenceMessage(messageId)
      e.reply("✅ 已取消该消息的精华状态。")
    }
    return true
  }

  parseMuteCommand(msg) {
    let targetQQ = msg.match(/(\d{5,12})/) ? msg.match(/(\d{5,12})/)[1] : this.e.at
    let timeMatch = msg.match(/(\d+)\s*(分钟|小时|天|分|时|秒)?/)
    let duration = 0
    let unitText = ""
    const maxDuration = 2592000

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

      if (duration > maxDuration) {
        duration = maxDuration
        unitText = "30天 (已达上限)"
      }
    }

    return { targetQQ, duration, unit: unitText }
  }

  async handleAllMuteAction(e) {
    if (e.sender.role === "member") {
      return false
    }
    let bot
    try {
      bot = await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      bot = (await e.group.pickMember(Number(e.self_id))).info
    }
    if (bot.role === "member") {
      return false
    }
    const isMute = e.msg.includes("全员禁言")

    try {
      if (isMute) {
        await e.group.muteAll(true)
        await e.reply("✅已开启全员禁言。")
      } else {
        await e.group.muteAll(false)
        await e.reply("✅已关闭全员禁言。")
      }
    } catch (err) {
      logger.error("全体禁言/解禁操作失败:", err)
    }
  }

  async blockUser(e) {
    const cleanMsg = e.msg.replace(/^#?/, "")
    const isBlock = cleanMsg.startsWith("拉黑")

    let targetQQ, duration, unit

    if (isBlock) {
      const parsed = this.parseMuteCommand(cleanMsg)
      targetQQ = parsed.targetQQ
      duration = parsed.duration
      unit = parsed.unit

      if (duration === 0) {
        duration = 300
        unit = "5分钟"
      }
    } else {
      targetQQ = cleanMsg.replace(/解黑/g, "").trim().replace("@", "") || e.at
      duration = 0
    }

    if (!targetQQ) return false
    targetQQ = Number(targetQQ)
    if (isNaN(targetQQ)) return false

    const senderId = e.sender.user_id
    const senderName = e.sender?.card || e.sender?.nickname || senderId

    let targetName = targetQQ
    if (e.isGroup) {
      try {
        const mm = await e.group.getMemberMap(true)
        const targetMember = mm.get(targetQQ)
        if (targetMember) {
          targetName = targetMember.card || targetMember.nickname || targetQQ
        }
      } catch (err) {}
    }

    const masterQQs = Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]
    const permissionConfig = Setting.getConfig("Permission")
    const authorizedUsers = permissionConfig?.enable || []

    if (masterQQs.includes(targetQQ)) {
      return false
    }

    let hasPermission = false

    if (senderId === targetQQ) {
      hasPermission = true
    } else if (masterQQs.includes(senderId)) {
      hasPermission = true
    } else if (authorizedUsers.includes(senderId)) {
      hasPermission = true
    }

    if (!hasPermission) {
      return false
    }

    const blockListPath = path.join(plugindata, "blocklist.json")
    let data = {}
    if (fs.existsSync(blockListPath)) {
      try {
        data = JSON.parse(fs.readFileSync(blockListPath, "utf8"))
      } catch (err) {
        logger.error("读取黑名单失败", err)
      }
    }

    if (duration === 0) {
      if (data[targetQQ]) {
        delete data[targetQQ]
        fs.writeFileSync(blockListPath, JSON.stringify(data, null, 2))
        return await e.reply(`${targetName}(QQ:${targetQQ}) 已被解除拉黑。`)
      } else {
        return false
      }
    } else {
      const expireTime = Date.now() + duration * 1000
      data[targetQQ] = expireTime

      const dir = path.dirname(blockListPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(blockListPath, JSON.stringify(data, null, 2))
      return await e.reply(`${targetName}(QQ:${targetQQ}) 已被拉黑 ${unit}，期间将无视其任何消息。`)
    }
  }
}
