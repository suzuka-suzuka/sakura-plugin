import Setting from "../setting.js"
import adapter from "../adapter.js"
import { FormatMiaoMsg } from "./FormatMiaoMsg.js"
const roleMap = {
  owner: "群主",
  admin: "管理员",
  member: "普通成员",
}

const formatDate = timestamp => {
  const date = new Date(timestamp * 1000)
  return date.toLocaleTimeString("zh-CN", { hour12: false })
}

async function getChatHistoryGroup(e, num) {
  if (!e.group || typeof e.group.getChatHistory !== "function") {
    return []
  }

  try {
    const isMiaoAdapter = adapter === 0
    const allowedMessageTypes = ["text", "at", "image", "video", "bface", "forward", "json"]
    const seenMessageIds = new Set()

    const processChats = rawChats => {
      const formatted = isMiaoAdapter ? rawChats.map(chat => FormatMiaoMsg(chat)) : rawChats
      return formatted.filter(chat => {
        const messageId = chat.seq || chat.message_seq || chat.message_id
        if (seenMessageIds.has(messageId)) {
          return false
        }
        if (!chat.sender?.user_id || !chat.message?.length) {
          return false
        }
        if (!chat.message.some(msgPart => allowedMessageTypes.includes(msgPart.type))) {
          return false
        }
        seenMessageIds.add(messageId)
        return true
      })
    }

    let initialChats = await e.group.getChatHistory(0, 20)

    if (initialChats.length === 0) {
      return []
    }

    let chats = processChats(initialChats)
    let seq = initialChats[0].seq || initialChats[0].message_seq || initialChats[0].message_id

    while (chats.length < num) {
      const chatHistory = await e.group.getChatHistory(seq, 20)
      const newSeq =
        chatHistory[0]?.seq || chatHistory[0]?.message_seq || chatHistory[0]?.message_id

      if (chatHistory.length === 0 || seq === newSeq) {
        break
      }

      seq = newSeq
      const newChats = processChats(chatHistory)

      if (newChats.length === 0) {
        break
      }

      chats.unshift(...newChats)
    }

    chats = chats.slice(Math.max(0, chats.length - num))

    return chats
  } catch (err) {
    console.error("获取群聊天记录时出错:", err)
    return []
  }
}

