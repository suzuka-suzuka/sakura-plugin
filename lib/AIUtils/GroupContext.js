import Setting from "../setting.js"
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
    let initialChats = await e.group.getChatHistory(0, 20)

    if (initialChats.length === 0) {
      return []
    }

    let chats = initialChats
    let seq = initialChats[0].seq || initialChats[0].message_id

    while (chats.length < num) {
      let chatHistory = await e.group.getChatHistory(seq, 20)

      if (chatHistory.length === 0 || seq === (chatHistory[0]?.seq || chatHistory[0]?.message_id)) {
        break
      }
      seq = chatHistory[0].seq || chatHistory[0].message_id

      const filteredChats = chatHistory.filter(chat => {
        if (!chat.sender?.user_id) {
          return false
        }

        if (chat.message && chat.message.length > 0) {
          const allowedMessageTypes = ["text", "at", "image", "mface", "video"]
          return chat.message.some(msgPart => allowedMessageTypes.includes(msgPart.type))
        }

        return false
      })

      chats.unshift(...filteredChats)
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

  const memberInfo = await e.group.pickMember(senderId)?.getInfo(true)
  const senderName = memberInfo?.card || memberInfo?.nickname || senderId || "未知用户"
  const senderRole = roleMap[sender.role] || "普通成员"

  let messageHeader = `【${senderName}】(QQ:${senderId}, 角色:${senderRole}`
  if (sender.title) {
    messageHeader += `, 头衔:${sender.title}`
  }
  messageHeader += `, 时间:${formatDate(chatTime)}`

  const replyPart = chat.message.find(msg => msg.type === "reply")
  if (replyPart && replyPart.id) {
    try {
      const message_id = replyPart.id
      let originalMsgArray
      if (e.isGroup) {
        originalMsgArray = await e.group.getChatHistory(message_id, 1)
      } else {
        originalMsgArray = await e.friend.getChatHistory(message_id, 1)
      }
      const originalMsg =
        originalMsgArray && originalMsgArray.length > 0 ? originalMsgArray[0] : null

      if (originalMsg && originalMsg.message) {
        const originalSenderId = originalMsg.sender?.user_id
        const originalMemberInfo = await e.group.pickMember(originalSenderId)?.getInfo(true)
        const originalSenderName =
          originalMemberInfo?.card || originalMemberInfo?.nickname || originalSenderId || "未知用户"
        const originalContentParts = []
        originalMsg.message.forEach(msgPart => {
          switch (msgPart.type) {
            case "text":
              originalContentParts.push(msgPart.text)
              break
            case "at":
              originalContentParts.push(`@${msgPart.qq}`)
              break
            case "image":
              const imageUrl = msgPart.url
              originalContentParts.push(
                msgPart.subType === 1 ? `[动画表情URL:${imageUrl}]` : `[图片URL:${imageUrl}]`,
              )
              break
            case "mface":
              originalContentParts.push(`[表情URL:${msgPart.url}]`)
              break
            case "video":
              originalContentParts.push(`[视频URL:${msgPart.file}]`)
          }
        })

        const fullOriginalMessage = originalContentParts.join("").trim()
        const originalMessageContent = fullOriginalMessage.replace(/\n/g, " ").slice(0, 20)

        messageHeader += `， 回复了${originalSenderName}(QQ:${originalSenderId})的消息“${originalMessageContent}”`
      }
    } catch (error) {
      console.error("获取被回复的原始消息时出错:", error)
      messageHeader += `， 回复了一条消息`
    }
  }

  messageHeader += `) 说：`

  let contentParts = []
  const messageContentParts = chat.message.filter(msg => msg.type !== "reply")

  if (messageContentParts.length > 0) {
    messageContentParts.forEach(msgPart => {
      switch (msgPart.type) {
        case "text":
          contentParts.push(msgPart.text)
          break
        case "at":
          contentParts.push(`@${msgPart.qq}`)
          break
        case "image":
          const imageUrl = msgPart.url
          contentParts.push(
            msgPart.subType === 1 ? `[动画表情URL:${imageUrl}]` : `[图片URL:${imageUrl}]`,
          )
          break
        case "mface":
          contentParts.push(`[表情URL:${msgPart.url}]`)
          break
        case "video":
          contentParts.push(`[视频file:${msgPart.file}]`)
      }
    })
  }

  const messageContent = contentParts.join("")

  return `${messageHeader}${messageContent}`
}

export async function buildGroupPrompt(e) {
  const config = Setting.getConfig("AI")
  const { groupContextLength } = config
  let systemPromptWithContext = ""

  if (e.isGroup) {
    const botUin = e.self_id || e.bot?.uin
    const botMemberInfo = await e.group.pickMember(botUin)?.getInfo(true)
    const botName = botMemberInfo?.card || botMemberInfo?.nickname|| botUin
    const latestSenderName = e.sender.card || e.sender.nickname || e.sender?.user_id

    systemPromptWithContext += `你目前正在一个QQ群聊中。`
    systemPromptWithContext += `\n群名称: ${e.group?.name || e.group_name}, 群号: ${e.group_id}。`
    systemPromptWithContext += `你现在是这个QQ群的成员，你的昵称是“${botName}”(QQ:${botUin})。`
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
