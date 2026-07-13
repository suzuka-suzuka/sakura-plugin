import { runAgentLoop } from "../lib/AIUtils/AgentRunner.js";
import {
  loadConversationHistory,
  saveConversationHistory,
  trimConversationHistoryByRounds,
} from "../lib/AIUtils/ConversationHistory.js";
import { resolveToolConfirmation } from "../lib/AIUtils/tools/tools.js";
import {
  splitAndReplyMessages,
  parseAtMessage,
  getQuoteContent,
} from "../lib/AIUtils/messaging.js";
import Setting from "../lib/setting.js";
import { buildMultimodalQueryParts } from "../lib/AIUtils/messageParts.js";
import { getMessageIdentifier } from "../lib/AIUtils/messageIdentifiers.js";
import { getImg, randomReact, smartReplyMsg } from "../lib/utils.js";

const MIMIC_HISTORY_PREFIX = "Mimic";
const MIMIC_HISTORY_MAX_ROUNDS = 10;

function trimMimicHistory(history) {
  return trimConversationHistoryByRounds(
    history,
    MIMIC_HISTORY_MAX_ROUNDS
  );
}

export class Mimic extends plugin {
  constructor() {
    super({
      name: "Mimic",
      event: "message.group",
      priority: Infinity,
    });
    this.activeLocks = new Map();
  }

  LOCK_TTL_MS = 120 * 1000;

  get appconfig() {
    return Setting.getConfig("mimic");
  }

  getGroupConfig(groupId) {
    const config = this.appconfig;
    if (!config.GroupConfigs || !Array.isArray(config.GroupConfigs)) {
      return config;
    }
    const groupConfig = config.GroupConfigs.find((c) => {
      if (!c.group) return false;
      if (Array.isArray(c.group)) {
        return c.group.map(String).includes(String(groupId));
      }
      return String(c.group) === String(groupId);
    });
    if (!groupConfig) {
      return config;
    }
    const mergedConfig = { ...config, ...groupConfig };
    if (groupConfig.triggerWords && Array.isArray(groupConfig.triggerWords)) {
      mergedConfig.triggerWords = groupConfig.triggerWords;
    }
    return mergedConfig;
  }

  getLockKey(e) {
    return this.getScopeKey(e.group_id || "private");
  }

