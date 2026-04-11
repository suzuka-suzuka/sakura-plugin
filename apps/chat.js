import Setting from "../lib/setting.js";
import { getAI, getCurrentAndPreviousUserText } from "../lib/AIUtils/getAI.js";
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../lib/AIUtils/ConversationHistory.js";
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js";
import { getQuoteContent } from "../lib/AIUtils/messaging.js";
import { checkForNaiTags } from "../lib/AIUtils/naiHandler.js";
import {
  findExistingMemoryFile,
  getMemoryPathsFromEvent,
} from "../lib/AIUtils/memoryStore.js";
import { randomReact, getImg, smartReplyMsg } from "../lib/utils.js";
import fs from "fs";
import { checkAndClearStopFlag } from "../lib/AIUtils/stopFlag.js";

export class AIChat extends plugin {
  constructor() {
    super({
      name: "chat",
      event: "message",
      priority: 1135,
    });
  }

  get appconfig() {
    return Setting.getConfig("AI");
  }

  // ===== 连续对话会话管理 =====
  SESSION_TTL = 300; // 秒

  getSessionKey(e) {
    const scope = e.group_id ? `${e.group_id}:${e.user_id}` : `private:${e.user_id}`;
    return `sakura:chat:session:${scope}`;
  }

  getUserLockKey(e) {
    const scope = e.group_id ? `${e.group_id}:${e.user_id}` : `private:${e.user_id}`;
    return scope;
  }

  getMemoryFile(e) {
    const { scopedFile } = getMemoryPathsFromEvent(e);
    return scopedFile;
  }

  getSessionLabel(profile) {
    return profile?.name || profile?.prefix;
  }

  getRolesConfig(e) {
    return Setting.getConfig("roles", { selfId: e?.self_id });
  }

  getRolePrompt(roleName, e) {
    const rolesConfig = this.getRolesConfig(e);
    const roles = rolesConfig?.roles || [];
    const role = roles.find((item) => item.name === roleName);
    return role?.prompt || "";
  }

  async startSession(e, profile, Prompt) {
    const key = this.getSessionKey(e);
    // 保存会话数据到 Redis（剔除不可序列化的内容）
    const sessionData = {
      profile: { ...profile },
      Prompt,
    };
    await redis.set(key, JSON.stringify(sessionData), "EX", this.SESSION_TTL);
  }

