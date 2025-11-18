import Setting from "../lib/setting.js"
import { getAI } from "../lib/AIUtils/getAI.js"
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../lib/AIUtils/ConversationHistory.js"
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js"
import { parseAtMessage, splitAndReplyMessages } from "../lib/AIUtils/messaging.js"
import { getImg } from "../lib/utils.js"

export class AIChat extends plugin {
  constructor() {
    super({
      name: "chat",
      dsc: " AI 聊天插件",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "",
          fnc: "Chat",
          log: false,
        },
      ],
    })
  }

  get appconfig() {
    return Setting.getConfig("AI")
  }

  async Chat(e) {
    const config = this.appconfig
    if (!config || !config.profiles || config.profiles.length === 0) {
      return false
    }

    let contentParts = []
    if (e.message && Array.isArray(e.message) && e.message.length > 0) {
      e.message.forEach(msgPart => {
        switch (msgPart.type) {
          case "text":
            contentParts.push(msgPart.text)
            break
          case "at":
            contentParts.push(`@${msgPart.qq}`)
            break
        }
      })
    }
    let messageText = contentParts.join("").trim()
    if (!messageText) {
      return false
    }

    let textToMatch = messageText
    if (e.message?.[0]?.type === "at") {
      const atText = `@${e.message[0].qq}`
      if (textToMatch.startsWith(atText)) {
        textToMatch = textToMatch.substring(atText.length).trim()
      }
    }

    const matchedProfile = config.profiles.find(p => textToMatch.startsWith(p.prefix))

    if (!matchedProfile) {
      return false
    }

    const { prefix, Channel, Prompt, GroupContext, History, Tool } = matchedProfile

    let query = textToMatch.substring(prefix.length).trim()

    const imageUrls = await getImg(e)
    if (!query && (!imageUrls || imageUrls.length === 0)) {
      return false
    }

    if (imageUrls && imageUrls.length > 0) {
      for (const url of imageUrls) {
        query += ` [图片: ${url}]`
      }
      query = query.trim()
    }

    if (config.enableUserLock) {
      const lockKey = e.isGroup
        ? `sakura:chat:lock:${e.group_id}:${e.user_id}`
        : `sakura:chat:lock:private:${e.user_id}`

      if (await redis.get(lockKey)) {
        logger.info(`[Chat] 用户 ${e.user_id} 的上一条消息仍在处理中，本次触发已忽略。`)
        return false
      }
      await redis.set(lockKey, "1", { EX: 120 })
    }

    try {
      return await this.doChat(e, config, matchedProfile, query)
    } finally {
      if (config.enableUserLock) {
        const lockKey = e.isGroup
          ? `sakura:chat:lock:${e.group_id}:${e.user_id}`
          : `sakura:chat:lock:private:${e.user_id}`
        await redis.del(lockKey)
      }
    }
  }

  /**
   * 根据群号获取对应的 prompt
   * 群组 prompt 优先级最高，不会被用户输入或外部因素覆盖
   * 这是一个硬编码的安全配置，防止 prompt 注入攻击
   */
  getGroupPrompt(e, config, matchedProfile) {
    // 从配置文件中读取群组 prompt
    if (!config.groupPrompts || !Array.isArray(config.groupPrompts)) {
      return matchedProfile.Prompt;
    }

    // 查找当前群号对应的 prompt
    if (e.isGroup) {
      const groupPromptConfig = config.groupPrompts.find(
        item => String(item.groupId) === String(e.group_id)
      );
      if (groupPromptConfig && groupPromptConfig.prompt) {
        logger.info(`[Chat] 群 ${e.group_id} 使用自定义预设，此预设优先级最高`);
        return groupPromptConfig.prompt;
      }
    }

    // 否则使用默认 prompt
    return matchedProfile.Prompt;
  }

  async doChat(e, config, matchedProfile, query) {
    const { Channel, GroupContext, History, Tool, prefix } = matchedProfile
    // 根据群号获取对应的 prompt
    const Prompt = this.getGroupPrompt(e, config, matchedProfile)

    logger.info(`Chat触发`)
    let finalResponseText = ""
    let currentFullHistory = []
    let toolCallCount = 0

    try {
      if (History) {
        currentFullHistory = await loadConversationHistory(e, prefix)
      }

      const queryParts = [{ text: query }]

      let currentAIResponse = await getAI(
        Channel,
        e,
        queryParts,
        Prompt,
        GroupContext,
        Tool,
        currentFullHistory,
      )

      if (typeof currentAIResponse === "string") {
        await this.reply(currentAIResponse, false, { recallMsg: 10 })
        return true
      }

      currentFullHistory.push({ role: "user", parts: queryParts })

      while (true) {
        const textContent = currentAIResponse.text
        const functionCalls = currentAIResponse.functionCalls
        let modelResponseParts = []

        if (textContent) {
          modelResponseParts.push({ text: textContent })
        }
        if (functionCalls && functionCalls.length > 0) {
          for (const fc of functionCalls) {
            modelResponseParts.push({ functionCall: fc })
          }
        }

        if (modelResponseParts.length > 0) {
          currentFullHistory.push({ role: "model", parts: modelResponseParts })
        }

        if (functionCalls && functionCalls.length > 0) {
          toolCallCount++
          if (toolCallCount >= 5) {
            logger.warn(`[Chat] 工具调用次数超过上限，强行结束对话`)
            return true
          }

          if (textContent) {
            const cleanedTextContent = textContent.replace(/\n+$/, "")
            const parsedcleanedTextContent = parseAtMessage(cleanedTextContent)
            await this.reply(parsedcleanedTextContent, true)
          }
          const executedResults = await executeToolCalls(e, functionCalls)
          currentFullHistory.push(...executedResults)

          currentAIResponse = await getAI(
            Channel,
            e,
            "",
            Prompt,
            GroupContext,
            Tool,
            currentFullHistory,
          )

          if (typeof currentAIResponse === "string") {
            await this.reply(currentAIResponse, false, { recallMsg: 10 })
            return true
          }
        } else if (textContent) {
          finalResponseText = textContent
          break
        }
      }

      if (History) {
        const historyToSave = currentFullHistory.filter(
          part =>
            part.role === "user" ||
            (part.role === "model" && part.parts.every(p => p.hasOwnProperty("text"))),
        )
        await saveConversationHistory(e, historyToSave, prefix)
      }

      // 使用 splitAndReplyMessages 来正确处理图片 URL 和其他内容
      await splitAndReplyMessages(e, finalResponseText, false, 0)
    } catch (error) {
      logger.error(`Chat处理过程中出现错误: ${error.message}`)
      await this.reply(`处理过程中出现错误: ${error.message}`, false, { recallMsg: 10 })
      return true
    }
    return true
  }
}
