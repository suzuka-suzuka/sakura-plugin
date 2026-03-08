import { getImg } from "../lib/utils.js"
import { PermissionManager } from "../lib/PermissionManager.js"

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
          reg: "^#?(关门|拒绝)\\s*(\\d+)\\s*(.*?)$",
          fnc: "handleRejectCommand",
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
          reg: "^#?发群公告(\\d{1,2})?.*$",
          fnc: "handleGroupNotice",
          log: false,
        },
      ],
    })
  }

  // --- 辅助函数：获取Bot角色 (兼容多种适配器) ---
  async getBotRole(e) {
    if (e.group?.info?.role) return e.group.info.role
    try {
      const me = await e.group.pickMember(e.self_id).getInfo()
      if (me && me.role) return me.role
    } catch (err) { }
    return "member"
  }

  // --- 辅助函数：获取Bot成员信息 (兼容icqq/onebotv11) ---
  async getBotMemberInfo(e) {
    try {
      return await e.group.pickMember(e.self_id).getInfo(true)
    } catch {
      return (await e.group.pickMember(Number(e.self_id))).info
    }
  }

  // --- 辅助函数：获取指定成员信息 (兼容icqq/onebotv11) ---
  async getMemberInfo(e, qq) {
    try {
      return await e.group.pickMember(qq).getInfo(true)
    } catch {
      return (await e.group.pickMember(Number(qq))).info
    }
  }

  // --- 辅助函数：自定义转发消息卡片显示 ---
  customizeForwardMsg(forwardMsg, title, source) {
    try {
      // 尝试修改 detail 对象的 news/source
      const applyDetail = (detail) => {
        if (!detail) return false
        detail.news = [{ text: title }]
        detail.source = source
        detail.summary = source
        return true
      }

      if (typeof forwardMsg.data === "object") {
        // icqq / Lain-plugin 格式
        applyDetail(forwardMsg.data?.meta?.detail)
      } else if (typeof forwardMsg.data === "string") {
        // XML 格式 (旧适配器)
        forwardMsg.data = forwardMsg.data
          .replace(/\n/g, "")
          .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, "___")
          .replace(/___+/, `<title color="#777777" size="26">${title}</title>`)
      }

      // Lain-plugin 直接在 forwardMsg 上的 meta
      if (forwardMsg.meta?.detail) {
        applyDetail(forwardMsg.meta.detail)
      }
    } catch { }
    return forwardMsg
  }

  // --- 业务逻辑 ---

  async handleApprovalCommand(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const match = e.msg.match(/^#?开门\s*(\d+)$/)
    if (!match) return false
    const markerId = match[1]

    const redisKey = `sakura:group-request:${e.group_id}:${markerId}`
    const flag = await redis.get(redisKey)

    if (!flag) {
      await this.reply(`门牌号 ${markerId} 不存在或已过期`, false, { recallMsg: 10 })
      return true
    }

    try {
      await this.reply(`好的，我这就开门`)
      await e.bot.setGroupAddRequest(flag, true)
      await redis.del(redisKey)
    } catch (err) {
      logger.error(`[GroupManager] 开门失败: ${err}`)
      await this.reply(`开门失败，Flag可能已失效。`, false, { recallMsg: 10 })
    }

    return true
  }

  async handleRejectCommand(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const match = e.msg.match(/^#?(关门|拒绝)\s*(\d+)\s*(.*?)$/)
    if (!match) return false
    const markerId = match[2]
    const reason = match[3]?.trim() || ""

    const redisKey = `sakura:group-request:${e.group_id}:${markerId}`
    const flag = await redis.get(redisKey)

    if (!flag) {
      await this.reply(`门牌号 ${markerId} 不存在或已过期`, false, { recallMsg: 10 })
      return true
    }

    try {
      await this.reply(`好的，我这就关门`)
      await e.bot.setGroupAddRequest(flag, false, reason)
      await redis.del(redisKey)
    } catch (err) {
      logger.error(`[GroupManager] 拒绝入群失败: ${err}`)
      await this.reply(`拒绝失败，Flag可能已失效。`, false, { recallMsg: 10 })
    }

    return true
  }

  async prepareCleanupNeverSpoken(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }
    const bot = await this.getBotMemberInfo(e)
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
      return await this.reply("获取群成员列表失败，请稍后再试。", false, { recallMsg: 10 })
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
      return await this.reply("非常棒！本群所有成员都发言过啦！", false, { recallMsg: 10 })
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

    let forwardMsg = await e.group.makeForwardMsg(forwardMsgNodes)
    forwardMsg = this.customizeForwardMsg(forwardMsg, `共检测到 ${inactiveMembers.length} 人`, "从未发言成员列表")
    await this.reply(forwardMsg)

    conversationStateNeverSpoken[e.user_id] = { inactiveMembers }
    this.setContext("confirmCleanupNeverSpoken", true, 30)

    await this.reply(
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
      await this.reply("操作已取消。", false, { recallMsg: 10 })
      return
    }

    if (userInput !== "确认清理") return

    const { inactiveMembers } = state

    delete conversationStateNeverSpoken[e.user_id]
    this.finish("confirmCleanupNeverSpoken", true)

    let successCount = 0
    await this.reply(`正在开始清理 ${inactiveMembers.length} 位从未发言的成员...`, false, {
      recallMsg: 10,
    })

    for (const member of inactiveMembers) {
      await e.group.kickMember(member.user_id)
      successCount++
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    let reportMsg = `清理完成。成功清理 ${successCount} 人。`
    await this.reply(reportMsg, false, { recallMsg: 10 })
  }

  async prepareCleanupInactive(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }
    const bot = await this.getBotMemberInfo(e)
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
      return await this.reply("请输入有效的时间！", false, { recallMsg: 10 })
    }

    if (conversationStateInactive[e.user_id]) {
      delete conversationStateInactive[e.user_id]
      this.finish("confirmCleanupInactive", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[清理长时间未发言] 获取群成员列表失败`)
      return await this.reply("获取群成员列表失败，请稍后再试。", false, { recallMsg: 10 })
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
      return await this.reply(`非常棒！本群所有成员在最近 ${value}${unit} 内都发言过啦！`, false, {
        recallMsg: 10,
      })
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

    let forwardMsg = await e.group.makeForwardMsg(forwardMsgNodes)
    forwardMsg = this.customizeForwardMsg(forwardMsg, `共检测到 ${inactiveMembers.length} 人`, "长期潜水成员列表")
    await this.reply(forwardMsg)

    conversationStateInactive[e.user_id] = { inactiveMembers }
    this.setContext("confirmCleanupInactive", true, 30)

    await this.reply(
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
      await this.reply("操作已取消。", false, { recallMsg: 10 })
      return
    }

    if (userInput !== "确认清理") return

    const { inactiveMembers } = state

    delete conversationStateInactive[e.user_id]
    this.finish("confirmCleanupInactive", true)

    let successCount = 0
    await this.reply(`正在开始清理 ${inactiveMembers.length} 位长时间未发言的成员...`, false, {
      recallMsg: 10,
    })

    for (const member of inactiveMembers) {
      await e.group.kickMember(member.user_id)
      successCount++
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    let reportMsg = `清理完成。成功清理 ${successCount} 人。`
    await this.reply(reportMsg, false, { recallMsg: 10 })
  }

  async prepareCleanupByLevel(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }
    const bot = await this.getBotMemberInfo(e)
    if (bot.role === "member") {
      return false
    }
    const match = e.msg.match(/^#?清理低于(\d+)级的人$/)
    const level = parseInt(match[1])

    if (isNaN(level) || level <= 0) {
      return await this.reply("请输入有效的等级！", false, { recallMsg: 10 })
    }

    if (conversationStateLevel[e.user_id]) {
      delete conversationStateLevel[e.user_id]
      this.finish("confirmCleanupByLevel", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) {
      logger.error(`[清理低等级成员] 获取群成员列表失败`)
      return await this.reply("获取群成员列表失败，请稍后再试。", false, { recallMsg: 10 })
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
      return await this.reply(`本群没有群等级低于 ${level} 级的成员。`, false, { recallMsg: 10 })
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

    let forwardMsg = await e.group.makeForwardMsg(forwardMsgNodes)
    forwardMsg = this.customizeForwardMsg(forwardMsg, `共检测到 ${lowLevelMembers.length} 人`, "低等级成员列表")
    await this.reply(forwardMsg)

    conversationStateLevel[e.user_id] = { lowLevelMembers }
    this.setContext("confirmCleanupByLevel", true, 30)

    await this.reply(
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
      await this.reply("操作已取消。", false, { recallMsg: 10 })
      return
    }

    if (userInput !== "确认清理") return

    const { lowLevelMembers } = state

    delete conversationStateLevel[e.user_id]
    this.finish("confirmCleanupByLevel", true)

    let successCount = 0
    await this.reply(`正在开始清理 ${lowLevelMembers.length} 位低等级的成员...`, false, {
      recallMsg: 10,
    })

    for (const member of lowLevelMembers) {
      await e.group.kickMember(member.user_id)
      successCount++
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    let reportMsg = `清理完成。成功清理 ${successCount} 人。`
    await this.reply(reportMsg, false, { recallMsg: 10 })
  }

  async handleMuteAction(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }
    const bot = await this.getBotMemberInfo(e)
    if (bot.role === "member") {
      return false
    }
    const cleanMsg = e.msg.replace(/^#?/, "")
    const isMute = cleanMsg.startsWith("禁言")

    if (isMute) {
      let { targetQQ, duration, unit } = this.parseMuteCommand(cleanMsg)
      if (!targetQQ) return false

      if (duration === 0) {
        if (!/^禁言\s*(\d+|@[\s\S]*)?$/.test(cleanMsg.trim())) {
          return false
        }
        duration = 300
        unit = "5分钟"
      }

      const memberInfo = await this.getMemberInfo(e, targetQQ)
      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
      if (memberInfo?.role !== "member") {
        return false
      }
      await e.group.muteMember(targetQQ, duration)
      await this.reply(`✅ 已将「${memberName}」禁言${unit}。`, false, { recallMsg: 10 })
    } else {
      const targetQQ = cleanMsg.replace(/解禁/g, "").trim().replace("@", "") || e.at
      if (!targetQQ) return false

      const memberInfo = await this.getMemberInfo(e, targetQQ)

      const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
      if (memberInfo?.role !== "member") {
        return false
      }
      await e.group.muteMember(targetQQ, 0)
      await this.reply(`✅ 已将「${memberName}」解除禁言。`, false, { recallMsg: 10 })
    }
    return true
  }

  async kickMember(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }
    const bot = await this.getBotMemberInfo(e)
    if (bot.role === "member") {
      return false
    }
    const cleanMsg = e.msg.replace(/^#?/, "")
    const isBlacklist = cleanMsg.startsWith("踢黑")
    const command = isBlacklist ? "踢黑" : "踢"
    const targetQQ = cleanMsg.replace(command, "").trim().replace("@", "") || e.at

    if (!targetQQ) return false

    const memberInfo = await this.getMemberInfo(e, targetQQ)

    if (memberInfo.user_id === e.self_id) {
      return false
    }

    const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ
    if (memberInfo?.role !== "member") {
      return false
    }
    await e.group.kickMember(targetQQ, isBlacklist)

    if (isBlacklist) {
      await this.reply(`✅ 已将「${memberName}」移出本群并加入黑名单。`, false, { recallMsg: 10 })
    } else {
      await this.reply(`✅ 已将「${memberName}」移出本群。`, false, { recallMsg: 10 })
    }
    return true
  }

  async handleEssenceMessage(e) {
    const bot = await this.getBotMemberInfo(e)
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
      await this.reply("✅ 已将该消息设为群精华！", false, { recallMsg: 10 })
    } else {
      await this.e.bot.removeEssenceMessage(messageId)
      await this.reply("✅ 已取消该消息的精华状态。", false, { recallMsg: 10 })
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

  async handleMuteAll(e) {
    if (e.sender.role === "member") {
      return false
    }
    const bot = await this.getBotMemberInfo(e)
    if (bot.role === "member") {
      return false
    }
    const isMute = e.msg.includes("全员禁言")

    try {
      if (isMute) {
        await e.group.muteAll(true)
        await this.reply("✅已开启全员禁言。", false, { recallMsg: 10 })
      } else {
        await e.group.muteAll(false)
        await this.reply("✅已关闭全员禁言。", false, { recallMsg: 10 })
      }
    } catch (err) {
      logger.error("全体禁言/解禁操作失败:", err)
    }
  }

  async handleGroupNotice(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const bot = await this.getBotMemberInfo(e)
    if (bot.role === "member") {
      return false
    }

    const match = e.msg.match(/^#?发群公告(\d{1,2})?(.*)$/)
    if (!match) return false

    const paramsStr = match[1]
    let content = match[2].trim()

    let image = null
    const imgList = await getImg(e, false)
    if (imgList && imgList.length > 0) {
      image = imgList[0]
    }

    if (!content) {
      return false
    }

    let params = {
      pinned: 0,
      type: 0,
      confirm_required: 0,
      is_show_edit_card: 0,
      tip_window_type: 1,
    }

    if (paramsStr) {
      const isPop = parseInt(paramsStr[0])
      params.tip_window_type = isPop === 1 ? 0 : 1

      if (paramsStr.length > 1) {
        const isPinned = parseInt(paramsStr[1])
        params.pinned = isPinned === 1 ? 1 : 0
      }
    }

    // 构造 _send_group_notice 的参数
    const noticeParams = { group_id: e.group_id, content }
    if (image) noticeParams.image = image

    // 如果有 cookies + bkn (icqq)，优先用 Web API，因为 icqq 的 sendNotice 会假成功
    const botObj = e.bot ?? Bot
    if (botObj.cookies?.["qun.qq.com"] && botObj.bkn) {
      try {
        await this.sendNoticeByWebApi(e, content, image)
        await this.reply("✅ 群公告发送成功！", false, { recallMsg: 10 })
        return true
      } catch (err) {
        logger.warn("[GroupManager] Web API 发送群公告失败，尝试其他方式:", err.message)
      }
    }

    try {
      // 方案A：e.group.sendNotice (NTQQ/Sakura Group对象)
      await e.group.sendNotice(content, image, params)
      await this.reply("✅ 群公告发送成功！", false, { recallMsg: 10 })
    } catch {
      try {
        // 方案B：e.bot.sendGroupNotice (Sakura Client)
        await e.bot.sendGroupNotice(e.group_id, content, image)
        await this.reply("✅ 群公告发送成功！", false, { recallMsg: 10 })
      } catch {
        try {
          // 方案C：e.bot.sendApi 直接调用 _send_group_notice (Lain-plugin LagrangeCore/Shamrock)
          await e.bot.sendApi("_send_group_notice", noticeParams)
          await this.reply("✅ 群公告发送成功！", false, { recallMsg: 10 })
        } catch (err) {
          logger.error("发送群公告失败，所有方式均不可用:", err)
          await this.reply("❌ 发送群公告失败，当前协议可能不支持此功能。", false, { recallMsg: 10 })
        }
      }
    }
    return true
  }

  // 通过 QQ Web API 发送群公告 (兼容icqq)
  async sendNoticeByWebApi(e, content, image) {
    const bot = e.bot ?? Bot
    const cookies = bot.cookies?.["qun.qq.com"]
    const bkn = bot.bkn
    if (!cookies || !bkn) throw new Error("无法获取 cookies 或 bkn")

    const data = new URLSearchParams()
    data.append("qid", e.group_id)
    data.append("bkn", bkn)
    data.append("text", content)
    data.append("pinned", "0")
    data.append("type", "1")
    data.append("settings", JSON.stringify({
      is_show_edit_card: 1,
      tip_window_type: 1,
      confirm_required: 1,
    }))

    const url = `https://web.qun.qq.com/cgi-bin/announce/add_qun_notice?bkn=${bkn}`
    const res = await fetch(url, {
      method: "POST",
      body: data,
      headers: {
        "Cookie": cookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })
    const result = await res.json()
    if (result.ec !== 0) {
      throw new Error(`Web API 返回错误: ec=${result.ec}, em=${result.em || ""}`)
    }
    return result
  }
}
