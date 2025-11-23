import { Recall } from "../utils.js"
import adapter from "../adapter.js"
import { FormatMiaoMsg } from "./FormatMiaoMsg.js"
export function parseAtMessage(text) {
  const messageSegments = []
  const regex = /@(\d+)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    const atText = match[0]
    const atQQ = match[1]
    const matchIndex = match.index

    if (matchIndex > lastIndex) {
      messageSegments.push(text.substring(lastIndex, matchIndex))
    }

    messageSegments.push({ type: "at", qq: atQQ })

    lastIndex = matchIndex + atText.length
  }

  if (lastIndex < text.length) {
    messageSegments.push(text.substring(lastIndex))
  }

  if (messageSegments.length === 0 && text.length > 0) {
    return [text]
  } else if (messageSegments.length === 0 && text.length === 0) {
    return [""]
  }

  return messageSegments
}

const MAX_SPLIT_MESSAGES = 3
const QUOTE_PROBABILITY = 0.2

export async function splitAndReplyMessages(e, finalResponseText, shouldRecall = false, recalltime = 10) {
  finalResponseText = finalResponseText.replace(/\n/g, "")
  let messageChunks = []
  const parts = finalResponseText.split(/([!?。？！]+)/)

  let currentChunk = ""
  for (const part of parts) {
    if (part) {
      currentChunk += part
      if (/[!?。？！]/.test(part)) {
        messageChunks.push(currentChunk)
        currentChunk = ""
      }
    }
  }

  if (currentChunk) {
    messageChunks.push(currentChunk)
  }

  if (messageChunks.length === 0 && finalResponseText) {
    messageChunks.push(finalResponseText)
  }

  let finalMessages
  if (messageChunks.length > MAX_SPLIT_MESSAGES) {
    finalMessages = messageChunks.slice(0, MAX_SPLIT_MESSAGES - 1)
    const lastMessage = messageChunks.slice(MAX_SPLIT_MESSAGES - 1).join(" ")
    finalMessages.push(lastMessage)
  } else {
    finalMessages = messageChunks
  }

  for (const messageToSend of finalMessages) {
    const parsedMessageSegments = parseAtMessage(messageToSend)
    const shouldQuote = Math.random() < QUOTE_PROBABILITY
    const sentMessage = await e.reply(parsedMessageSegments, shouldQuote)

    if (shouldRecall && sentMessage && recalltime > 0) {
      Recall(e, sentMessage.message_id, recalltime)
    }
  }
}

export async function getQuoteContent(e) {
  let originalMsg = null
  let quoteText = ""

  if (!e.group || typeof e.group.getChatHistory !== "function") {
    return quoteText
  }

  if (adapter === 0) {
    if (e.source && e.source.seq) {
      try {
        const history = await e.group.getChatHistory(e.source.seq, 1)
        if (history && history.length > 0) {
          originalMsg = FormatMiaoMsg(history[0])
        }
      } catch (error) {
        logger.error("获取被回复的原始消息时出错:", error)
      }
    }
  } else {
    const replyPart = e.message?.find(msg => msg.type === "reply")
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

    quoteText = ` 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalMessageContent}"`
    const originalSeq = originalMsg.seq || originalMsg.message_seq
    if (originalSeq) {
      quoteText += `(seq:${originalSeq})`
    }
  }
  return quoteText
}
