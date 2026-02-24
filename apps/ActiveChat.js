import Setting from "../lib/setting.js";
import { getAI } from "../lib/AIUtils/getAI.js";
import { loadConversationHistory, ConversationHistoryUtils } from "../lib/AIUtils/ConversationHistory.js";
import { parseAtMessage } from "../lib/AIUtils/messaging.js";
import fs from "fs";
import path from "path";

const INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export class ActiveChatScheduler extends plugin {
  constructor() {
    super({
      name: "AI主动聊天任务",
      event: "message",
    });
  }

  proactiveChatTask = Cron("0 * * * *", async () => {
    if (!bot) return;
    const config = Setting.getConfig("AI");
    const activeChatConfig = Setting.getConfig("ActiveChat");
    if (!config || !config.profiles || config.profiles.length === 0) {
      return;
    }

    try {
      const historyDir = ConversationHistoryUtils.HISTORY_DIR;
      if (!fs.existsSync(historyDir)) return;

      const groupFolders = await fs.promises.readdir(historyDir);
      const now = Date.now();

      for (const groupFolder of groupFolders) {
        // 排除非群组文件夹（如 private）或非数字文件夹
        if (groupFolder === "private" || isNaN(groupFolder)) continue;

        const group_id = parseInt(groupFolder, 10);

        if (
          !activeChatConfig?.Groups ||
          !activeChatConfig.Groups.includes(group_id)
        ) {
          continue;
        }

        const groupPath = path.join(historyDir, groupFolder);
        const userFiles = await fs.promises.readdir(groupPath);

        for (const userFile of userFiles) {
          if (!userFile.endsWith(".json")) continue;

          const user_id = parseInt(userFile.replace(".json", ""), 10);
          const filePath = path.join(groupPath, userFile);

          let userData;
          try {
            userData = await ConversationHistoryUtils.readUserFile(filePath);
          } catch (err) {
            logger.error(`读取用户 ${user_id} 历史文件失败: ${err}`);
            continue;
          }

          if (!userData) continue;

          let fileModified = false;

          // 遍历该用户文件下的所有 profile 前缀
          for (const [profilePrefix, data] of Object.entries(userData)) {
            if (!data || !data.lastInteraction) continue;

            const lastInteractionTime = data.lastInteraction;

            if (now - lastInteractionTime > INACTIVITY_THRESHOLD_MS) {
              // 准备触发主动聊天
              logger.info(
                `用户 ${user_id} 在群 ${group_id} (profile: ${profilePrefix}) 已超过设定时间未互动，准备触发聊天`
              );

              const profile = config.profiles.find(
                (p) => p.prefix === profilePrefix
              );

              if (!profile) {
                // 如果 profile 不存在了，清理掉这个 key 的时间戳
                delete data.lastInteraction;
                fileModified = true;
                continue;
              }

              const group = bot.pickGroup?.(group_id);
              if (!group) {
                continue;
              }

              let memberInfo;
              try {
                memberInfo = await bot.getGroupMemberInfo(group_id, user_id);
              } catch {
                // 成员可能退群了
              }

              if (!memberInfo) {
                // 找不到成员，也清理掉时间戳，避免死循环报错
                delete data.lastInteraction;
                fileModified = true;
                continue;
              }

              const mockE = {
                group_id: group_id,
                user_id: user_id,
                self_id: bot.self_id,
                bot: bot,
                sender: memberInfo,
              };

              const history = await loadConversationHistory(mockE, profilePrefix);
              await this.triggerProactiveChat(mockE, profile, history);

              // 触发后，删除 lastInteraction，防止重复触发
              // 等用户回复后，ConversationHistory.js 会重新写入新的 lastInteraction
              delete data.lastInteraction;
              fileModified = true;
            }
          }

          if (fileModified) {
            await ConversationHistoryUtils.writeUserFile(filePath, userData);
          }
        }
      }

    } catch (error) {
      logger.error(`主动聊天定时任务执行出错: ${error}`);
    }
  });

  async triggerProactiveChat(mockE, profile, history) {
    try {
      const SenderInfo = mockE.sender;

      const userName =
        SenderInfo?.card || SenderInfo?.nickname || mockE.user_id;

      const queryParts = [
        {
          text: `你已经很久没有和用户【${userName}】(QQ: ${mockE.user_id})聊天了。请参考你们之前的对话历史，主动、自然地用一个的话题开始一段新的对话，并在回复中使用'@${mockE.user_id}'来提醒用户。`,
        },
      ];

      let Prompt = profile.Prompt;
      if (profile.name) {
        const rolesConfig = Setting.getConfig("roles");
        const roles = rolesConfig?.roles || [];
        const role = roles.find((r) => r.name === profile.name);
        if (role && role.prompt) {
          Prompt = role.prompt;
        }
      }

      const geminiResponse = await getAI(
        profile.Channel,
        mockE,
        queryParts,
        Prompt,
        profile.GroupContext,
        false,
        history
      );

      if (geminiResponse && geminiResponse.text) {
        const messageToSend = parseAtMessage(geminiResponse.text);
        await bot.sendGroupMsg(mockE.group_id, messageToSend);
      } else {
        logger.warn(`主动聊天失败: AI未生成有效回复。`);
      }
    } catch (error) {
      logger.error(
        `触发主动聊天(用户 ${mockE.user_id}, 群 ${mockE.group_id})时出错: ${error}`
      );
    }
  }
}

