import Setting from "../lib/setting.js";
import { runAgentLoop } from "../lib/AIUtils/AgentRunner.js";
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../lib/AIUtils/ConversationHistory.js";
import { resolveToolConfirmation } from "../lib/AIUtils/tools/tools.js";
import { getQuoteContent } from "../lib/AIUtils/messaging.js";
import { checkForNaiTags } from "../lib/AIUtils/naiHandler.js";
import { buildMultimodalQueryParts } from "../lib/AIUtils/messageParts.js";
import { randomReact, getImg, smartReplyMsg } from "../lib/utils.js";
import {
  getPrimaryPrefix,
  matchProfilePrefix,
} from "../lib/AIUtils/profileTriggers.js";

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

  getRolesConfig(e) {
    return Setting.getConfig("roles", { selfId: e?.self_id });
  }

  getRolePrompt(roleName, e) {
    const rolesConfig = this.getRolesConfig(e);
    const roles = rolesConfig?.roles || [];
    const role = roles.find((item) => item.name === roleName);
    return role?.prompt || "";
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

    const matched = matchProfilePrefix(config.profiles, textToMatch);

    if (matched) {
      const query = textToMatch.substring(matched.prefix.length).trim();
      return query ? { accepted: true, command: "AI聊天", refundOnFalse: true } : false;
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

    const matched = matchProfilePrefix(config.profiles, textToMatch);
    const matchedProfile = matched?.profile;

    if (!matchedProfile) {
      return false;
    }

    const Prompt = this.getRolePrompt(matchedProfile.name, e);

    let query = textToMatch.substring(matched.prefix.length).trim();

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
    let { route, Prompt, groupContext, history, toolGroup, enableNaiPainting, naiPrompt } = matchedProfile;

    logger.info(`Chat触发`);
    await randomReact(e);

    if (enableNaiPainting) {
      const drawPrompt = Setting.getConfig("nai", { selfId: e?.self_id })?.chatDrawPrompt;
      if (typeof drawPrompt === "string" && drawPrompt.trim()) {
        Prompt += `\n\n---\n${drawPrompt.trim()}`;
      }
    }

    let currentFullHistory = [];

    try {
      if (history) {
        currentFullHistory = await loadConversationHistory(
          e,
          getPrimaryPrefix(matchedProfile)
        );
      }

      const imgBase64List = (await getImg(e, false, true)) || [];
      const queryParts = buildMultimodalQueryParts(query, imgBase64List);
      const prefix = getPrimaryPrefix(matchedProfile);

      const agentResult = await runAgentLoop({
        label: "Chat",
        e,
        route,
        queryParts,
        prompt: Prompt,
        groupContext,
        toolGroup,
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
        if (history) {
          await saveConversationHistory(e, currentFullHistory, prefix);
        }
        return true;
      }

      if (history) {
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
    await resolveToolConfirmation(this);
  }
}
