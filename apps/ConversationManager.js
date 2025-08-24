import Setting from '../lib/setting.js';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { pluginresources } from '../lib/path.js'; 
import { loadConversationHistory, clearConversationHistory, clearAllPrefixesForUser, clearAllConversationHistories } from '../lib/AIUtils/ConversationHistory.js';
import { makeForwardMsg } from '../lib/utils.js';

export class Conversationmanagement extends plugin {
  constructor() {
    super({
      name: '对话管理',
      dsc: '管理对话历史',
      event: 'message',
      priority: 1135,
      rule: [
        {
          reg: `^清空对话\\s+(.+)`,
          fnc: 'handleClearSingleConversation',
		  log: false
        },
        {
          reg: `^列出对话\\s+(.+)`,
          fnc: 'handleListSingleConversation',
		  log: false
        },
        {
          reg: `^清空全部对话$`,
          fnc: 'handleClearAllPrefixesForCurrentUser',
		  log: false
        },
        {
          reg: `^清空所有用户对话$`,
          fnc: 'handleClearAllUsersAndPrefixes',
		  log: false,
          permission: 'master'
        },
        {
          reg: `^导出对话\\s+(.+)`,
          fnc: 'handleExportConversation',
		  log: false
        }
      ]
    });
  }

  get appconfig() {
    return Setting.getConfig('AI');
  }

  getProfileName(prefix) {
    const config = this.appconfig;
    if (!config || !config.profiles) return prefix;
    const profile = config.profiles.find(p => p.prefix === prefix);
    return profile ? profile.name : prefix;
  }

  async handleClearSingleConversation(e) {
    const msg = e.msg || '';
    const trigger = '清空对话';
    const prefix = msg.substring(trigger.length).trim();

    if (!prefix) {
      return false
    }

    const config = this.appconfig;

    if (!config || !config.profiles.some(p => p.prefix === prefix)) {
      e.reply(`未找到前缀为「${prefix}」的设定，请检查输入。`, true);
      return true;
    }

    const profileName = this.getProfileName(prefix);
    await clearConversationHistory(e, prefix);
    e.reply(`您与「${profileName}」的对话历史已清空！喵~`, true);
    return true;
  }

  async handleListSingleConversation(e) {
    const msg = e.msg || '';
    const trigger = '列出对话';
    const prefix = msg.substring(trigger.length).trim();

    if (!prefix) {
      e.reply('请提供需要列出的对话前缀哦，例如：列出对话 g', true);
      return true;
    }

    const config = this.appconfig;

    if (!config || !config.profiles.some(p => p.prefix === prefix)) {
      e.reply(`未找到前缀为「${prefix}」的设定，请检查输入。`, true);
      return true;
    }

    const profileName = this.getProfileName(prefix);
    const history = await loadConversationHistory(e, prefix);
    if (history.length === 0) {
      e.reply(`目前没有与「${profileName}」的对话历史记录。`, true);
      return true;
    }

    const messagesWithSender = [];
    for (const item of history) {
      if (item.role === 'user') {
        messagesWithSender.push({
          text: `${item.parts[0].text}`,
          senderId: e.user_id,
          senderName: e.sender.card || e.sender.nickname || e.user_id
        });
      } else if (item.role === 'model') {
        const botUin = e.self_id || e.bot?.uin;
        let name;
        if (e.isGroup) {
          const member = e.bot.pickMember(e.group_id, botUin);
          const info = await member.getInfo();
          name = info?.card || info?.nickname;
        } else {
          name = e.bot.nickname;
        }
        messagesWithSender.push({
          text: `${item.parts[0].text}`,
          senderId: botUin,
          senderName: name
        });
      }
    }

    await makeForwardMsg(e, messagesWithSender, `「${profileName}」对话历史`);
    return true;
  }

  async handleClearAllPrefixesForCurrentUser(e) {
    await clearAllPrefixesForUser(e);
    e.reply('您的所有模式对话历史已全部清空！喵~', true);
    return true;
  }

