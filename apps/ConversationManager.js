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

    const info = await e.getInfo(e.self_id);
    const botName = info?.card || info?.nickname || e.self_id;
    const userName = e.sender.card || e.sender.nickname || e.user_id;

    const buildNode = (item) => {
      if (item.role === "user") {
        return {
          user_id: e.user_id,
          nickname: userName,
          content: `${item.parts[0].text}`,
        };
      } else if (item.role === "model") {
        return {
          user_id: e.self_id,
          nickname: botName,
          content: `${item.parts[0].text}`,
        };
      }
      return null;
    };

    const CHUNK_SIZE = 40;

    // 生成 txt 内容并上传群文件的辅助函数
    const sendAsTxtFile = async () => {
      let txtContent = `「${profileName}」对话历史记录\n`;
      txtContent += `导出时间: ${new Date().toLocaleString()}\n`;
      txtContent += `共 ${Math.ceil(history.length / 2)} 轮对话\n`;
      txtContent += "=".repeat(50) + "\n\n";

      for (let i = 0; i < history.length; i++) {
        const item = history[i];
        const role = item.role === "user" ? userName : botName;
        txtContent += `【${role}】\n${item.parts[0].text}\n\n`;
      }

      const fileName = `对话记录_${profileName}_${Date.now()}.txt`;
      const filePath = path.join(process.cwd(), "temp", fileName);
      
      // 确保 temp 目录存在
      const tempDir = path.join(process.cwd(), "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, txtContent, "utf-8");

      try {
        if (e.group_id) {
          await e.group.uploadFile(filePath, fileName);
          await e.reply(`转发消息发送失败，已将对话记录上传为群文件：${fileName}`, 10);
        } else {
          await e.reply(`转发消息发送失败，私聊暂不支持上传文件，请在群聊中使用此功能。`, 10);
        }
      } finally {
        // 清理临时文件
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    };

    if (history.length <= CHUNK_SIZE) {
      const nodes = [];
      for (const item of history) {
        const node = buildNode(item);
        if (node) nodes.push(node);
      }

      const result = await e.sendForwardMsg(nodes, {
        source: `「${profileName}」对话历史`,
        prompt: "查看对话详情",
      });

      if (!result || !result.message_id) {
        await sendAsTxtFile();
      }
    } else {
      const chunks = _.chunk(history, CHUNK_SIZE);
      const outerNodes = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const innerNodes = [];

        for (const item of chunk) {
          const node = buildNode(item);
          if (node) innerNodes.push(node);
        }

        const startRound = Math.floor((i * CHUNK_SIZE) / 2) + 1;
        const endRound = Math.floor(((i + 1) * CHUNK_SIZE - 1) / 2) + 1;
        const actualEndRound = Math.min(endRound, Math.ceil(history.length / 2));

        outerNodes.push({
          user_id: e.self_id,
          nickname: botName,
          content: innerNodes.map((n) => ({
            type: "node",
            data: {
              user_id: n.user_id,
              nickname: n.nickname,
              content: [{ type: "text", data: { text: n.content } }],
            },
          })),
          prompt: `第 ${startRound}-${actualEndRound} 轮对话`,
        });
      }

      const result = await e.sendForwardMsg(outerNodes, {
        source: `「${profileName}」对话历史`,
        prompt: `共 ${Math.ceil(history.length / 2)} 轮对话`,
        summary: `共 ${chunks.length} 个分组`,
      });

      if (!result || !result.message_id) {
        await sendAsTxtFile();
      }
    }

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

      const CHUNK_SIZE = 10; // 每10条消息（5轮对话）一张图片

      const generateMessagesHtml = (historyChunk) => {
        let messagesHtml = "";
        for (const item of historyChunk) {
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
        return messagesHtml;
      };

      const generateImage = async (browser, messagesHtml, title) => {
        const finalHtml = templateHtml
          .replace(/{{title}}/g, title)
          .replace(/{{messages}}/g, messagesHtml)
          .replace(/{{left_bubble_base64}}/g, leftBubbleBase64)
          .replace(/{{right_bubble_base64}}/g, rightBubbleBase64)
          .replace(/{{background_image_base64}}/g, backgroundImageBase64);

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
        await page.close();
        return imageBuffer;
      };

      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      if (history.length <= CHUNK_SIZE) {
        const messagesHtml = generateMessagesHtml(history);
        const imageBuffer = await generateImage(
          browser,
          messagesHtml,
          `与「${profileName}」的对话记录`
        );
        await browser.close();

        if (imageBuffer) {
          await e.reply(segment.image(imageBuffer));
        } else {
          await e.reply("对话记录图片生成失败。", 10, true);
        }
      } else {
        const chunks = _.chunk(history, CHUNK_SIZE);
        const imageNodes = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const startRound = Math.floor((i * CHUNK_SIZE) / 2) + 1;
          const endRound = Math.min(
            Math.floor(((i + 1) * CHUNK_SIZE - 1) / 2) + 1,
            Math.ceil(history.length / 2)
          );

          const title = `与「${profileName}」的对话记录 (第 ${startRound}-${endRound} 轮)`;
          const messagesHtml = generateMessagesHtml(chunk);
          const imageBuffer = await generateImage(browser, messagesHtml, title);

          if (imageBuffer) {
            imageNodes.push({
              user_id: e.self_id,
              nickname: bot.name,
              content: segment.image(imageBuffer),
            });
          }
        }

        await browser.close();

        if (imageNodes.length > 0) {
          // 测试：先直接发送第一张图片
          await e.reply(segment.image(imageNodes[0].content.data.file));
          await e.reply("上面是直接发送的图片，下面是转发消息：");
          
          // 再发送转发消息
          await e.sendForwardMsg(imageNodes, {
            source: `「${profileName}」对话记录`,
            prompt: `共 ${Math.ceil(history.length / 2)} 轮对话`,
            summary: `共 ${imageNodes.length} 张图片`,
          });
        } else {
          await e.reply("对话记录图片生成失败。", 10, true);
        }
      }
    } catch (error) {
      logger.error("导出对话失败:", error);
      await e.reply("导出对话时遇到错误，请查看后台日志。", 10, true);
    }

    return true;
  });
}
