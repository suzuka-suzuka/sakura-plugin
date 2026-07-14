import { getAI } from "../lib/AIUtils/getAI.js";
import { marked } from "marked";
import puppeteer from "puppeteer";

import Setting from "../lib/setting.js";
import { getUserGroupTextMessages } from "../lib/AIUtils/groupMessageStore.js";
import {
  buildGroupMemberNameMap,
  buildGroupMessageRecordMap,
  replaceGroupMemberReferences,
  resolveGroupMemberNameMap,
} from "../lib/AIUtils/groupMemberNames.js";

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

    let memberNames = buildGroupMemberNameMap(messages);
    try {
      memberNames = await resolveGroupMemberNameMap(e, messages);
    } catch (error) {
      logger.warn(`画像获取群名片失败，使用历史昵称: ${error.message}`);
    }
    const messageRecords = buildGroupMessageRecordMap(messages);
    const formattedLines = messages.map((message) => {
      const time = new Date((message.time || 0) * 1000).toLocaleString(
        "zh-CN",
        {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      );
      const content = replaceGroupMemberReferences(
        message.textContent,
        message,
        { memberNames, messageRecords }
      );
      return `[${time}] ${content}`;
    });

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
提及群成员时请使用发言记录中提供的群名片，不要输出 QQ 号。
以下是用户【${senderNickname}】的发言记录：
${rawChatHistory}`;

    try {
      const queryParts = [{ text: aiPrompt }];
      const route = Setting.getConfig("AI").appsRoute;
      const result = await getAI(
        route,
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
    return await getUserGroupTextMessages({
      selfId: e.self_id,
      groupId: e.group_id,
      userId,
      limit: num,
      excludeMessageId: e.message_id ?? e.message_seq,
      excludedTexts: ["#画像"],
    });
  } catch (err) {
    logger.error("从 Redis 获取用户聊天记录时出错:", err);
    return [];
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
