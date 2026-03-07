import { getImg } from "../lib/utils.js"
import { PermissionManager } from "../lib/PermissionManager.js"

const conversationStateNeverSpoken = {}
const conversationStateInactive = {}
const conversationStateLevel = {}

export class GroupManager extends plugin {
  constructor() {
    super({
      name: "群管插件",
      dsc: "合并了入群指令、清理不活跃成员、禁言、踢人、精华消息等功能 (兼容版)",
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
    // 1. 尝试直接从 member 属性获取 (部分适配器)
    if (e.group?.info?.role) return e.group.info.role

    // 2. 尝试 pickMember 获取 (标准)
    try {
      const me = await e.group.pickMember(e.self_id).getInfo()
      if (me && me.role) return me.role
    } catch (err) { }

    // 3. 兜底
    return "member"
  }

  // --- 业务逻辑 ---

  async handleApprovalCommand(e) {
    // 【保留原文件权限判断】
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    if (!global.GroupRequests) {
      return false
    }

    const match = e.msg.match(/^#?开门\s*(\d+)$/)
    if (!match) return false
    const markerId = Number(match[1])

    const groupRequests = global.GroupRequests.get(e.group_id)

    if (!groupRequests) {
      return false
    }

    if (!groupRequests.has(markerId)) {
      await this.reply(`门牌号 ${markerId} 不存在或已过期`, false, { recallMsg: 10 })
      return true
    }

    const flag = groupRequests.get(markerId)

    try {
      await this.reply(`好的，正在开门...`)
      // setGroupAddRequest 通常双端通用，只要 flag 格式正确
      await e.bot.setGroupAddRequest(flag, true)
      groupRequests.delete(markerId)
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

    if (!global.GroupRequests) {
      return false
    }

    const match = e.msg.match(/^#?(关门|拒绝)\s*(\d+)\s*(.*?)$/)
    if (!match) return false
    const markerId = Number(match[2])
    const reason = match[3]?.trim() || ""

    const groupRequests = global.GroupRequests.get(e.group_id)

    if (!groupRequests) {
      return false
    }

    if (!groupRequests.has(markerId)) {
      await this.reply(`门牌号 ${markerId} 不存在或已过期`, false, { recallMsg: 10 })
      return true
    }

    const flag = groupRequests.get(markerId)

    try {
      await this.reply(`正在拒绝入群请求...`)
      await e.bot.setGroupAddRequest(flag, false, reason)
      groupRequests.delete(markerId)
    } catch (err) {
      logger.error(`[GroupManager] 拒绝入群失败: ${err}`)
      await this.reply(`拒绝失败，Flag可能已失效。`, false, { recallMsg: 10 })
    }

    return true
  }

  async prepareCleanupNeverSpoken(e) {
    // 【保留原文件权限判断】
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    if (conversationStateNeverSpoken[e.user_id]) {
      delete conversationStateNeverSpoken[e.user_id]
      this.finish("confirmCleanupNeverSpoken", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) {
      return await this.reply("获取群成员列表失败，请稍后再试。", false, { recallMsg: 10 })
    }

    const inactiveMembers = []
    memberMap.forEach(member => {
      if (member.user_id === e.bot.uin) return
      // 判断加入时间是否等于最后发言时间 (兼容逻辑)
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

    // 尝试发送合并消息
    await this.sendCompatibleForwardMsg(e, inactiveMembers, `检测到 ${inactiveMembers.length} 位从未发言的成员`)

    conversationStateNeverSpoken[e.user_id] = { inactiveMembers }
    this.setContext("confirmCleanupNeverSpoken", true, 30)

    await this.reply(
      `以上是所有从未发言的成员列表共${inactiveMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`
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
    await this.reply(`正在开始清理...`, false, { recallMsg: 10 })

    for (const member of inactiveMembers) {
      try {
        await e.group.kickMember(member.user_id)
        successCount++
      } catch (err) {
        logger.warn(`清理成员 ${member.user_id} 失败`)
      }
      await new Promise(resolve => setTimeout(resolve, 800))
    }
    await this.reply(`清理完成。成功清理 ${successCount} 人。`, false, { recallMsg: 10 })
  }

  async prepareCleanupInactive(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const match = e.msg.match(/^#?清理(\d+)(天|个月)未发言的人$/)
    const value = parseInt(match[1])
    const unit = match[2]
    let days = unit === "天" ? value : value * 30

    if (isNaN(days) || days <= 0) return await this.reply("请输入有效的时间！")

    if (conversationStateInactive[e.user_id]) {
      delete conversationStateInactive[e.user_id]
      this.finish("confirmCleanupInactive", true)
    }

    const memberMap = await e.group.getMemberMap(true)
    if (!memberMap) return await this.reply("获取群成员列表失败。")

    const currentTime = Math.floor(Date.now() / 1000)
    const inactiveThreshold = days * 24 * 60 * 60
    const inactiveMembers = []

    memberMap.forEach(member => {
      if (member.user_id === e.bot.uin) return

      let lastSent = member.last_sent_time
      if (lastSent > 10000000000) lastSent = Math.floor(lastSent / 1000)

      const timeDifference = currentTime - lastSent
      if (timeDifference > inactiveThreshold) {
        inactiveMembers.push({
          user_id: member.user_id,
          nickname: member.card || member.nickname,
          last_sent_time: lastSent,
        })
      }
    })

    if (inactiveMembers.length === 0) return await this.reply(`最近 ${value}${unit} 内全员活跃！`)

    // 构造转发消息内容
    const nodes = []
    for (const member of inactiveMembers) {
      const lastSentDate = new Date(member.last_sent_time * 1000).toLocaleString()
      nodes.push({
        message: [
          segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`),
          `\n昵称: ${member.nickname}`,
          `\nQQ: ${member.user_id}`,
          `\n最后发言: ${lastSentDate}`,
        ],
        nickname: e.bot.nickname,
        user_id: e.bot.uin,
      })
    }
    nodes.unshift({
      message: `检测到 ${inactiveMembers.length} 位超过 ${value}${unit} 未发言的成员`,
      nickname: e.bot.nickname,
      user_id: e.bot.uin,
    })

    const forwardMsg = await e.group.makeForwardMsg(nodes)
    await this.reply(forwardMsg)

    conversationStateInactive[e.user_id] = { inactiveMembers }
    this.setContext("confirmCleanupInactive", true, 30)
    await this.reply(`请发送【取消】或【确认清理】`)
  }

  async confirmCleanupInactive() {
    const e = this.e
    const userInput = e.raw_message?.trim()
    const state = conversationStateInactive[e.user_id]
    if (!state) return

    if (userInput === "取消") {
      delete conversationStateInactive[e.user_id]
      this.finish("confirmCleanupInactive", true)
      await this.reply("操作已取消。")
      return
    }
    if (userInput !== "确认清理") return

    const { inactiveMembers } = state
    delete conversationStateInactive[e.user_id]
    this.finish("confirmCleanupInactive", true)

    let successCount = 0
    await this.reply(`开始清理...`)
    for (const member of inactiveMembers) {
      try { await e.group.kickMember(member.user_id); successCount++; } catch { }
      await new Promise(r => setTimeout(r, 800))
    }
    await this.reply(`清理完成，共清理 ${successCount} 人。`)
  }

  async prepareCleanupByLevel(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const match = e.msg.match(/^#?清理低于(\d+)级的人$/)
    const level = parseInt(match[1])
    if (isNaN(level)) return

    const memberMap = await e.group.getMemberMap(true)
    const lowLevelMembers = []
    memberMap.forEach(m => {
      if (m.user_id !== e.bot.uin && m.role === 'member' && m.level < level) {
        lowLevelMembers.push({ user_id: m.user_id, nickname: m.card || m.nickname, level: m.level })
      }
    })
    if (lowLevelMembers.length === 0) return await this.reply("没有符合条件的成员")

    conversationStateLevel[e.user_id] = { lowLevelMembers }
    this.setContext("confirmCleanupByLevel", true, 30)
    await this.reply(`检测到 ${lowLevelMembers.length} 人，请发送【确认清理】`)
  }

  async confirmCleanupByLevel() {
    const e = this.e; const state = conversationStateLevel[e.user_id];
    if (!state || e.msg.trim() !== '确认清理') return;

    delete conversationStateLevel[e.user_id]; this.finish("confirmCleanupByLevel", true);
    let count = 0;
    await this.reply("开始清理...")
    for (let m of state.lowLevelMembers) {
      try { await e.group.kickMember(m.user_id); count++; } catch { }
      await new Promise(r => setTimeout(r, 800))
    }
    await this.reply(`清理完成 ${count} 人`)
  }

  async handleMuteAction(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const cleanMsg = e.msg.replace(/^#?/, "")
    const isMute = cleanMsg.startsWith("禁言")

    if (isMute) {
      let { targetQQ, duration, unit } = this.parseMuteCommand(cleanMsg)
      if (!targetQQ) return false
      if (duration === 0) { duration = 300; unit = "5分钟"; }

      try {
        await e.group.muteMember(targetQQ, duration)
        await this.reply(`✅ 已将「${targetQQ}」禁言${unit}。`)
      } catch (err) {
        await this.reply("禁言失败，请检查权限或对方身份。")
      }
    } else {
      const targetQQ = cleanMsg.replace(/解禁/g, "").trim().replace("@", "") || e.at
      if (!targetQQ) return false
      try {
        await e.group.muteMember(targetQQ, 0)
        await this.reply(`✅ 已解除禁言。`)
      } catch {
        await this.reply("解禁失败。")
      }
    }
    return true
  }

  async kickMember(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    const isBlacklist = e.msg.includes("踢黑")
    const targetQQ = e.at || e.msg.replace(/#?(踢|踢黑)/, "").trim()
    if (!targetQQ) return false

    try {
      await e.group.kickMember(targetQQ, isBlacklist)
      await this.reply(isBlacklist ? "已踢出并拉黑" : "已踢出")
    } catch (err) {
      await this.reply("踢人失败，权限不足或对方是管理")
    }
    return true
  }

  async handleEssenceMessage(e) {
    // 仅限管理
    const botRole = await this.getBotRole(e)
    if (botRole === "member") return false

    const source = e.source
    if (!source) return false

    const isSet = e.msg.includes("设为")

    const tryOp = async (id) => {
      if (isSet) await e.group.setEssenceMessage(id)
      else await e.group.removeEssenceMessage(id)
    }

    try {
      await tryOp(source.seq || source.id)
      await this.reply("操作成功")
    } catch (err) {
      try {
        await tryOp(source.id || source.seq)
        await this.reply("操作成功")
      } catch {
        await this.reply("操作精华消息失败")
      }
    }
    return true
  }

  parseMuteCommand(msg) {
    let targetQQ = msg.match(/(\d{5,12})/) ? msg.match(/(\d{5,12})/)[1] : this.e.at
    let timeMatch = msg.match(/(\d+)\s*(分钟|小时|天|分|时|秒)?/)
    let duration = 0
    let unitText = ""
    const maxDuration = 2592000 // 30天

    if (timeMatch) {
      const time = parseInt(timeMatch[1])
      const unit = timeMatch[2] || "秒"
      switch (unit) {
        case "秒": duration = time; unitText = `${time}秒`; break
        case "分": case "分钟": duration = time * 60; unitText = `${time}分钟`; break
        case "时": case "小时": duration = time * 3600; unitText = `${time}小时`; break
        case "天": duration = time * 86400; unitText = `${time}天`; break
      }
      if (duration > maxDuration) { duration = maxDuration; unitText = "30天 (已达上限)"; }
    }
    return { targetQQ, duration, unit: unitText }
  }

  async handleMuteAll(e) {
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }
    const isMute = e.msg.includes("全员禁言")
    try {
      await e.group.muteAll(isMute)
      await this.reply(isMute ? "已开启全员禁言" : "已关闭全员禁言")
    } catch {
      await this.reply("操作失败，请确保Bot是管理员。")
    }
  }

  async handleGroupNotice(e) {
    // 【权限检查】
    if (e.sender.role === "member" && !PermissionManager.hasExplicitPermission(e.group_id, e.sender.user_id)) {
      return false
    }

    // 【Bot权限检查】
    const botRole = await this.getBotRole(e)
    if (botRole === "member") {
      return false
    }

    const match = e.msg.match(/^#?发群公告(\\d{1,2})?(.*)$/)
    if (!match) return false

    const paramsStr = match[1]
    let content = match[2].trim()
    let image = null
    const imgList = await getImg(e, false)
    if (imgList && imgList.length > 0) image = imgList[0]

    if (!content) return false

    // 构造高级参数 (NTQQ支持)
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

    try {
      // 方案A：尝试发送高级公告 (NTQQ / LLOB)
      // 注意：如果协议不支持 params，可能会忽略或报错，所以放在 try 中
      await e.group.sendNotice(content, image, params)
      await this.reply("✅ 群公告发送成功！")
    } catch (err) {
      // 方案B：降级发送纯文本公告 (ICQQ / OICQ)
      try {
        // logger.warn("[GroupManager] 高级公告发送失败，尝试降级发送文本公告...")
        await e.group.sendNotice(content)
        await this.reply("✅ 群公告发送成功 (文本模式)")
      } catch (err2) {
        logger.error("发送公告失败", err2)
        await this.reply("发送公告失败，可能是协议不支持或Bot非管理员。")
      }
    }
    return true
  }

  // 辅助函数：构造转发消息 (兼容)
  async sendCompatibleForwardMsg(e, members, title) {
    const nodes = members.map(m => ({
      message: [`${m.nickname}(${m.user_id})`],
      nickname: e.bot.nickname,
      user_id: e.bot.uin
    }))
    nodes.unshift({ message: title, nickname: e.bot.nickname, user_id: e.bot.uin })
    const msg = await e.group.makeForwardMsg(nodes)
    await this.reply(msg)
  }
}