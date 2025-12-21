import Setting from "../lib/setting.js";
import { getAI } from "../lib/AIUtils/getAI.js";
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../lib/AIUtils/ConversationHistory.js";
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js";
import { parseAtMessage, getQuoteContent } from "../lib/AIUtils/messaging.js";
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

  Chat = OnEvent("message", "white", async (e) => {
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
            const seq = e.seq || e.message_seq;
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

    const matchedProfile = config.profiles.find((p) =>
      textToMatch.startsWith(p.prefix)
    );

    if (!matchedProfile) {
      return false;
    }

    const { prefix, Channel, GroupContext, History, Tool } = matchedProfile;

    let Prompt = matchedProfile.Prompt;
    if (matchedProfile.name) {
      const rolesConfig = Setting.getConfig("roles");
      const roles = rolesConfig?.roles || [];
      const role = roles.find((r) => r.name === matchedProfile.name);
      if (role && role.prompt) {
        Prompt = role.prompt;
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
    if (config.enableUserLock) {
      lockKey = e.group_id
        ? `sakura:chat:lock:${e.group_id}:${e.user_id}`
        : `sakura:chat:lock:private:${e.user_id}`;

      if (await redis.get(lockKey)) {
        logger.info(
          `[Chat] 用户 ${e.user_id} 的上一条消息仍在处理中，本次触发已忽略。`
        );
        return false;
      }
      await redis.set(lockKey, "1", { EX: 120 });
    }

    try {
      return await this.doChat(e, { ...matchedProfile, Prompt }, query);
    } finally {
      if (lockKey) {
        await redis.del(lockKey);
      }
    }
  });

  async doChat(e, matchedProfile, query) {
    const { Channel, Prompt, GroupContext, History, Tool } = matchedProfile;

    logger.info(`Chat触发`);
    await e.react(124);

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

      const queryParts = [{ text: query }];
      const { prefix } = matchedProfile;

      let currentAIResponse = await getAI(
        Channel,
        e,
        queryParts,
        Prompt,
        GroupContext,
        Tool,
        currentFullHistory
      );

      if (typeof currentAIResponse === "string") {
        await e.reply(currentAIResponse, 10, true);
        return true;
      }

      currentFullHistory.push({ role: "user", parts: queryParts });

      while (true) {
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
          if (toolCallCount >= 5) {
            logger.warn(`[Chat] 工具调用次数超过上限，强行结束对话`);
            return true;
          }

          if (textContent) {
            const cleanedTextContent = textContent.replace(/\n+$/, "");
            const parsedcleanedTextContent = parseAtMessage(cleanedTextContent);
            await e.reply(parsedcleanedTextContent, 0, true);
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
            currentFullHistory
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
        const historyToSave = currentFullHistory.filter(
          (part) =>
            part.role === "user" ||
            (part.role === "model" &&
              part.parts.every((p) => p.hasOwnProperty("text")))
        );
        await saveConversationHistory(e, historyToSave, prefix);
      }

      const msg = parseAtMessage(finalResponseText);
      await e.reply(msg);
    } catch (error) {
      logger.error(`Chat处理过程中出现错误: ${error.message}`);
      await e.reply(`处理过程中出现错误: ${error.message}`, 10, true);
      return true;
    }
    return true;
  }
}
