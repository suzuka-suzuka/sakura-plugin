import Setting from "../lib/setting.js";
import { runAgentLoop } from "../lib/AIUtils/AgentRunner.js";
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../lib/AIUtils/ConversationHistory.js";
import { resolveToolConfirmation } from "../lib/AIUtils/tools/tools.js";
import { getQuoteContent } from "../lib/AIUtils/messaging.js";
import { checkForNaiTags } from "../lib/AIUtils/naiHandler.js";
import {
  findExistingMemoryFile,
  getMemoryPathsFromEvent,
} from "../lib/AIUtils/memoryStore.js";
import { randomReact, getImg, smartReplyMsg } from "../lib/utils.js";
import fs from "fs";

export class AIChat extends plugin {
  constructor() {
    super({
      name: "chat",
      event: "message",
      priority: 1135,
    });
    this.userLocks = new Map();
  }

  LOCK_TTL_MS = 120 * 1000;

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

  acquireUserLock(lockKey) {
    const now = Date.now();
    const currentLock = this.userLocks.get(lockKey);
    if (currentLock && now - currentLock.startedAt < this.LOCK_TTL_MS) {
      return null;
    }

    if (currentLock?.timeout) {
      clearTimeout(currentLock.timeout);
    }

    const lock = {
      startedAt: now,
      timeout: null,
    };
    lock.timeout = setTimeout(() => {
      if (this.userLocks.get(lockKey) === lock) {
        this.userLocks.delete(lockKey);
      }
    }, this.LOCK_TTL_MS);

    this.userLocks.set(lockKey, lock);
    return lock;
  }

