import { getAI } from "../lib/AIUtils/getAI.js"
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js"
import { splitAndReplyMessages, parseAtMessage } from "../lib/AIUtils/messaging.js"
import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"

export class Mimic extends plugin {
  constructor() {
    super({
      name: "Mimic",
      dsc: "Mimic",
      event: "message",
      priority: Infinity,
      rule: [
        {
          reg: "",
          fnc: "Mimic",
          log: false,
        },
      ],
    })
  }

  get appconfig() {
    return Setting.getConfig("mimic")
  }

  /**
   * 根据群号获取对应的 prompt
   * 群组 prompt 优先级最高，不会被用户输入或外部因素覆盖
   */
  getGroupPrompt(e) {
    // 从配置文件中读取群组 prompt
    const mimicConfig = this.appconfig;
    if (!mimicConfig.groupPrompts || !Array.isArray(mimicConfig.groupPrompts)) {
      return null;
    }

    // 查找当前群号对应的 prompt
    if (e.isGroup) {
      const groupPromptConfig = mimicConfig.groupPrompts.find(
        item => String(item.groupId) === String(e.group_id)
      );
      if (groupPromptConfig && groupPromptConfig.prompt) {
        logger.info(`[Mimic] 群 ${e.group_id} 使用自定义预设，此预设优先级最高`);
        return groupPromptConfig.prompt;
      }
    }

    // 否则使用默认 prompt
    return null; // 返回 null 表示使用配置中的默认 prompt
  }

  async Mimic(e) {
    if (this.appconfig.enableGroupLock && e.isGroup) {
      const lockKey = `sakura:mimic:lock:${e.group_id}`
      if (await redis.get(lockKey)) {
        return false
      }
      await redis.set(lockKey, "1", { EX: 120 })
    }

    try {
      return await this.doMimic(e)
    } finally {
      if (this.appconfig.enableGroupLock && e.isGroup) {
        const lockKey = `sakura:mimic:lock:${e.group_id}`
        await redis.del(lockKey)
      }
    }
  }

  async doMimic(e) {
    if (!this.appconfig.Groups.includes(e.group_id)) {
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
    const messageText = contentParts.join("").trim()

    let query = messageText

    const imageUrls = await getImg(e)
    if (imageUrls && imageUrls.length > 0) {
      for (const url of imageUrls) {
        query += `[图片: ${url}]`
      }
    }

    if (!query.trim()) {
      return false
    }

    const isAt =
      e.atBot ||
      e.atme ||
      (e.message &&
        e.message.some(msg => msg.type === "at" && String(msg.qq) === String(e.self_id)))

    const hasKeyword = this.appconfig.triggerWords.some(word => messageText.includes(word))

    let mustReply = false
    if (this.appconfig.enableAtReply && isAt) {
      mustReply = true
    } else if (hasKeyword) {
      mustReply = true
    }

    if (!mustReply && Math.random() > this.appconfig.replyProbability) {
      return false
    }

    let isNewMember = false
    if (e.isGroup) {
      try {
        let memberInfo
        try {
          memberInfo = await e.group.pickMember(e.user_id).getInfo(true)
        } catch {
          memberInfo = (await e.group.pickMember(Number(e.user_id))).info
        }
        if (memberInfo?.join_time) {
          const joinTime = memberInfo.join_time
          const currentTime = Math.floor(Date.now() / 1000)
          const NEW_MEMBER_THRESHOLD = 7 * 24 * 60 * 60
          if (currentTime - joinTime < NEW_MEMBER_THRESHOLD) {
            isNewMember = true
            logger.info(`新成员 ${e.user_id} 触发Mimic`)
          }
        }
      } catch (error) {
        logger.warn(`获取成员入群时间失败: ${error.message}`)
      }
    }

    // 首先检查是否有群组特定的 prompt
    let selectedPresetPrompt = this.getGroupPrompt(e)
    
    // 如果没有群组特定的 prompt，使用配置中的默认 prompt
    if (!selectedPresetPrompt) {
      selectedPresetPrompt = this.appconfig.Prompt || ""
      if (!e.isMaster && !isNewMember && Math.random() < this.appconfig.alternatePromptProbability) {
        selectedPresetPrompt = this.appconfig.alternatePrompt || ""
      }
    }
    
    let shouldRecall = false
    logger.info(`mimic触发，使用 prompt: ${selectedPresetPrompt ? selectedPresetPrompt.substring(0, 50) : "空"}...`)
    let finalResponseText = ""
    let currentFullHistory = []
    let toolCallCount = 0
    const Channel = this.appconfig.Channel
    logger.info(`[Mimic] Channel: ${JSON.stringify(Channel)}`)
    logger.info(`[Mimic] selectedPresetPrompt: ${selectedPresetPrompt}`)
    try {
      const queryParts = [{ text: query }]

      const geminiInitialResponse = await getAI(
        Channel,
        e,
        queryParts,
        selectedPresetPrompt,
        true,
        true,
        currentFullHistory,
      )

      if (typeof geminiInitialResponse === "string") {
        return false
      }

      currentFullHistory.push({ role: "user", parts: queryParts })

      let currentGeminiResponse = geminiInitialResponse

      while (true) {
        const textContent = currentGeminiResponse.text
        const functionCalls = currentGeminiResponse.functionCalls
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
            logger.warn(`[Mimic] 工具调用次数超过上限，强行结束对话`)
            return false
          }

          if (textContent) {
            const cleanedTextContent = textContent.replace(/\n+$/, "")
            const parsedcleanedTextContent = parseAtMessage(cleanedTextContent)
            await e.reply(parsedcleanedTextContent, true)
          }
          const executedResults = await executeToolCalls(e, functionCalls)
          currentFullHistory.push(...executedResults)
          currentGeminiResponse = await getAI(
            Channel,
            e,
            "",
            selectedPresetPrompt,
            true,
            true,
            currentFullHistory,
          )

          if (typeof currentGeminiResponse === "string") {
            return false
          }
        } else if (textContent) {
          finalResponseText = textContent
          break
        }
      }

      const recalltime = this.appconfig.recalltime
      // 使用 splitAndReplyMessages 来正确处理图片 URL 和其他内容
      await splitAndReplyMessages(e, finalResponseText, shouldRecall, recalltime)
    } catch (error) {
      logger.error(`处理过程中出现错误: ${error.message}`)
      return false
    }
    return false
  }
}
