import { getAI } from "../lib/AIUtils/getAI.js"
import { marked } from "marked"
import puppeteer from "puppeteer"
import { makeForwardMsg } from "../lib/utils.js"

export class UserProfilePlugin extends plugin {
  constructor() {
    super({
      name: "画像",
      dsc: "获取画像",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^#画像$",
          fnc: "generateUserProfile",
          log: false,
        },
        {
          reg: "^#学舌(.*)$",
          fnc: "mimicUser",
          log: false,
        },
      ],
    })
  }

  async generateUserProfile(e) {
    if (!e.isGroup) {
      return false
    }
    const targetUserId = e.user_id
    const messageCount = 100
    const senderNickname = e.member.card || e.member.nickname
    const messages = await getUserTextHistory(e, targetUserId, messageCount)
    if (messages && messages.length > 0) {
      const formattedLines = await Promise.all(
        messages.map(async chat => {
          const time = new Date(chat.time * 1000).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })

          const contentParts = await Promise.all(
            chat.message.map(async part => {
              if (part.type === "text") {
                return part.text
              }
              if (part.type === "at") {
                if (part.qq === "all" || part.qq === 0) {
                  return "@全体成员"
                }
                try {
                  const info = await e.group.pickMember(part.qq).getInfo(true)
                  const atNickname = info.card || info.nickname || part.qq
                  return `@${atNickname}`
                } catch (err) {
                  logger.error(`获取用户 ${part.qq} 的信息失败:`, err)
                  return `@${part.qq}`
                }
              }
              return ""
            }),
          )

          const textContent = contentParts.join("")
          return `[${time}] ${textContent}`
        }),
      )

      const rawChatHistory = formattedLines.join("\n")

      const aiPrompt = `请根据【${senderNickname}】在群聊中的发言记录，对该用户进行全面的画像分析。请从以下几个维度进行分析，并以清晰、有条理的Markdown格式呈现你的结论：
1. **关键主题**：分析用户最常讨论的话题或感兴趣的领域是什么？
2. **语言风格**：用户的说话风格是怎样的？（例如：正式、口语化、幽默、简洁等）
3. **活跃时段**：根据发言时间，分析用户的活跃时间段，推测其作息习惯。
4. **社交关系**：用户与哪些群成员互动最频繁？（根据'@'记录）
以下是用户【${senderNickname}】的发言记录：
${rawChatHistory}`

      try {
        const queryParts = [{ text: aiPrompt }]
        const Channel = "2.5"
        const result = await getAI(Channel, e, queryParts, null, false, false, [])

        if (result && result.text) {
          const forwardMsgContent = [
            {
              text: result.text,
              senderId: e.user_id,
              senderName: e.member.card || e.member.nickname,
            },
          ]
          await makeForwardMsg(e, forwardMsgContent, `【${senderNickname}】的用户画像`)

          const html = marked(result.text)
          const styledHtml = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 20px; background-color: #f7f7f7; }
                                h1, h2, h3 { color: #333; }
                                ul { padding-left: 20px; }
                                li { margin-bottom: 10px; }
                                strong { color: #0056b3; }
                                .container { max-width: 800px; margin: auto; background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>用户画像分析报告 - ${senderNickname}</h1>
                                <hr>
                                ${html}
                            </div>
                        </body>
                        </html>`

          const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          })
          const page = await browser.newPage()
          await page.setContent(styledHtml, { waitUntil: "networkidle0" })
          const imageBuffer = await page.screenshot({ fullPage: true })
          await browser.close()

          await e.reply(segment.image(imageBuffer))
        } else {
          this.reply("画像分析失败，未能获取到有效的返回结果。", false, { recallMsg: 10 })
        }
      } catch (error) {
        logger.error("调用画像分析或生成消息时出错:", error)
        this.reply("画像分析或消息生成过程中出现错误，请稍后再试。", false, { recallMsg: 10 })
      }
    }
    return true
  }

  async mimicUser(e) {
    if (!e.isGroup) {
      return false
    }

    const atMsg = e.message.find(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
    const targetUserId = atMsg ? atMsg.qq : e.user_id
    const messageCount = 100

    try {
      const member = await e.group.pickMember(targetUserId).getInfo(true)
      const nickname = member.card || member.nickname

      const messages = await getUserTextHistory(e, targetUserId, messageCount)

      const formattedLines = await Promise.all(
        messages.map(async chat => {
          const contentParts = await Promise.all(
            chat.message.map(async part => {
              if (part.type === "text") {
                return part.text
              }
              if (part.type === "at") {
                if (part.qq === "all" || part.qq === 0) {
                  return "@全体成员"
                }
                try {
                  const info = await e.group.pickMember(part.qq).getInfo(true)
                  const atNickname = info.card || info.nickname || part.qq
                  return `@${atNickname}`
                } catch (err) {
                  return `@${part.qq}`
                }
              }
              return ""
            }),
          )

          const textContent = contentParts.join("")
          return textContent
        }),
      )
      const rawChatHistory = formattedLines.join("\n")

      const aiPrompt = `你需要模仿指定群友【${nickname}】的说话风格说话。不要重复他的话，尽可能符合情境地说一句或一段话即可。要求给出三个候选项，用换行符隔开。要求重点学习常用口癖词汇、标点符号、语气词等，以及关注的领域。不要OOC，不要自己编造破坏人设。
以下是【${nickname}】的发言记录：
${rawChatHistory}`

      const queryParts = [{ text: aiPrompt }]
      const Channel = "3.1"
      const result = await getAI(Channel, e, queryParts, null, false, false, [])

      if (result && result.text) {
        const replies = result.text.split("\n").filter(line => line.trim() !== "")
        if (replies.length > 0) {
          for (const reply of replies) {
            await e.reply(reply)
          }
        } else {
          await this.reply("学舌失败，没有给出有效的模仿内容。", true, { recallMsg: 10 })
        }
      } else {
        await this.reply("学舌失败，未能获取到有效的返回结果。", true, { recallMsg: 10 })
      }
    } catch (error) {
      logger.error("学舌时出错:", error)
      await this.reply("学舌时出现错误，请稍后再试。", true, { recallMsg: 10 })
    }
    return true
  }
}

async function getUserTextHistory(e, userId, num) {
  if (!e.group || typeof e.group.getChatHistory !== "function") {
    logger.error("错误：无法获取群聊对象或 getChatHistory 方法。")
    return []
  }

  try {
    let userChats = []
    let seq = e.seq || e.message_id
    let totalScanned = 0
    const maxScanLimit = 2000

    while (userChats.length < num && totalScanned < maxScanLimit) {
      const chatHistory = await e.group.getChatHistory(seq, 20)

      if (chatHistory.length === 0) {
        break
      }

      totalScanned += chatHistory.length

      const oldestSeq = chatHistory[0].seq || chatHistory[0].message_id
      if (seq === oldestSeq) {
        break
      }
      seq = oldestSeq

      const filteredChats = chatHistory.filter(chat => {
        const isTargetUser = chat.sender?.user_id === userId
        if (!isTargetUser) return false
        if (!chat.message || chat.message.length === 0) return false
        const hasTextOrAt = chat.message.some(
          msgPart => msgPart.type === "text" || msgPart.type === "at",
        )
        return hasTextOrAt
      })

      if (filteredChats.length > 0) {
        userChats.unshift(...filteredChats.reverse())
      }
    }

    return userChats.slice(-num)
  } catch (err) {
    logger.error("获取用户聊天记录时出错:", err)
    return []
  }
}
