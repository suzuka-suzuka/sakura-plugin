import fs from "fs";
import { runAgentLoop } from "../lib/AIUtils/AgentRunner.js";
import {
  findExistingMemoryFile,
  getMemoryPathsFromEvent,
} from "../lib/AIUtils/memoryStore.js";
import { resolveToolConfirmation } from "../lib/AIUtils/tools/tools.js";
import {
  splitAndReplyMessages,
  parseAtMessage,
  getQuoteContent,
} from "../lib/AIUtils/messaging.js";
import Setting from "../lib/setting.js";
import { randomReact, smartReplyMsg } from "../lib/utils.js";

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

  getMemoryFile(e) {
    const { scopedFile } = getMemoryPathsFromEvent(e);
    return scopedFile;
  }

  Mimic = OnEvent("message.group", async (e) => {
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
    if (!this.appconfig.Groups.includes(e.group_id)) {
      return false;
    }

    const config = this.getGroupConfig(e.group_id);

    let contentParts = [];
    if (e.message && Array.isArray(e.message) && e.message.length > 0) {
      e.message.forEach((msgPart) => {
        if (msgPart.type === "file") {
          const seq = e.seq || e.message_seq;
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
          case "image":
            const seq = e.seq || e.message_seq;
            contentParts.push(`[图片]${seq ? `(seq:${seq})` : ""}`);
            break;
        }
      });
    }
    const messageText = contentParts.join("").trim();

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

    const hasKeyword = config.triggerWords.some((word) =>
      messageText.includes(word)
    );

    if (
      !e.isMaster &&
      e.group_id &&
      (hasKeyword || (config.enableAtReply && isAt))
    ) {
      if (!Setting.payForCommand(e, "伪人")) {
        return false;
      }
    }

    let mustReply = false;
    if (config.enableAtReply && isAt) {
      mustReply = true;
    } else if (hasKeyword) {
      mustReply = true;
    }

    if (!mustReply && Math.random() > config.replyProbability) {
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

    const userId = e.user_id;
    const userName = e.sender.card || e.sender.nickname || "";
    const memoryFile = findExistingMemoryFile(getMemoryPathsFromEvent(e));

    if (memoryFile) {
      try {
        const memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
        if (memories && memories.length > 0) {
          selectedPresetPrompt +=
            `\n\n【关于当前用户的记忆】\n当前对话用户：${userName} (${userId})\n该用户曾让你记住以下信息（请将其视为关于该用户的设定或事实）：\n` +
            memories.map((m) => `- ${m}`).join("\n");
        }
      } catch (err) {
        logger.error(`读取记忆文件失败: ${err}`);
      }
    }

    logger.info(`mimic触发`);
    await randomReact(e);
    const currentFullHistory = [];
    const Channel = config.Channel;
    const toolGroup = config.Tool || '';
    try {
      const queryParts = [{ text: query }];
      const agentResult = await runAgentLoop({
        label: "Mimic",
        e,
        channel: Channel,
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

      if (agentResult.status === "model_error") {
        return false;
      }

      if (agentResult.status === "tool_limit") {
        await e.reply("⚠️ 工具调用次数过多，为防止死循环已强制中断对话。", 10, true);
        return false;
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
      return false;
    }
    return false;
  }

  async handleToolConfirmCallback() {
    resolveToolConfirmation(this);
  }
}
