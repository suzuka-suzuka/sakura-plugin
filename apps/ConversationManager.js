import Setting from "../lib/setting.js";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import _ from "lodash";
import { pluginresources } from "../lib/path.js";
import {
  loadConversationHistory,
  clearConversationHistory,
  clearAllPrefixesForUser,
  clearAllConversationHistories,
} from "../lib/AIUtils/ConversationHistory.js";
export class Conversationmanagement extends plugin {
  constructor() {
    super({
      name: "对话管理",
      event: "message",
      priority: 1135,
    });
  }

  get appconfig() {
    return Setting.getConfig("AI");
  }

  getProfileName(prefix) {
    const config = this.appconfig;
    if (!config || !config.profiles) return prefix;
    const profile = config.profiles.find((p) => p.prefix === prefix);
    return profile ? profile.name : prefix;
  }

  ClearSingle = Command(/^#?清空对话\s*(.+)/, async (e) => {
    const prefix = e.match[1].trim();

    if (!prefix) {
      return false;
    }

    const config = this.appconfig;

    if (!config || !config.profiles.some((p) => p.prefix === prefix)) {
      await e.reply(`未找到前缀为「${prefix}」的设定，请检查输入。`, 10);
      return true;
    }

    const profileName = this.getProfileName(prefix);
    await clearConversationHistory(e, prefix);
    await e.reply(`您与「${profileName}」的对话历史已清空！喵~`, 10);
    return true;
  });

  ListSingle = Command(/^#?列出对话\s*(.+)/, async (e) => {
    const prefix = e.match[1].trim();

    if (!prefix) {
      return false;
    }

    const config = this.appconfig;

    if (!config || !config.profiles.some((p) => p.prefix === prefix)) {
      await e.reply(`未找到前缀为「${prefix}」的设定，请检查输入。`, 10);
      return true;
    }

    const profileName = this.getProfileName(prefix);
    const history = await loadConversationHistory(e, prefix);
    if (history.length === 0) {
      await e.reply(`目前没有与「${profileName}」的对话历史记录。`, 10);
      return true;
    }

    const nodes = [];
    for (const item of history) {
      if (item.role === "user") {
        nodes.push({
          user_id: e.user_id,
          nickname: e.sender.card || e.sender.nickname || e.user_id,
          content: `${item.parts[0].text}`,
        });
      } else if (item.role === "model") {
        const info = await e.getInfo(e.self_id);
        const name = info?.card || info?.nickname || e.self_id;
        nodes.push({
          user_id: e.self_id,
          nickname: name,
          content: `${item.parts[0].text}`,
        });
      }
    }

    await e.sendForwardMsg(nodes, {
      source: `「${profileName}」对话历史`,
      prompt: "查看对话详情",
    });

    return true;
  });

  ClearAllPrefixes = Command(/^#?清空全部对话$/, async (e) => {
    await clearAllPrefixesForUser(e);
    await e.reply("您的所有模式对话历史已全部清空！喵~", 10);
    return true;
  });

  ClearAllUsers = Command(/^#?清空所有用户对话$/, "master", async (e) => {
    await clearAllConversationHistories();
    await e.reply("所有用户的全部对话历史已成功清空！喵~", 10);
    return true;
  });

  ExportConversation = Command(/^#?导出对话\s*(.+)/, async (e) => {
    const prefix = e.match[1].trim();

    if (!prefix) {
      return false;
    }

    const config = this.appconfig;

    if (!config || !config.profiles.some((p) => p.prefix === prefix)) {
      await e.reply(`未找到前缀为「${prefix}」的设定，请检查输入。`, 10);
      return true;
    }

    const profileName = this.getProfileName(prefix);
    const history = await loadConversationHistory(e, prefix);

    if (history.length === 0) {
      await e.reply(
        `目前没有与「${profileName}」的对话历史记录，无法导出。`,
        10
      );
      return true;
    }

    await e.react(124);

    try {
      let leftBubbleBase64, rightBubbleBase64;
      try {
        const leftBubblePath = path.join(
          pluginresources,
          "AI",
          "left_bubble.png"
        );
        const rightBubblePath = path.join(
          pluginresources,
          "AI",
          "right_bubble.png"
        );

        const leftBubbleBuffer = fs.readFileSync(leftBubblePath);
        const rightBubbleBuffer = fs.readFileSync(rightBubblePath);

        leftBubbleBase64 = `data:image/png;base64,${leftBubbleBuffer.toString(
          "base64"
        )}`;
        rightBubbleBase64 = `data:image/png;base64,${rightBubbleBuffer.toString(
          "base64"
        )}`;
      } catch (fileError) {
        logger.error("读取气泡图片失败! ", fileError);
      }

      let backgroundImageBase64 = "";
      try {
        const backgroundImagePath = path.join(
          pluginresources,
          "background",
          "sakura.jpg"
        );
        const imageBuffer = await fs.promises.readFile(backgroundImagePath);
        backgroundImageBase64 = `data:image/jpeg;base64,${imageBuffer.toString(
          "base64"
        )}`;
      } catch (err) {
        logger.error("读取背景图片失败:", err);
      }

      const user = {
        name: e.sender.card || e.sender.nickname || e.user_id,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`,
      };

      const info = await e.getInfo(e.self_id);
      const name = info?.card || info?.nickname || e.self_id;
      const bot = {
        name: name,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${e.self_id}&s=640`,
      };

      const templatePath = path.join(
        pluginresources,
        "AI",
        "chat_history.html"
      );
      const templateHtml = fs.readFileSync(templatePath, "utf8");

      let messagesHtml = "";
      for (const item of history) {
        const textContent = `<pre>${item.parts[0].text
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`;

        if (item.role === "user") {
          messagesHtml += `
            <div class="message-row right">
              <div class="message-content">
                <div class="nickname right-align">${user.name}</div>
                <div class="bubble user-bubble">${textContent}</div>
              </div>
              <img src="${user.avatar}" class="avatar" alt="User Avatar" />
            </div>
          `;
        } else if (item.role === "model") {
          messagesHtml += `
            <div class="message-row left">
              <img src="${bot.avatar}" class="avatar" alt="Bot Avatar" />
              <div class="message-content">
                <div class="nickname">${bot.name}</div>
                <div class="bubble model-bubble">${textContent}</div>
              </div>
            </div>
          `;
        }
      }

      const finalHtml = templateHtml
        .replace(/{{title}}/g, `与「${profileName}」的对话记录`)
        .replace(/{{messages}}/g, messagesHtml)
        .replace(/{{left_bubble_base64}}/g, leftBubbleBase64)
        .replace(/{{right_bubble_base64}}/g, rightBubbleBase64)
        .replace(/{{background_image_base64}}/g, backgroundImageBase64);

      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
      await page.setContent(finalHtml, { waitUntil: "networkidle0" });

      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.setViewport({
        width: 800,
        height: bodyHeight || 600,
        deviceScaleFactor: 2,
      });

      const imageBuffer = await page.screenshot({ fullPage: true });
      await browser.close();

      if (imageBuffer) {
        await e.reply(segment.image(imageBuffer));
      } else {
        await e.reply("对话记录图片生成失败。", 10, true);
      }
    } catch (error) {
      logger.error("导出对话失败:", error);
      await e.reply("导出对话时遇到错误，请查看后台日志。", 10, true);
    }

    return true;
  });
}
