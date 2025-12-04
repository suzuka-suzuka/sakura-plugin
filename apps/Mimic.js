import fs from "fs"
import path from "path"
import { _path } from "../lib/path.js"
import { getAI } from "../lib/AIUtils/getAI.js"
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js"
import { splitAndReplyMessages, parseAtMessage, getQuoteContent } from "../lib/AIUtils/messaging.js"
import Setting from "../lib/setting.js"
import { randomEmojiLike } from "../lib/utils.js"

export class Mimic extends plugin {
  constructor() {
    super({
      name: "Mimic",
      dsc: "Mimic",
      event: "message.group",
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
          case "image":
            const seq = e.seq || e.message_seq
            contentParts.push(`[图片]${seq ? `(seq:${seq})` : ""}`)
            break
        }
      })
    }
    const messageText = contentParts.join("").trim()

    let query = messageText

    const quoteContent = await getQuoteContent(e)
    if (quoteContent) {
      query = `(${quoteContent.trim()}) ${query}`
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

    let selectedPresetPrompt = this.appconfig.Prompt
    let shouldRecall = false
    if (!e.isMaster && !isNewMember && Math.random() < this.appconfig.alternatePromptProbability) {
      selectedPresetPrompt = this.appconfig.alternatePrompt
      shouldRecall = true
    }

    const groupId = e.isGroup ? e.group_id : "private"
    const userId = e.user_id
    const userName = e.sender.card || e.sender.nickname || ""

    const memoryFile = path.join(
      _path,
      "plugins",
      "sakura-plugin",
      "data",
      "mimic",
      String(groupId),
      `${userId}.json`,
    )

    if (fs.existsSync(memoryFile)) {
      try {
        const memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"))
        if (memories && memories.length > 0) {
          selectedPresetPrompt +=
            `\n\n【关于当前用户的记忆】\n当前对话用户：${userName} (${userId})\n该用户曾让你记住以下信息（请将其视为关于该用户的设定或事实）：\n` +
            memories.map(m => `- ${m}`).join("\n")
        }
      } catch (err) {
        logger.error(`读取记忆文件失败: ${err}`)
      }
    }

    logger.info(`mimic触发`)
    if (this.e.isGroup && typeof this.e.group?.setMsgEmojiLike === "function") {
      await randomEmojiLike(e)
    }
    let finalResponseText = ""
    let currentFullHistory = []
    let toolCallCount = 0
    const Channel = this.appconfig.Channel
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
        const rawParts = currentGeminiResponse.rawParts
        let modelResponseParts = []

        if (rawParts && rawParts.length > 0) {
          modelResponseParts = rawParts
        } else {
          if (textContent) {
            modelResponseParts.push({ text: textContent })
          }
          if (functionCalls && functionCalls.length > 0) {
            for (const fc of functionCalls) {
              modelResponseParts.push({ functionCall: fc })
            }
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
      if (this.appconfig.splitMessage) {
        await splitAndReplyMessages(e, finalResponseText, shouldRecall, recalltime)
      } else {
        const parsedResponse = parseAtMessage(finalResponseText)
        const reply = await e.reply(parsedResponse, true)
        if (shouldRecall && reply && reply.message_id) {
          setTimeout(() => {
            e.recall(reply.message_id)
          }, recalltime * 1000)
        }
      }
    } catch (error) {
      logger.error(`处理过程中出现错误: ${error.message}`)
      return false
    }
    return false
  }
}
