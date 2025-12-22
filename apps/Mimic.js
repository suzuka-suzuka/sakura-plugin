import fs from "fs";
import path from "path";
import { _path } from "../lib/path.js";
import { getAI } from "../lib/AIUtils/getAI.js";
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js";
import {
  splitAndReplyMessages,
  parseAtMessage,
  getQuoteContent,
} from "../lib/AIUtils/messaging.js";
import Setting from "../lib/setting.js";
import { randomReact } from "../lib/utils.js";

export class Mimic extends plugin {
  constructor() {
    super({
      name: "Mimic",
      event: "message.group",
      priority: Infinity,
    });
  }

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
    if (
      groupConfig.triggerWords &&
      typeof groupConfig.triggerWords === "string"
    ) {
      mergedConfig.triggerWords = groupConfig.triggerWords
        .split("\n")
        .map((w) => w.trim())
        .filter((w) => w);
    }
    return mergedConfig;
  }

  Mimic = OnEvent("message.group", async (e) => {
    const config = this.getGroupConfig(e.group_id);
    if (config.enableGroupLock && e.group_id) {
      const lockKey = `sakura:mimic:lock:${e.group_id}`;
      if (await redis.get(lockKey)) {
        return false;
      }
      await redis.set(lockKey, "1", "EX", 120);
    }

    try {
      return await this.doMimic(e);
    } finally {
      if (config.enableGroupLock && e.group_id) {
        const lockKey = `sakura:mimic:lock:${e.group_id}`;
        await redis.del(lockKey);
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

    if (!e.isWhite && e.group_id && config.enableLevelLimit && hasKeyword) {
      const memberInfo = await e.getInfo(null, true);

      const level = memberInfo?.level || 100;

      if (level <= 10) {
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

    const groupId = e.group_id || "private";
    const userId = e.user_id;
    const userName = e.sender.card || e.sender.nickname || "";

    const memoryFile = path.join(
      _path,
      "plugins",
      "sakura-plugin",
      "data",
      "mimic",
      String(groupId),
      `${userId}.json`
    );

    if (fs.existsSync(memoryFile)) {
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
    let finalResponseText = "";
    let currentFullHistory = [];
    let toolCallCount = 0;
    const Channel = config.Channel;
    try {
      const queryParts = [{ text: query }];

      const geminiInitialResponse = await getAI(
        Channel,
        e,
        queryParts,
        selectedPresetPrompt,
        true,
        true,
        currentFullHistory
      );

      if (typeof geminiInitialResponse === "string") {
        return false;
      }

      currentFullHistory.push({ role: "user", parts: queryParts });

      let currentGeminiResponse = geminiInitialResponse;

      while (true) {
        const textContent = currentGeminiResponse.text;
        const functionCalls = currentGeminiResponse.functionCalls;
        const rawParts = currentGeminiResponse.rawParts;
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
          if (toolCallCount >= 5) {
            logger.warn(`[Mimic] 工具调用次数超过上限，强行结束对话`);
            return false;
          }

          if (textContent) {
            const cleanedTextContent = textContent.replace(/\n+$/, "");
            const parsedcleanedTextContent = parseAtMessage(cleanedTextContent);
            await e.reply(parsedcleanedTextContent, true);
          }
          const executedResults = await executeToolCalls(e, functionCalls);
          currentFullHistory.push(...executedResults);
          currentGeminiResponse = await getAI(
            Channel,
            e,
            "",
            selectedPresetPrompt,
            true,
            true,
            currentFullHistory
          );

          if (typeof currentGeminiResponse === "string") {
            return false;
          }
        } else if (textContent) {
          finalResponseText = textContent;
          break;
        }
      }

      const recalltime = config.recalltime;
      if (config.splitMessage) {
        await splitAndReplyMessages(
          e,
          finalResponseText,
          shouldRecall,
          recalltime
        );
      } else {
        const parsedResponse = parseAtMessage(finalResponseText);
        await e.reply(parsedResponse, shouldRecall ? recalltime : 0, true);
      }
    } catch (error) {
      logger.error(`处理过程中出现错误: ${error.message}`);
      return false;
    }
    return false;
  }
}
