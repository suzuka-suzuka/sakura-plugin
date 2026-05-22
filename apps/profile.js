import { getAI } from "../lib/AIUtils/getAI.js";
import { marked } from "marked";
import puppeteer from "puppeteer";

import Setting from "../lib/setting.js";

const HISTORY_PAGE_SIZE = 30;
const MAX_SCAN_LIMIT = 2000;

export class UserProfilePlugin extends plugin {
  constructor() {
    super({
      name: "画像",
      event: "message.group",
      priority: 1135,
    });
  }

  generateUserProfile = Command(/^#画像$/, async (e) => {
    await e.react(124).catch((err) => {
      logger.warn("画像指令表情回应失败:", err);
    });

    const targetUserId = e.user_id;
    const messageCount = 100;
    const senderNickname = e.sender.card || e.sender.nickname || targetUserId;
    const messages = await getUserTextHistory(e, targetUserId, messageCount);

    if (!messages || messages.length === 0) {
      await e.reply("没有找到足够的文本聊天记录，暂时无法生成画像。", 10, true);
      return true;
    }

    const formattedLines = (
      await Promise.all(
        messages.map(async (chat) => {
          const time = new Date((chat.time || 0) * 1000).toLocaleString(
            "zh-CN",
            {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }
          );

          const contentParts = await Promise.all(
            chat.message.map((part) => formatMessagePart(e, part))
          );

          const textContent = contentParts.join("").trim();
          if (!textContent || textContent === "#画像") return "";

          return `[${time}] ${textContent}`;
        })
      )
    ).filter(Boolean);

    const rawChatHistory = formattedLines.join("\n");

    if (!rawChatHistory.trim()) {
      await e.reply("没有找到可用于画像分析的文字内容。", 10, true);
      return true;
    }

    const aiPrompt = `请根据【${senderNickname}】在群聊中的发言记录，对该用户进行全面的画像分析。请从以下几个维度进行分析，并以清晰、有条理的Markdown格式呈现你的结论：
1. **关键主题**：分析用户最常讨论的话题或感兴趣的领域是什么？
2. **语言风格**：用户的说话风格是怎样的？（例如：正式、口语化、幽默、简洁等）
3. **活跃时段**：根据发言时间，分析用户的活跃时间段，推测其作息习惯。
4. **社交关系**：用户与哪些群成员互动最频繁？（根据'@'记录）
以下是用户【${senderNickname}】的发言记录：
${rawChatHistory}`;

    try {
      const queryParts = [{ text: aiPrompt }];
      const Channel = Setting.getConfig("AI").appschannel;
      const result = await getAI(
        Channel,
        e,
        queryParts,
        null,
        false,
        false,
        []
      );

      if (result && result.text) {
        const html = marked(result.text);
        const safeSenderNickname = escapeHtml(String(senderNickname));
        const styledHtml = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 20px; background-color: #f7f7f7; }
                                h1, h2, h3 { color: #333; }
                                ul { padding-left: 20px; }
                                li { margin-bottom: 10px; }
                                strong { color: #0056b3; }
                                .container { max-width: 1200px; margin: auto; background: white; padding: 35px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); font-size: 24px; line-height: 1.6; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>用户画像分析报告 - ${safeSenderNickname}</h1>
                                <hr>
                                ${html}
                            </div>
                        </body>
                        </html>`;

        let browser;
        try {
          browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          });
          const page = await browser.newPage();
          await page.setContent(styledHtml, { waitUntil: "networkidle0" });
          const imageBuffer = await page.screenshot({ fullPage: true });

          await e.reply(segment.image(imageBuffer));
        } finally {
          if (browser) {
            await browser.close().catch((err) => {
              logger.warn("关闭画像渲染浏览器失败:", err);
            });
          }
        }
      } else {
        await e.reply("画像分析失败，未能获取到有效的返回结果。", 10, true);
      }
    } catch (error) {
      logger.error("调用画像分析或生成消息时出错:", error);
      await e.reply(
        "画像分析或消息生成过程中出现错误，请稍后再试。",
        10,
        true
      );
    }

    return true;
  });
}

async function getUserTextHistory(e, userId, num) {
  try {
    const userChats = [];
    const seenMessages = new Set();
    const targetUserId = String(userId);
    let seq = getMessageSeq(e) || 0;
    let previousSeq = null;
    let totalScanned = 0;
    let retriedFromLatest = false;

    while (userChats.length < num && totalScanned < MAX_SCAN_LIMIT) {
      const { messages: chatHistory, nextSeq } = await getHistoryPage(
        e,
        seq,
        HISTORY_PAGE_SIZE
      );

      if (chatHistory.length === 0) {
        if (seq && !retriedFromLatest) {
          seq = 0;
          previousSeq = null;
          retriedFromLatest = true;
          continue;
        }
        break;
      }

      totalScanned += chatHistory.length;

      const filteredChats = chatHistory.filter((chat) => {
        const messageSeq = getMessageSeq(chat);
        const messageKey =
          messageSeq || `${chat.time || 0}:${chat.raw_message || ""}`;
        if (seenMessages.has(String(messageKey))) return false;
        seenMessages.add(String(messageKey));

        const senderId = chat.sender?.user_id ?? chat.user_id;
        if (String(senderId) !== targetUserId) return false;
        if (!Array.isArray(chat.message) || chat.message.length === 0) {
          return false;
        }

        const plainText = getPlainText(chat.message).trim();
        if (!plainText || plainText === "#画像") return false;

        const hasTextOrAt = chat.message.some(
          (msgPart) => msgPart?.type === "text" || msgPart?.type === "at"
        );

        return hasTextOrAt;
      });

      if (filteredChats.length > 0) {
        userChats.push(...filteredChats);
      }

      const fallbackNextSeq = getMessageSeq(chatHistory[0]);
      const nextMessageSeq = nextSeq || fallbackNextSeq;
      if (
        !nextMessageSeq ||
        String(nextMessageSeq) === String(seq) ||
        String(nextMessageSeq) === String(previousSeq)
      ) {
        break;
      }

      previousSeq = seq;
      seq = nextMessageSeq;
    }

    userChats.sort((a, b) => {
      const seqA = Number(getMessageSeq(a) || 0);
      const seqB = Number(getMessageSeq(b) || 0);
      if (seqA !== seqB) return seqA - seqB;
      return Number(a.time || 0) - Number(b.time || 0);
    });

    return userChats.slice(-num);
  } catch (err) {
    logger.error("获取用户聊天记录时出错:", err);
    return [];
  }
}

async function getHistoryPage(e, messageSeq, count) {
  if (e.group?.getMsgHistory) {
    const res = await e.group.getMsgHistory(messageSeq || undefined, count);
    return {
      messages: normalizeHistoryMessages(res),
      nextSeq: res?.next_message_seq,
    };
  }

  const res = await e.getMsgHistory(count, messageSeq || null);
  return {
    messages: normalizeHistoryMessages(res),
    nextSeq: res?.next_message_seq,
  };
}

function normalizeHistoryMessages(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.messages)) return res.messages;
  return [];
}

function getMessageSeq(message) {
  return message?.seq || message?.message_seq || message?.message_id;
}

function getSegmentData(part) {
  if (part?.data && typeof part.data === "object") return part.data;
  return part || {};
}

function getPlainText(message = []) {
  return message
    .map((part) => {
      const data = getSegmentData(part);
      if (part?.type === "text") return data.text || "";
      if (part?.type === "at") return `@${data.qq ?? data.user_id ?? ""}`;
      return "";
    })
    .join("");
}

async function formatMessagePart(e, part) {
  const data = getSegmentData(part);

  if (part?.type === "text") {
    return data.text || "";
  }

  if (part?.type === "at") {
    const qq = data.qq ?? data.user_id;
    if (qq === "all" || qq === 0 || qq === "0") {
      return "@全体成员";
    }

    if (!qq) return "";

    try {
      const info = await e.getInfo(qq);
      const atNickname = info?.card || info?.nickname || qq;
      return `@${atNickname}`;
    } catch (err) {
      logger.error(`获取用户 ${qq} 的信息失败:`, err);
      return `@${qq}`;
    }
  }

  return "";
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
