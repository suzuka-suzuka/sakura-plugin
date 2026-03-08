/**
 * icqq/ntqq 双端兼容版 GroupAddRequest.js
 * 现已重构为使用 Redis 存储申请数据，有效期 1 天
 */

export class groupRequestListener extends plugin {
  constructor() {
    super({
      name: "入群申请监听",
      dsc: "监听入群申请，并发送通知 (兼容版)",
      event: "request.group.add",
      priority: 50,
      rule: [
        {
          fnc: "handleGroupAddRequest",
          log: false,
        },
      ],
    })
  }

  async handleGroupAddRequest(e) {
    // --- 兼容逻辑：获取昵称 ---
    // 1. 优先尝试直接获取 (ICQQ特性)
    let nickname = e.nickname || e.sender?.nickname

    // 2. 如果没有，尝试 NTQQ 方式 (pickUser)
    if (!nickname) {
      try {
        const userObject = e.bot.pickUser(e.user_id)
        const userInfo = await userObject.getInfo()
        if (userInfo && userInfo.nickname) nickname = userInfo.nickname
      } catch (err) { }
    }

    // 3. 如果还是没有，尝试 ICQQ 老方式 (getStrangerInfo)
    if (!nickname) {
      try {
        const userInfo = await e.bot.getStrangerInfo(e.user_id)
        nickname = userInfo.nickname
      } catch (err) { }
    }

    // 兜底
    if (!nickname) nickname = "未知用户"
    // 使用 Redis 获取自增门牌号
    const counterKey = `sakura:group-request-counter:${e.group_id}`
    let markerId = 0

    try {
      markerId = await redis.incr(counterKey)
      if (markerId === 1) {
        await redis.expire(counterKey, 86400) // 第一天自动设置 24 小时过期
      }

      // 存储 flag 到 Redis，有效期 24 小时 (86400秒)
      const requestKey = `sakura:group-request:${e.group_id}:${markerId}`
      if (typeof redis.setEx === "function") {
        await redis.setEx(requestKey, 86400, e.flag)
      } else if (typeof redis.setex === "function") {
        await redis.setex(requestKey, 86400, e.flag)
      } else {
        await redis.set(requestKey, e.flag, { EX: 86400 })
      }
    } catch (err) {
      logger.error(`[入群监听] Redis写入出错: ${err}`)
      return false // 不阻断，但无法发送正确提示
    }

    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=100`

    const message = [
      `来人啦\n`,
      `门牌号: ${markerId}\n`,
      `敲门人: ${nickname} (${e.user_id})\n`,
      segment.image(avatarUrl),
      `\n敲门口令: ${e.comment || "这个人啥也没说"}`,
    ]

    // --- 兼容逻辑：发送消息 ---
    try {
      // NTQQ 推荐方式
      await e.bot.pickGroup(e.group_id).sendMsg(message)
    } catch {
      try {
        // 通用/ICQQ 方式
        await Bot.sendGroupMsg(e.group_id, message)
      } catch (err) {
        logger.error(`[入群监听] 发送通知失败: ${err}`)
      }
    }

    return false
  }
}