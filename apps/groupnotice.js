import { getAI } from "../lib/AIUtils/getAI.js"
import { parseAtMessage } from "../lib/AIUtils/messaging.js"

const AI_CHANNEL = "2.5"
const AI_PROMPT =
  "你是一个QQ群的成员。你的任务是根据群成员的变动（新成员加入或成员离开）以及最近的群聊记录，生成一个自然、得体的回应。当有新人加入时，你可以根据最近的聊天内容，简单告知新人大家在聊什么，并表示欢迎。当有成员离开时，你可以根据聊天内容推测可能的原因（如果可能的话），或者仅仅表达惋惜。你的回应应该简短、友好，并像一个真正的群成员一样融入对话。下面是具体的情景和聊天记录："
const USE_GROUP_CONTEXT = true

async function createMockMessageEvent(original_e) {
  const group = Bot.pickGroup(original_e.group_id)
  if (!group) {
    logger.warn(`无法找到群组: ${original_e.group_id}`)
    return null
  }

  const redisKey = `sakura:gml:${original_e.group_id}`
  let nickname = original_e.nickname || "未知用户"
  let card = ""
  let role = "member"
  let title = ""

  try {
    const memberJson = await redis.hGet(redisKey, String(original_e.user_id))
    if (memberJson) {
      const memberInfo = JSON.parse(memberJson)
      nickname = memberInfo.nickname || nickname
      card = memberInfo.card || ""
      role = memberInfo.role || "member"
      title = memberInfo.title || ""
    }
  } catch (e) {
    logger.error(`从Redis获取成员信息失败: ${e}`)
  }

  const sender = {
    user_id: original_e.user_id,
    nickname: nickname,
    card: card,
    role: role,
    title: title,
  }

  const mockE = {
    isGroup: true,
    group_id: original_e.group_id,
    user_id: original_e.user_id,
    group: group,
    sender: sender,
    self_id: Bot.uin,
    bot: Bot,
  }

  return mockE
}

async function updateGroupMemberList(group_id) {
  if (!group_id || isNaN(Number(group_id))) {
    return
  }

  try {
    const memberMap = await Bot.pickGroup(group_id)?.getMemberMap(true)
    const key = `sakura:gml:${group_id}`

    if (!memberMap) return

    await redis.del(key)

    if (memberMap.size > 0) {
      const memberData = {}
      for (const member of memberMap.values()) {
        memberData[member.user_id] = JSON.stringify({
          card: member.card || "",
          nickname: member.nickname || "",
          role: member.role || "member",
          title: member.title || "",
        })
      }
      await redis.hSet(key, memberData)
      await redis.expire(key, 7 * 24 * 60 * 60)
    }
  } catch (error) {
    logger.error(`更新群[${group_id}]成员列表缓存失败`, error)
  }
}

export class groupNoticeAI extends plugin {
  constructor() {
    super({
      name: "群成员变动",
      dsc: "新人入群和成员退群",
      event: "notice.group",
      priority: 1135,
    })
  }

  init() {
    setTimeout(async () => {
      await this.cacheAllGroupMembers()
    }, 60 * 1000)
  }

  async accept() {
    if (this.e.user_id === this.e.self_id) return

    const cd = 30
    const key = `sakura:group_notice:cd:${this.e.group_id}`
    if (await redis.get(key)) {
      return
    }

    await redis.set(key, "1", { EX: cd })

    if (this.e.sub_type === "increase") {
      await this.handleIncrease()
    } else if (this.e.sub_type === "decrease") {
      await this.handleDecrease()
    }
  }

  async handleIncrease() {
    await updateGroupMemberList(this.e.group_id)
    const mockE = await createMockMessageEvent(this.e)
    if (!mockE) {
      await this.defaultWelcome()
      return
    }
    const name = mockE.sender.card || mockE.sender.nickname
    const query = `新成员 ${name}(QQ:${mockE.user_id})刚刚加入了群聊。请根据聊天上下文，写一句欢迎词欢迎他。`
    try {
      const aiResponse = await getAI(
        AI_CHANNEL,
        mockE,
        [{ text: query }],
        AI_PROMPT,
        USE_GROUP_CONTEXT,
        false,
        [],
      )
      let responseText = aiResponse.text
      if (responseText) {
        const msg = parseAtMessage(responseText)
        await this.reply(...msg)
      } else {
        await this.defaultWelcome()
      }
    } catch (error) {
      logger.error(`欢迎新人时出错: ${error}`)
      await this.defaultWelcome()
    }
  }

  async handleDecrease() {
    const mockE = await createMockMessageEvent(this.e)
    if (!mockE) {
      await this.defaultFarewell()
      return
    }
    const name = mockE.sender.card || mockE.sender.nickname
    const query = `成员${name}(QQ:${mockE.user_id}) 刚刚离开了群聊。请根据聊天上下文，写一句简短的告别。`
    try {
      const aiResponse = await getAI(
        AI_CHANNEL,
        mockE,
        [{ text: query }],
        AI_PROMPT,
        USE_GROUP_CONTEXT,
        false,
        [],
      )
      let responseText = aiResponse.text
      if (responseText) {
        const msg = parseAtMessage(responseText)
        await this.reply([
          segment.image(`https://q1.qlogo.cn/g?b=qq&s=0&nk=${mockE.user_id}`),
          `${name}(${mockE.user_id}) 退群了\n`,
          ...msg,
        ])
      } else {
        await this.defaultFarewell()
      }
    } catch (error) {
      logger.error(`告别时出错: ${error}`)
      await this.defaultFarewell()
    }
    await updateGroupMemberList(this.e.group_id)
  }

  async defaultWelcome() {
    let msg = "欢迎新人！"
    await this.reply([segment.at(this.e.user_id), msg])
  }

  async defaultFarewell() {
    const redisKey = `sakura:gml:${this.e.group_id}`
    let name = ""
    try {
      const memberJson = await redis.hGet(redisKey, String(this.e.user_id))
      if (memberJson) {
        const memberInfo = JSON.parse(memberJson)
        name = memberInfo.card || memberInfo.nickname
      }
    } catch (e) {
      logger.warn(`从Redis获取用户 ${this.e.user_id} 的缓存信息失败`, e)
    }
    const tips = "退群了"
    const msg = name ? `${name}(${this.e.user_id}) ${tips}` : `${this.e.user_id} ${tips}`
    await this.reply([segment.image(`https://q1.qlogo.cn/g?b=qq&s=0&nk=${this.e.user_id}`), msg])
  }

  async cacheAllGroupMembers() {
    for (const group of Bot.gl.values()) {
      await updateGroupMemberList(group.group_id)
    }
  }
}