  acquireLock(lockKey) {
    const now = Date.now();
    const currentLock = this.activeLocks.get(lockKey);
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
      if (this.activeLocks.get(lockKey) === lock) {
        this.activeLocks.delete(lockKey);
      }
    }, this.LOCK_TTL_MS);

    this.activeLocks.set(lockKey, lock);
    return lock;
  }

  releaseLock(lockKey, lock) {
    if (!lock || this.activeLocks.get(lockKey) !== lock) {
      return;
    }

    if (lock.timeout) {
      clearTimeout(lock.timeout);
    }
    this.activeLocks.delete(lockKey);
  }

  buildMessageText(e) {
    const contentParts = [];
    if (e.message && Array.isArray(e.message) && e.message.length > 0) {
      e.message.forEach((msgPart) => {
        if (msgPart.type === "file") {
          const seq = getMessageIdentifier(e.message_seq, e.message_id, e.seq);
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
            const seq = getMessageIdentifier(e.message_seq, e.message_id, e.seq);
            contentParts.push(`[图片]${seq ? `(seq:${seq})` : ""}`);
            break;
          }
        }
      });
    }
    return contentParts.join("").trim();
  }

  async preflightMimic(e) {
    if (!(this.appconfig.Groups || []).includes(e.group_id)) {
      return false;
    }

    const config = this.getGroupConfig(e.group_id);
    const messageText = this.buildMessageText(e);
    let query = messageText;

    const quoteContent = await getQuoteContent(e);
    if (quoteContent) {
      query = `(${quoteContent.trim()}) ${query}`;
    }

    if (!query.trim()) {
      return false;
    }

    const isAt =
      e.message &&
      e.message.some(
        (msg) => msg.type === "at" && String(msg.data?.qq) === String(e.self_id)
      );

    const hasKeyword = (config.triggerWords || []).some((word) =>
      messageText.includes(word)
    );

    const mustReply = Boolean((config.enableAtReply && isAt) || hasKeyword);
    if (!mustReply && Math.random() > config.replyProbability) {
      return false;
    }

    e._mimicPreflight = {
      config,
      query,
      messageText,
      isAt,
      hasKeyword,
      mustReply,
    };

    const shouldCharge =
      !e.isMaster &&
      e.group_id &&
      (hasKeyword || (config.enableAtReply && isAt));

    return {
      accepted: true,
      command: "拟态回复",
      charge: shouldCharge,
      refundOnFalse: true,
    };
  }

  Mimic = OnEvent("message.group", {
    economy: {
      command: "拟态回复",
      preflight: "preflightMimic",
      refundOnFalse: true,
    },
  }, async (e) => {
    const config = this.getGroupConfig(e.group_id);
    const groupLockKey = this.getLockKey(e);
    let groupLock = null;

    if (config.enableGroupLock && e.group_id) {
      groupLock = this.acquireLock(groupLockKey);
      if (!groupLock) {
        return false;
      }
    }

    try {
      return await this.doMimic(e);
    } finally {
      if (config.enableGroupLock && e.group_id) {
        this.releaseLock(groupLockKey, groupLock);
      }
    }
  });

  async doMimic(e) {
    if (!e._mimicPreflight) {
      const decision = await this.preflightMimic(e);
      if (!decision || decision.accepted === false) {
        return false;
      }
    }

    const { config, query, mustReply } = e._mimicPreflight;
    const shouldUseHistory = Boolean(mustReply);

    if (!query?.trim()) {
      return false;
    }

    let isNewMember = false;
    if (e.group_id) {
      try {
        const memberInfo = await e.getInfo(null, true);
        if (memberInfo?.join_time) {
          const joinTime = memberInfo.join_time;
          const currentTime = Math.floor(Date.now() / 1000);
          const NEW_MEMBER_THRESHOLD = 7 * 24 * 60 * 60;
          if (currentTime - joinTime < NEW_MEMBER_THRESHOLD) {
            isNewMember = true;
            logger.info(`新成员 ${e.user_id} 触发Mimic`);
          }
        }
      } catch (error) {
        logger.warn(`获取成员入群时间失败: ${error.message}`);
      }
    }

    let Prompt = config.Prompt;
    if (config.name) {
      const rolesConfig = Setting.getConfig("roles");
      const roles = rolesConfig?.roles || [];
      const role = roles.find((r) => r.name === config.name);
      if (role && role.prompt) {
        Prompt = role.prompt;
      }
    }

    let alternatePrompt = config.alternatePrompt;
    if (config.alternateName) {
      const rolesConfig = Setting.getConfig("roles");
      const roles = rolesConfig?.roles || [];
      const role = roles.find((r) => r.name === config.alternateName);
      if (role && role.prompt) {
        alternatePrompt = role.prompt;
      }
    }

    let selectedPresetPrompt = Prompt;
    let shouldRecall = false;
    if (
      !e.isMaster &&
      !isNewMember &&
      Math.random() < config.alternatePromptProbability
    ) {
      selectedPresetPrompt = alternatePrompt;
      shouldRecall = true;
    }

    logger.info(`mimic触发`);
    await randomReact(e);
    let currentFullHistory = [];
    const route = config.route;
    const toolGroup = config.toolGroup || '';
    try {
      if (shouldUseHistory) {
        currentFullHistory = trimMimicHistory(
          await loadConversationHistory(e, MIMIC_HISTORY_PREFIX)
        );
      }

      const imgBase64List = (await getImg(e, false, true)) || [];
      const queryParts = buildMultimodalQueryParts(query, imgBase64List);
      const agentResult = await runAgentLoop({
        label: "Mimic",
        e,
        route,
        queryParts,
        prompt: selectedPresetPrompt,
        groupContext: true,
        toolGroup,
        history: currentFullHistory,
        pluginInstance: this,
        onIntermediateText: async (text) => {
          await smartReplyMsg(e, text, { quote: true });
        },
      });

      currentFullHistory = agentResult.history;

      if (agentResult.status === "model_error") {
        return true;
      }

      if (shouldUseHistory) {
        const trimmedHistory = trimMimicHistory(currentFullHistory);
        currentFullHistory.splice(
          0,
          currentFullHistory.length,
          ...trimmedHistory
        );
        await saveConversationHistory(
          e,
          currentFullHistory,
          MIMIC_HISTORY_PREFIX
        );
      }

      if (agentResult.status === "tool_limit") {
        await e.reply("⚠️ 工具调用次数过多，为防止死循环已强制中断对话。", 10, true);
        return true;
      }

      const recalltime = config.recalltime;

      await smartReplyMsg(e, agentResult.finalText, {
        textReplyFn: async (t) => {
          if (config.splitMessage) {
            await splitAndReplyMessages(e, t, shouldRecall, recalltime);
          } else {
            await e.reply(parseAtMessage(t), shouldRecall ? recalltime : 0, true);
          }
        },
      });
    } catch (error) {
      logger.error(`处理过程中出现错误: ${error.message}`);
      return true;
    }
    return true;
  }

  async handleToolConfirmCallback() {
    await resolveToolConfirmation(this);
  }
}
