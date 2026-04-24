import { logger } from "../../../../src/utils/logger.js"

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

    messageSegments.push({ type: "at", data: { qq: atQQ } })

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
const SENTENCE_END_REGEX = /[!?。？！]/
const QUOTE_PAIRS = new Map([
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
])
const BRACKET_PAIRS = new Map([
  ["(", ")"],
  ["（", "）"],
  ["[", "]"],
  ["【", "】"],
  ["{", "}"],
  ["《", "》"],
  ["〈", "〉"],
])

function isApostropheInWord(chars, index) {
  return (
    chars[index] === "'" &&
    /[A-Za-z0-9]/.test(chars[index - 1] || "") &&
    /[A-Za-z0-9]/.test(chars[index + 1] || "")
  )
}

function isSentenceEnd(char) {
  return SENTENCE_END_REGEX.test(char || "")
}

function splitMessageBySentence(text) {
  const messageChunks = []
  const chars = Array.from(text)
  const quoteStack = []
  const bracketStack = []
  let currentChunk = ""

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    currentChunk += char

    if (quoteStack[quoteStack.length - 1] === char && !isApostropheInWord(chars, i)) {
      quoteStack.pop()
      continue
    }

    if (QUOTE_PAIRS.has(char) && !isApostropheInWord(chars, i)) {
      quoteStack.push(QUOTE_PAIRS.get(char))
      continue
    }

    if (quoteStack.length === 0) {
      if (bracketStack[bracketStack.length - 1] === char) {
        bracketStack.pop()
        continue
      }

      if (BRACKET_PAIRS.has(char)) {
        bracketStack.push(BRACKET_PAIRS.get(char))
        continue
      }
    }

    if (
      isSentenceEnd(char) &&
      !isSentenceEnd(chars[i + 1]) &&
      quoteStack.length === 0 &&
      bracketStack.length === 0
    ) {
      messageChunks.push(currentChunk)
      currentChunk = ""
    }
  }

  if (currentChunk) {
    messageChunks.push(currentChunk)
  }

  return messageChunks
}

export async function splitAndReplyMessages(e, finalResponseText, shouldRecall = false, recalltime = 10) {
  finalResponseText = finalResponseText.replace(/\n/g, "")
  const messageChunks = splitMessageBySentence(finalResponseText)

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
    await e.reply(parsedMessageSegments, shouldRecall ? recalltime : 0, shouldQuote)
  }
}

export async function getQuoteContent(e) {
  let originalMsg = null
  let quoteText = ""

  try {
    originalMsg = await e.getReplyMsg()
  } catch (error) {
    logger.error("获取被回复的原始消息时出错:", error)
  }

  if (!originalMsg && e.message) {
    const replyPart = e.message.find(msg => msg.type === "reply")
    if (replyPart && replyPart.id) {
      try {
        originalMsg = await e.getMsg(replyPart.id)
      } catch (error) {
        logger.error("获取被回复的原始消息时出错:", error)
      }
    }
  }

  if (originalMsg && originalMsg.message) {
    const originalSenderId = originalMsg.sender?.user_id
    let originalMemberInfo
    try {
      originalMemberInfo = await e.getInfo(originalSenderId, true)
    } catch {
    }
    const originalSenderName =
      originalMemberInfo?.card || originalMemberInfo?.nickname || originalSenderId || "未知用户"
    const originalContentParts = []
    for (const msgPart of originalMsg.message) {
      if (msgPart.type === "file") {
        const fileName = msgPart.data?.name || "未命名文件"
        originalContentParts.push(`[文件:${fileName}]`)
        continue
      }

      switch (msgPart.type) {
        case "text":
          originalContentParts.push(msgPart.data?.text || "")
          break
        case "at":
          originalContentParts.push(`@${msgPart.data?.qq}`)
          break
        case "image": {
          const imageSubType = msgPart.data?.sub_type ?? msgPart.sub_type
          const isAnimated =
            msgPart.asface === true ||
            imageSubType === 1 ||
            imageSubType === "1" ||
            imageSubType === "sticker"
          originalContentParts.push(isAnimated ? `[动画表情]` : `[图片]`)
          break
        }
        case "video": {
          originalContentParts.push(`[视频]`)
          break
        }
        case "forward":
          originalContentParts.push("[聊天记录]")
          break
        case "json":
          try {
            const jsonData = JSON.parse(msgPart.data)
            if (jsonData?.meta?.detail?.resid) {
              originalContentParts.push("[聊天记录]")
            }
          } catch (e) { }
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

