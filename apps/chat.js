import Setting from "../lib/setting.js";
import { getAI } from "../lib/AIUtils/getAI.js";
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../lib/AIUtils/ConversationHistory.js";
import { executeToolCalls } from "../lib/AIUtils/tools/tools.js";
import { parseAtMessage, getQuoteContent } from "../lib/AIUtils/messaging.js";
import { checkForNaiTags } from "../lib/AIUtils/naiHandler.js";
import { randomReact, getImg } from "../lib/utils.js";

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

    const matchedProfile = config.profiles.find((p) =>
      textToMatch.startsWith(p.prefix)
    );

    if (!matchedProfile) {
      return false;
    }

    if (!Setting.payForCommand(e, "AI聊天")) {
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

    // 使用内存 Map 替代 Redis 锁，降低依赖
    if (!this.userLocks) {
      this.userLocks = new Map();
    }

    let lockKey = null;
    if (config.enableUserLock) {
      lockKey = e.group_id
        ? `${e.group_id}:${e.user_id}`
        : `private:${e.user_id}`;

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
    let { Channel, Prompt, GroupContext, History, Tool, enableNaiPainting, naiPrompt } = matchedProfile;

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

      const historyParts = queryParts.filter((part) => !part.inlineData);
      if (historyParts.length > 0) {
        currentFullHistory.push({ role: "user", parts: historyParts });
      }

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
            let cleanedTextContent = textContent.replace(/\n+$/, "");
            cleanedTextContent = await checkForNaiTags(cleanedTextContent, e, naiPrompt);
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
          (item) =>
            item.role === "user" ||
            (item.role === "model" &&
              item.parts.every((p) => p.hasOwnProperty("text")))
        );
        await saveConversationHistory(e, historyToSave, prefix);
      }

      finalResponseText = await checkForNaiTags(finalResponseText, e, naiPrompt);
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