  async handleClearAllUsersAndPrefixes(e) {
    await clearAllConversationHistories();
    e.reply('所有用户的全部对话历史已成功清空！喵~', true);
    return true;
  }

  async handleExportConversation(e) {
    const msg = e.msg || '';
    const trigger = '导出对话';
    const prefix = msg.substring(trigger.length).trim();

    if (!prefix) {
      e.reply('请提供需要导出的对话前缀哦，例如：导出对话 g', true);
      return true;
    }

    const config = this.appconfig;

    if (!config || !config.profiles.some(p => p.prefix === prefix)) {
      e.reply(`未找到前缀为「${prefix}」的设定，请检查输入。`, true);
      return true;
    }

    const profileName = this.getProfileName(prefix);
    const history = await loadConversationHistory(e, prefix);

    if (history.length === 0) {
      e.reply(`目前没有与「${profileName}」的对话历史记录，无法导出。`, true);
      return true;
    }

    e.reply(`正在为您导出「${profileName}」的对话记录，请稍候...`, true);

    try {
      let leftBubbleBase64, rightBubbleBase64;
      try {
        const leftBubblePath = path.join(pluginresources, 'AI', 'left_bubble.png');
        const rightBubblePath = path.join(pluginresources, 'AI', 'right_bubble.png');

        const leftBubbleBuffer = fs.readFileSync(leftBubblePath);
        const rightBubbleBuffer = fs.readFileSync(rightBubblePath);

        leftBubbleBase64 = `data:image/png;base64,${leftBubbleBuffer.toString('base64')}`;
        rightBubbleBase64 = `data:image/png;base64,${rightBubbleBuffer.toString('base64')}`;
      } catch (fileError) {
        logger.error("读取气泡图片失败! ", fileError);
      }

      let backgroundImageBase64 = '';
      try {
        const backgroundImagePath = path.join(pluginresources, 'AI', 'background.jpg');
        if (fs.existsSync(backgroundImagePath)) {
          const backgroundImageBuffer = fs.readFileSync(backgroundImagePath);
          backgroundImageBase64 = `data:image/jpeg;base64,${backgroundImageBuffer.toString('base64')}`;
        }
      } catch (fileError) {
        logger.warn("读取背景图片失败，将使用默认背景色:", fileError);
      }

      const user = {
        name: e.sender.card || e.sender.nickname || e.user_id,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`
      };

      const botUin = e.self_id || e.bot?.uin;
      let botName = e.bot.nickname;
      if (e.isGroup) {
        try {
          const info = await e.bot.pickMember(e.group_id, botUin).getInfo();
          botName = info?.card || info?.nickname || botName;
        } catch (err) {
          logger.error("获取机器人信息失败:", err);
        }
      }
      const bot = {
        name: botName,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${botUin}&s=640`
      };

      const templatePath = path.join(pluginresources, 'AI', 'chat_history.html');
      const templateHtml = fs.readFileSync(templatePath, 'utf8');

      let messagesHtml = '';
      for (const item of history) {
        const textContent = `<pre>${item.parts[0].text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

        if (item.role === 'user') {
          messagesHtml += `
            <div class="message-row right">
              <div class="message-content">
                <div class="nickname right-align">${user.name}</div>
                <div class="bubble user-bubble">${textContent}</div>
              </div>
              <img src="${user.avatar}" class="avatar" alt="User Avatar" />
            </div>
          `;
        } else if (item.role === 'model') {
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
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
      await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.setViewport({ width: 800, height: bodyHeight || 600, deviceScaleFactor: 2 });

      const imageBuffer = await page.screenshot({ fullPage: true });
      await browser.close();

      if (imageBuffer) {
        await e.reply(segment.image(imageBuffer));
      } else {
        await e.reply('对话记录图片生成失败。', true);
      }

    } catch (error) {
      logger.error('导出对话失败:', error);
      await e.reply('导出对话时遇到错误，请查看后台日志。', true);
    }

    return true;
  }
}