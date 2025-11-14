import { Recall } from "../utils.js"
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