  releaseUserLock(lockKey, lock) {
    if (!lock || this.userLocks.get(lockKey) !== lock) {
      return;
    }

    if (lock.timeout) {
      clearTimeout(lock.timeout);
    }
    this.userLocks.delete(lockKey);
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

  buildMessageText(e) {
    const contentParts = [];
    if (e.message && Array.isArray(e.message) && e.message.length > 0) {
      e.message.forEach((msgPart) => {
        if (msgPart.type === "file") {
          const seq = e.message_id || e.message_seq;
          const fileName = msgPart.data?.name || "未命名文件";
          contentParts.push(`[文件:${fileName}]${seq ? `(seq:${seq})` : ""}`);
          return;
        }

        switch (msgPart.type) {
          case "text":
            contentParts.push(msgPart.data?.text || "");
            break;
          case "at":
            contentParts.push(`@${msgPart.data?.qq}`);
            break;
          case "image": {
            const seq = e.message_id || e.message_seq;
            contentParts.push(`[图片]${seq ? `(seq:${seq})` : ""}`);
            break;
          }
        }
      });
    }
    return contentParts.join("").trim();
  }

  getTextToMatch(e, messageText) {
    let textToMatch = messageText;
    if (e.message?.[0]?.type === "at") {
      const atText = `@${e.message[0].data?.qq}`;
      if (textToMatch.startsWith(atText)) {
        textToMatch = textToMatch.substring(atText.length).trim();
      }
    }
    return textToMatch;
  }

  async preflightChat(e) {
    const config = this.appconfig;
    if (!config || !config.profiles || config.profiles.length === 0) {
      return false;
    }

    const messageText = this.buildMessageText(e);
    if (!messageText) {
      return false;
    }

    const textToMatch = this.getTextToMatch(e, messageText);
    e._chatPreflight = { messageText, textToMatch };

    if (textToMatch === "结束对话") {
      return { accepted: true, command: "AI聊天", charge: false };
    }

    const START_CMD = "开始对话";
    if (textToMatch.startsWith(START_CMD)) {
      const afterCmd = textToMatch.substring(START_CMD.length).trim();
      const startProfile = config.profiles.find((p) =>
        p.prefix && (afterCmd === p.prefix || afterCmd.startsWith(p.prefix))
      );
      const rolesConfigForStart = this.getRolesConfig(e);
      const allRoles = rolesConfigForStart?.roles || [];
      const roleByName = allRoles.find((r) => r.name && afterCmd === r.name);
      if (startProfile || roleByName) {
        return { accepted: true, command: "AI聊天", refundOnFalse: true };
      }
    }

    const matchedProfile = config.profiles.find((p) =>
      textToMatch.startsWith(p.prefix)
    );

    if (matchedProfile) {
      const query = textToMatch.substring(matchedProfile.prefix.length).trim();
      return query ? { accepted: true, command: "AI聊天", refundOnFalse: true } : false;
    }

    const session = await this.getSession(e);
    if (session && textToMatch.trim()) {
      e._chatPreflight.session = session;
      return { accepted: true, command: "AI聊天", refundOnFalse: true };
    }

    return false;
  }

  Chat = OnEvent("message", {
    economy: {
      command: "AI聊天",
      preflight: "preflightChat",
      refundOnFalse: true,
    },
  }, async (e) => {
    const config = this.appconfig;
    if (!config || !config.profiles || config.profiles.length === 0) {
      return false;
    }

    let messageText = e._chatPreflight?.messageText || this.buildMessageText(e);
    if (!messageText) {
      return false;
    }

    let textToMatch = e._chatPreflight?.textToMatch || this.getTextToMatch(e, messageText);

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
          Tool: roleByName.Tool ?? '',
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
      const session = e._chatPreflight?.session || await this.getSession(e);
      if (session) {
        let sessionQuery = textToMatch;
        if (!sessionQuery) return false;

        const quoteContent = await getQuoteContent(e);
        if (quoteContent) {
          sessionQuery = `(${quoteContent.trim()}) ${sessionQuery}`;
        }

        await this.refreshSession(e);

        let sessionLockKey = null;
        let sessionLock = null;
        if (config.enableUserLock) {
          sessionLockKey = this.getUserLockKey(e);
          sessionLock = this.acquireUserLock(sessionLockKey);
          if (!sessionLock) {
            logger.info(`[Chat] 用户 ${e.user_id} 的上一条消息仍在处理中，本次触发已忽略。`);
            return false;
          }
        }
        try {
          return await this.doChat(e, { ...session.profile, Prompt: session.Prompt }, sessionQuery);
        } finally {
          this.releaseUserLock(sessionLockKey, sessionLock);
        }
      }
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

    let lockKey = null;
    let userLock = null;
    if (config.enableUserLock) {
      lockKey = this.getUserLockKey(e);
      userLock = this.acquireUserLock(lockKey);
      if (!userLock) {
        logger.info(
          `[Chat] 用户 ${e.user_id} 的上一条消息仍在处理中，本次触发已忽略。`
        );
        return false;
      }
    }

    try {
      return await this.doChat(e, { ...matchedProfile, Prompt }, query);
    } finally {
      this.releaseUserLock(lockKey, userLock);
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

    let currentFullHistory = [];

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

      const agentResult = await runAgentLoop({
        label: "Chat",
        e,
        channel: Channel,
        queryParts,
        prompt: Prompt,
        groupContext: GroupContext,
        toolGroup: Tool,
        history: currentFullHistory,
        pluginInstance: this,
        onIntermediateText: async (text) => {
          const cleanedTextContent = await checkForNaiTags(text, e, naiPrompt);
          await this.smartReply(e, cleanedTextContent, 0, true);
        },
      });

      currentFullHistory = agentResult.history;

      if (agentResult.status === "model_error") {
        await e.reply(agentResult.error, 10, true);
        return true;
      }

      if (agentResult.status === "tool_limit") {
        await e.reply("⚠️ 工具调用次数过多，为防止死循环已强制中断对话。", 10, true);
        if (History) {
          await saveConversationHistory(e, currentFullHistory, prefix);
        }
        return true;
      }

      if (History) {
        await saveConversationHistory(e, currentFullHistory, prefix);
      }

      const finalResponseText = await checkForNaiTags(agentResult.finalText, e, naiPrompt);
      // 最后回复也走 smartReply
      await this.smartReply(e, finalResponseText);
      return true;
    } catch (err) {
      logger.error(`[Chat] 处理出错: ${err.message}`);
      await e.reply("出错啦！请稍后再试。");
    }
  }

  async handleToolConfirmCallback() {
    resolveToolConfirmation(this);
  }
}
