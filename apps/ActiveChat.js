import Setting from "../lib/setting.js"
import { getAI } from "../lib/AIUtils/getAI.js"
import { loadConversationHistory } from "../lib/AIUtils/ConversationHistory.js"
import { parseAtMessage } from "../lib/AIUtils/messaging.js"

const LAST_INTERACTION_TIME_PREFIX = "AI_LastInteractionTime:"
const INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000

export class ActiveChatScheduler extends plugin {
  constructor() {
    super({
      name: "AI主动聊天任务",
      dsc: "定时检查并与长时间未互动的用户聊天",
      event: "message",
      priority: 1135,
      rule: [],
    })
  }

  task = {
    name: "AIProactiveChatTask",
    fnc: () => this.proactiveChatTask(),
    cron: "0 0 * * * *",
    log: false,
  }

  async proactiveChatTask() {
    const config = Setting.getConfig("AI")
    const activeChatConfig = Setting.getConfig("ActiveChat")
    if (!config || !config.profiles || config.profiles.length === 0) {
      return
    }

    try {
      const keys = await redis.keys(`${LAST_INTERACTION_TIME_PREFIX}*`)
      const now = Date.now()

      for (const key of keys) {
        let shouldDeleteKey = false

        try {
          const lastInteractionTime = await redis.get(key)
          if (!lastInteractionTime) continue

          if (now - parseInt(lastInteractionTime, 10) > INACTIVITY_THRESHOLD_MS) {
            shouldDeleteKey = true

            const keyParts = key.replace(LAST_INTERACTION_TIME_PREFIX, "").split(":")
            if (keyParts.length !== 2) continue

            const profilePrefix = keyParts[0]
            const conversationKey = keyParts[1]

            const conversationKeyParts = conversationKey.split("-")
            if (conversationKeyParts.length !== 2) continue

            const group_id = parseInt(conversationKeyParts[0], 10)
            const user_id = parseInt(conversationKeyParts[1], 10)

            if (
              activeChatConfig?.Groups?.length > 0 &&
              !activeChatConfig.Groups.includes(group_id)
            ) {
              continue
            }

            logger.info(`用户 ${user_id} 在群 ${group_id} 已超过设定时间未互动，准备触发聊天`)

            const profile = config.profiles.find(p => p.prefix === profilePrefix)
            if (!profile) {
              logger.warn(`找不到与前缀 ${profilePrefix} 匹配的profile。`)
              continue
            }

            const group = Bot.pickGroup(group_id)
            if (!group) {
              logger.warn(`主动聊天失败: 找不到群 ${group_id}。`)
              continue
            }

            const member = await group.pickMember(user_id)
            if (!member) {
              logger.warn(`主动聊天失败: 在群 ${group_id} 中找不到成员 ${user_id}。`)
              continue
            }

            const mockE = {
              isGroup: true,
              group_id: group_id,
              user_id: user_id,
              self_id: Bot.uin,
              bot: Bot,
              group: group,
              sender: member,
            }

            const history = await loadConversationHistory(mockE, profilePrefix)

            await this.triggerProactiveChat(mockE, profile, history)
          }
        } finally {
          if (shouldDeleteKey) {
            try {
              await redis.del(key)
            } catch (err) {
              logger.error(`删除互动时间戳 ${key} 失败: ${err}`)
            }
          }
        }
      }
    } catch (error) {
      logger.error(`主动聊天定时任务执行出错: ${error}`)
    }
  }

  async triggerProactiveChat(mockE, profile, history) {
    try {
      const SenderInfo = await mockE.sender.getInfo(true)
      const userName = SenderInfo?.card || SenderInfo?.nickname || mockE.user_id

      const queryParts = [
        {
          text: `你已经很久没有和用户【${userName}】(QQ: ${mockE.user_id})聊天了。请参考你们之前的对话历史，主动、自然地用一个的话题开始一段新的对话，并在回复中使用'@${mockE.user_id}'来提醒用户。`,
        },
      ]

      const geminiResponse = await getAI(
        profile.Channel,
        mockE,
        queryParts,
        profile.Prompt,
        profile.GroupContext,
        false,
        history,
      )

      if (geminiResponse && geminiResponse.text) {
        const messageToSend = parseAtMessage(geminiResponse.text)
        await mockE.group.sendMsg(messageToSend)
      } else {
        logger.warn(`主动聊天失败: AI未生成有效回复。`)
      }
    } catch (error) {
      logger.error(`触发主动聊天(用户 ${mockE.user_id}, 群 ${mockE.group_id})时出错: ${error}`)
    }
  }
}