async function formatChatMessageContent(e, chat) {
  const sender = chat.sender || {}
  const chatTime = chat.time || (chat.message_id ? Math.floor(Date.now() / 1000) : 0)
  const senderId = sender.user_id
  let memberInfo
  try {
    memberInfo = await e.group.pickMember(senderId)?.getInfo(true)
  } catch {
    memberInfo = (await e.group.pickMember(Number(senderId))).info
  }
  const senderName = memberInfo?.card || memberInfo?.nickname || senderId || "未知用户"
  const senderRole = roleMap[sender.role] || "普通成员"

  let messageHeader = `【${senderName}】(QQ:${senderId}, 角色:${senderRole}`
  if (sender.title) {
    messageHeader += `, 头衔:${sender.title}`
  }
  messageHeader += `, 时间:${formatDate(chatTime)}`
  const seq = chat.seq || chat.message_seq
  if (seq) {
    messageHeader += `, seq:${seq}`
  }

  let originalMsg = null

  if (adapter === 0) {
    if (chat.source && chat.source.seq) {
      try {
        const history = await e.group.getChatHistory(chat.source.seq, 1)
        if (history && history.length > 0) {
          originalMsg = FormatMiaoMsg(history[0])
        }
      } catch (error) {
        logger.error("获取被回复的原始消息时出错:", error)
      }
    }
  } else {
    const replyPart = chat.message?.find(msg => msg.type === "reply")
    if (replyPart && replyPart.id) {
      try {
        const message_id = replyPart.id
        const originalMsgArray = await e.group.getChatHistory(message_id, 1)
        originalMsg = originalMsgArray && originalMsgArray.length > 0 ? originalMsgArray[0] : null
      } catch (error) {
        logger.error("获取被回复的原始消息时出错:", error)
      }
    }
  }

  if (originalMsg && originalMsg.message) {
    const originalSenderId = originalMsg.sender?.user_id
    let originalMemberInfo
    try {
      originalMemberInfo = await e.group.pickMember(originalSenderId)?.getInfo(true)
    } catch {
      originalMemberInfo = (await e.group.pickMember(Number(originalSenderId))).info
    }
    const originalSenderName =
      originalMemberInfo?.card || originalMemberInfo?.nickname || originalSenderId || "未知用户"
    const originalContentParts = []
    for (const msgPart of originalMsg.message) {
      switch (msgPart.type) {
        case "text":
          originalContentParts.push(msgPart.text)
          break
        case "at":
          originalContentParts.push(`@${msgPart.qq}`)
          break
        case "image": {
          const isAnimated = msgPart.asface === true || msgPart.sub_type === 1
          originalContentParts.push(isAnimated ? `[动画表情]` : `[图片]`)
          break
        }
        case "video": {
          originalContentParts.push(`[视频]`)
          break
        }
        case "bface":
          if (msgPart.text) {
            originalContentParts.push(msgPart.text)
          }
          break
        case "forward":
          originalContentParts.push("[聊天记录]")
          break
        case "json":
          try {
            const jsonData = JSON.parse(msgPart.data)
            if (jsonData?.meta?.detail?.resid) {
              originalContentParts.push("[聊天记录]")
            } 
          } catch (e) {}
          break
      }
    }

    const fullOriginalMessage = originalContentParts.join("").trim()
    const originalMessageContent = fullOriginalMessage.replace(/\n/g, " ")

    messageHeader += `， 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalMessageContent}"`
    const originalSeq = originalMsg.seq || originalMsg.message_seq
    if (originalSeq) {
      messageHeader += `(seq:${originalSeq})`
    }
  }

  messageHeader += `) 说：`

  let contentParts = []
  const messageContentParts = chat.message.filter(msg => msg.type !== "reply")

  if (messageContentParts.length > 0) {
    for (const msgPart of messageContentParts) {
      switch (msgPart.type) {
        case "text":
          contentParts.push(msgPart.text)
          break
        case "at":
          contentParts.push(`@${msgPart.qq}`)
          break
        case "image": {
          const isAnimated = msgPart.asface === true || msgPart.sub_type === 1
          contentParts.push(isAnimated ? `[动画表情]` : `[图片]`)
          break
        }
        case "video": {
          contentParts.push(`[视频]`)
          break
        }
        case "bface":
          if (msgPart.text) {
            contentParts.push(msgPart.text)
          }
          break
        case "forward":
          contentParts.push("[聊天记录]")
          break
        case "json":
          try {
            const jsonData = JSON.parse(msgPart.data)
            if (jsonData?.meta?.detail?.resid) {
              contentParts.push("[聊天记录]")
            }
          } catch (e) {}
          break
      }
    }
  }

  const messageContent = contentParts.join("")

  return `${messageHeader}${messageContent}`
}

export async function buildGroupPrompt(e) {
  const config = Setting.getConfig("AI")
  const { groupContextLength } = config
  let systemPromptWithContext = ""

  if (e.isGroup) {
    let botMemberInfo
    try {
      botMemberInfo = await e.group.pickMember(e.self_id)?.getInfo(true)
    } catch {
      botMemberInfo = (await e.group.pickMember(Number(e.self_id))).info
    }
    const botName = botMemberInfo?.card || botMemberInfo?.nickname || e.self_id
    const latestSenderName = e.sender.card || e.sender.nickname || e.sender?.user_id

    systemPromptWithContext += `你目前正在一个QQ群聊中。`
    systemPromptWithContext += `\n群名称: ${e.group?.name || e.group_name}, 群号: ${e.group_id}。`
    systemPromptWithContext += `你现在是这个QQ群的成员，你的昵称是“${botName}”(QQ:${e.self_id})。`
    systemPromptWithContext += `\n当前向你提问的用户是: ${latestSenderName}(QQ:${e.sender?.user_id})。`
    systemPromptWithContext += ` (角色: ${roleMap[e.sender?.role] || "普通成员"}`
    if (e.sender?.title) systemPromptWithContext += `, 群头衔: ${e.sender.title}`
    systemPromptWithContext += `)。\n`

    let chats = []
    try {
      chats = await getChatHistoryGroup(e, groupContextLength)
    } catch (historyError) {}

    if (chats && chats.length > 0) {
      systemPromptWithContext += `当你需要艾特(@)别人时，可以直接在回复中添加‘@QQ’，其中QQ为你需要艾特(@)的人的QQ号，如‘@123456’。以下是最近群内的聊天记录。请你仔细阅读这些记录，理解群内成员的对话内容和趋势，并以此为基础来生成你的回复。你的回复应该自然融入当前对话，就像一个真正的群成员一样：\n`
      const formattedChats = await Promise.all(chats.map(chat => formatChatMessageContent(e, chat)))
      systemPromptWithContext += formattedChats.join("\n")
    }
  }
  return systemPromptWithContext
}