  async getSession(e) {
    const key = this.getSessionKey(e);
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async refreshSession(e) {
    const key = this.getSessionKey(e);
    const exists = await redis.expire(key, this.SESSION_TTL);
    return exists === 1;
  }

  async endSession(e) {
    const key = this.getSessionKey(e);
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // 统一回复处理函数
  async smartReply(e, text, quote = 0, at = false) {
    if (!text) return;
    return await smartReplyMsg(e, text, { quote, at });
  }

  Chat = OnEvent("message", async (e) => {
    const config = this.appconfig;
    if (!config || !config.profiles || config.profiles.length === 0) {
      return false;
    }

    let contentParts = [];
    if (e.message && Array.isArray(e.message) && e.message.length > 0) {
      e.message.forEach((msgPart) => {
        switch (msgPart.type) {
          case "text":
            contentParts.push(msgPart.data?.text || "");
            break;
          case "at":
            contentParts.push(`@${msgPart.data?.qq}`);
            break;
          case "image":
            const seq = e.message_id || e.message_seq;
            contentParts.push(`[图片]${seq ? `(seq:${seq})` : ""}`);
            break;
        }
      });
    }
    let messageText = contentParts.join("").trim();
    if (!messageText) {
      return false;
    }

    let textToMatch = messageText;
    if (e.message?.[0]?.type === "at") {
      const atText = `@${e.message[0].data?.qq}`;
      if (textToMatch.startsWith(atText)) {
        textToMatch = textToMatch.substring(atText.length).trim();
      }
    }

    // === 连续对话会话管理 ===

    // 结束对话指令
    if (textToMatch === "结束对话") {
      const endedSession = await this.endSession(e);
      if (endedSession) {
        await e.reply(`已结束与【${endedSession.profile.name || endedSession.profile.prefix}】的对话。`, 10);
        return true;
      }
    }

    // 开始对话指令：开始对话<prefix> 或 开始对话 <prefix>
    const START_CMD = "开始对话";
    if (textToMatch.startsWith(START_CMD)) {
      const afterCmd = textToMatch.substring(START_CMD.length).trim();
      const startProfile = config.profiles.find((p) =>
        p.prefix && (afterCmd === p.prefix || afterCmd.startsWith(p.prefix))
      );
      if (startProfile) {
        let StartPrompt = startProfile.Prompt;
        if (startProfile.name) {
          const rolePrompt = this.getRolePrompt(startProfile.name, e);
          if (rolePrompt) StartPrompt = rolePrompt;
        }
        const existingSession = await this.getSession(e);
        await this.startSession(e, startProfile, StartPrompt);
        const newLabel = this.getSessionLabel(startProfile);
        if (existingSession) {
          const oldLabel = this.getSessionLabel(existingSession.profile);
          await e.reply(`已从【${oldLabel}】切换到【${newLabel}】的对话，发送「结束对话」或5分钟内无活动将自动结束。`, 10);
        } else {
          await e.reply(`已开始与【${newLabel}】的对话，发送「结束对话」或5分钟内无活动将自动结束。`, 10);
        }
        return true;
      }

      // 未找到 prefix 匹配，尝试按角色名直接查找 roles.yaml
      const rolesConfigForStart = this.getRolesConfig(e);
      const allRoles = rolesConfigForStart?.roles || [];
      const roleByName = allRoles.find((r) => r.name && afterCmd === r.name);
      if (roleByName) {
        const virtualPrefix = roleByName.name;
        const virtualProfile = {
          prefix: virtualPrefix,
          name: roleByName.name,
          Prompt: roleByName.prompt || "",
          Channel: roleByName.Channel || config.defaultchannel || "default",
          GroupContext: roleByName.GroupContext ?? false,
          History: roleByName.History ?? true,
          Tool: roleByName.Tool ?? false,
          Memory: roleByName.Memory ?? false,
          enableNaiPainting: roleByName.enableNaiPainting ?? false,
          naiPrompt: roleByName.naiPrompt || "",
        };
        const existingSession = await this.getSession(e);
        await this.startSession(e, virtualProfile, virtualProfile.Prompt);
        if (existingSession) {
          const oldLabel = this.getSessionLabel(existingSession.profile);
          await e.reply(`已从【${oldLabel}】切换到【${roleByName.name}】的对话，发送「结束对话」或5分钟内无活动将自动结束。`, 10);
        } else {
          await e.reply(`已开始与【${roleByName.name}】的对话，发送「结束对话」或5分钟内无活动将自动结束。`, 10);
        }
        return true;
      }
    }

    const matchedProfile = config.profiles.find((p) =>
      textToMatch.startsWith(p.prefix)
    );

    if (!matchedProfile) {
      // 检查是否有活跃会话（无前缀聊天）
      const session = await this.getSession(e);
      if (session) {
        if (!Setting.payForCommand(e, "AI聊天")) return false;

        let sessionQuery = textToMatch;
        if (!sessionQuery) return false;

        const quoteContent = await getQuoteContent(e);
        if (quoteContent) {
          sessionQuery = `(${quoteContent.trim()}) ${sessionQuery}`;
        }

        await this.refreshSession(e);

        if (!this.userLocks) this.userLocks = new Map();
        let sessionLockKey = null;
        if (config.enableUserLock) {
          sessionLockKey = this.getUserLockKey(e);
          const now = Date.now();
          if (this.userLocks.has(sessionLockKey)) {
            const lockTime = this.userLocks.get(sessionLockKey);
            if (now - lockTime < 120 * 1000) {
              logger.info(`[Chat] 用户 ${e.user_id} 的上一条消息仍在处理中，本次触发已忽略。`);
              return false;
            }
          }
          this.userLocks.set(sessionLockKey, now);
        }
        try {
          return await this.doChat(e, { ...session.profile, Prompt: session.Prompt }, sessionQuery);
        } finally {
          if (sessionLockKey) this.userLocks.delete(sessionLockKey);
        }
      }
      return false;
    }

    if (!Setting.payForCommand(e, "AI聊天")) {
      return false;
    }

    const { prefix, Channel, GroupContext, History, Tool } = matchedProfile;

    let Prompt = matchedProfile.Prompt;
    if (matchedProfile.name) {
      const rolePrompt = this.getRolePrompt(matchedProfile.name, e);
      if (rolePrompt) {
        Prompt = rolePrompt;
      }
    }

    let query = textToMatch.substring(prefix.length).trim();

    if (!query) {
      return false;
    }

    const quoteContent = await getQuoteContent(e);
    if (quoteContent) {
      query = `(${quoteContent.trim()}) ${query}`;
    }

    // 使用内存 Map 替代 Redis 锁，降低依赖
    if (!this.userLocks) {
      this.userLocks = new Map();
    }

    let lockKey = null;
    if (config.enableUserLock) {
      lockKey = this.getUserLockKey(e);

      const now = Date.now();
      if (this.userLocks.has(lockKey)) {
        const lockTime = this.userLocks.get(lockKey);
        // 锁超时检查 (120秒)，防止死锁
        if (now - lockTime < 120 * 1000) {
          logger.info(
            `[Chat] 用户 ${e.user_id} 的上一条消息仍在处理中，本次触发已忽略。`
          );
          return false;
        }
      }
      this.userLocks.set(lockKey, now);
    }

    try {
      return await this.doChat(e, { ...matchedProfile, Prompt }, query);
    } finally {
      if (lockKey) {
        this.userLocks.delete(lockKey);
      }
    }
  });

  async doChat(e, matchedProfile, query) {
    let { Channel, Prompt, GroupContext, History, Tool, Memory, enableNaiPainting, naiPrompt } = matchedProfile;

    // 记忆注入：将用户长期记忆追加到 system prompt
    if (Memory) {
      const userId = e.user_id;
      const userName = e.sender?.card || e.sender?.nickname || "";
      const memoryFile = findExistingMemoryFile(getMemoryPathsFromEvent(e));
      if (memoryFile) {
        try {
          const memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
          if (memories && memories.length > 0) {
            Prompt += `\n\n【关于当前用户的记忆】\n当前对话用户：${userName} (${userId})\n该用户曾让你记住以下信息（请将其视为关于该用户的设定或事实）：\n` +
              memories.map((m) => `- ${m}`).join("\n");
          }
        } catch (err) {
          logger.warn(`[Chat] 读取记忆文件失败: ${err.message}`);
        }
      }
    }

    logger.info(`Chat触发`);
    await randomReact(e);

    if (enableNaiPainting) {
      Prompt += `
    ---
    **[Visual Snapshot Instruction]**
    Generate a strictly visual description tag <draw>...</draw> at the end of your response to represent your current visual state.
    
    You must focus on describing your appearance, outfit, and current dynamic elements.
    
    1. **Character Identity**: If you are a known character from an anime/game, you MUST start the tag with your English Danbooru character tag (e.g., izumi sagiri, hatsune miku). Otherwise, use 1girl or 1boy.
    2. **Clothing**: What outfits or accessories are you wearing right now?
    3. **Dynamic Action**: What are you doing right now? (e.g., reaching out, running, sitting with legs crossed)
    4. **Expression**: Detailed facial emotion. (e.g., tears in eyes, wide grin, blushing)
    5. **Camera & Composition**: How is the scene shot? (e.g., close-up, dutch angle, looking at viewer, cinematic lighting)
    6. **Environment**: Immediate surroundings. (e.g., rain-soaked street, cozy bedroom, burning ruins)

    **Format Constraint**: 
    - Use Danbooru-style tags or short descriptive English phrases, separated by commas. MUST be in English.
    - **DO NOT** describe your basic physical traits (hair color, eye color) unless altered by the situation.
    
    **Example**: 
    <draw>izumi sagiri, pink pajamas, leaning against the wall, arms crossed, skeptical expression, looking to the side, dimly lit bedroom, cowboy shot</draw>
    `;
    }

    let finalResponseText = "";
    let currentFullHistory = [];
    let toolCallCount = 0;

    try {
      if (History) {
        currentFullHistory = await loadConversationHistory(
          e,
          matchedProfile.prefix
        );
      }

      let queryParts;
      if (Tool) {
        queryParts = [{ text: query }];
      } else {
        const imgBase64List = (await getImg(e, false, true)) || [];
        queryParts = [
          { text: query },
          ...imgBase64List.map((img) => ({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64,
            },
          })),
        ];
      }
      const { prefix } = matchedProfile;
      const lockedVectorContext = getCurrentAndPreviousUserText(queryParts, currentFullHistory);

      let currentAIResponse = await getAI(
        Channel,
        e,
        queryParts,
        Prompt,
        GroupContext,
        Tool,
        currentFullHistory,
        lockedVectorContext
      );

      if (typeof currentAIResponse === "string") {
        await e.reply(currentAIResponse, 10, true);
        return true;
      }

      const historyParts = queryParts.filter((part) => !part.inlineData);
      if (historyParts.length > 0) {
        currentFullHistory.push({ role: "user", parts: historyParts });
      }

      const truncateHistory = (history) => history.map((item) => {
        if (item.role === "function" && item.parts) {
          return {
            ...item,
            parts: item.parts.map((part) => {
              if (part.functionResponse?.response) {
                const responseStr = JSON.stringify(part.functionResponse.response);
                if (responseStr.length > 2000) {
                  return {
                    ...part,
                    functionResponse: {
                      ...part.functionResponse,
                      response: {
                        message: responseStr.substring(0, 2000) + "...(已截断)",
                      },
                    },
                  };
                }
              }
              return part;
            }),
          };
        }
        return item;
      });

      while (true) {
        if (checkAndClearStopFlag(e)) {
          logger.info(`[Chat] 用户 ${e.user_id} 触发了强制停止`);
          break;
        }

        const textContent = currentAIResponse.text;
        const functionCalls = currentAIResponse.functionCalls;
        const rawParts = currentAIResponse.rawParts;
        let modelResponseParts = [];

        if (rawParts && rawParts.length > 0) {
          modelResponseParts = rawParts;
        } else {
          if (textContent) {
            modelResponseParts.push({ text: textContent });
          }
          if (functionCalls && functionCalls.length > 0) {
            for (const fc of functionCalls) {
              modelResponseParts.push({ functionCall: fc });
            }
          }
        }

        if (modelResponseParts.length > 0) {
          currentFullHistory.push({ role: "model", parts: modelResponseParts });
        }

        if (functionCalls && functionCalls.length > 0) {
          toolCallCount++;
          const maxToolCalls = this.appconfig.maxToolCalls ?? 20;
          if (toolCallCount >= maxToolCalls) {
            logger.warn(`[Chat] 工具调用次数超过上限(${maxToolCalls})，强行结束对话`);
            await e.reply("⚠️ 工具调用次数过多，为防止死循环已强制中断对话。", 10, true);
            if (History) {
              await saveConversationHistory(e, truncateHistory(currentFullHistory), prefix);
            }
            return true;
          }

          if (textContent) {
            let cleanedTextContent = textContent.replace(/\n+$/, "");
            cleanedTextContent = await checkForNaiTags(cleanedTextContent, e, naiPrompt);
            // 中间回复也走 smartReply
            await this.smartReply(e, cleanedTextContent, 0, true);
          }
          const executedResults = await executeToolCalls(e, functionCalls);
          currentFullHistory.push(...executedResults);

          currentAIResponse = await getAI(
            Channel,
            e,
            "",
            Prompt,
            GroupContext,
            Tool,
            currentFullHistory,
            lockedVectorContext
          );

          if (typeof currentAIResponse === "string") {
            await e.reply(currentAIResponse, 10, true);
            return true;
          }
        } else if (textContent) {
          finalResponseText = textContent;
          break;
        }
      }

      if (History) {
        await saveConversationHistory(e, truncateHistory(currentFullHistory), prefix);
      }

      finalResponseText = await checkForNaiTags(finalResponseText, e, naiPrompt);
      // 最后回复也走 smartReply
      await this.smartReply(e, finalResponseText);
      return true;
    } catch (err) {
      logger.error(`[Chat] 处理出错: ${err.message}`);
      await e.reply("出错啦！请稍后再试。");
    }
  }
}
