import Setting from "../lib/setting.js";
import fs from "fs";
import path from "path";
import _ from "lodash";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import muhammara from "muhammara";
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
      const innerContent = [{
        type: 'markdown',
        data: {
          content: item.parts[0].text
        }
      }];
      
      if (item.role === "user") {
        return {
          user_id: e.user_id,
          nickname: userName,
          content: [{
            type: 'node',
            data: {
              user_id: e.user_id,
              nickname: userName,
              content: innerContent
            }
          }],
        };
      } else if (item.role === "model") {
        return {
          user_id: e.self_id,
          nickname: botName,
          content: [{
            type: 'node',
            data: {
              user_id: e.self_id,
              nickname: botName,
              content: innerContent
            }
          }],
        };
      }
      return null;
    };

    const buildSimpleNode = (item) => {
      if (item.role === "user") {
        return {
          user_id: e.user_id,
          nickname: userName,
          content: [{ type: 'text', data: { text: item.parts[0].text } }],
        };
      } else if (item.role === "model") {
        return {
          user_id: e.self_id,
          nickname: botName,
          content: [{ type: 'text', data: { text: item.parts[0].text } }],
        };
      }
      return null;
    };

    const CHUNK_SIZE = 40;

    const sendAsEncryptedPdf = async () => {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkit);

      let font;
      const fontPaths = [
        "/usr/share/fonts/NotoSansSC-Regular.ttf",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "/usr/share/fonts/NotoSerifSC-Regular.otf",
      ];

      try {
        const signFontPath = path.join(pluginresources, "sign", "font");
        if (fs.existsSync(signFontPath)) {
          const fontFiles = fs.readdirSync(signFontPath).filter(f => f.endsWith(".ttf") || f.endsWith(".otf"));
          fontFiles.forEach(f => fontPaths.push(path.join(signFontPath, f)));
        }
      } catch {}

      for (const fontPath of fontPaths) {
        try {
          if (fs.existsSync(fontPath)) {
            const fontBytes = fs.readFileSync(fontPath);
            font = await pdfDoc.embedFont(fontBytes, { subset: true });
            break;
          }
        } catch {
          continue;
        }
      }

      if (!font) {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      }

      const fontSize = 14;
      const lineHeight = fontSize * 1.5;
      const margin = 50;
      const pageWidth = 595;
      const pageHeight = 842;
      const maxWidth = pageWidth - margin * 2;

      const wrapText = (text, maxW) => {
        const lines = [];
        const paragraphs = text.split("\n");
        for (const para of paragraphs) {
          if (!para) {
            lines.push("");
            continue;
          }
          let current = "";
          for (const char of para) {
            const testLine = current + char;
            const width = font.widthOfTextAtSize(testLine, fontSize);
            if (width > maxW && current) {
              lines.push(current);
              current = char;
            } else {
              current = testLine;
            }
          }
          if (current) lines.push(current);
        }
        return lines;
      };

      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const title = `「${profileName}」对话历史记录`;
      page.drawText(title, { x: margin, y, size: 16, font, color: rgb(0, 0, 0) });
      y -= 25;
      page.drawText(`导出时间: ${new Date().toLocaleString()}`, { x: margin, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 15;
      page.drawText(`共 ${Math.ceil(history.length / 2)} 轮对话`, { x: margin, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 30;

      for (const item of history) {
        const role = item.role === "user" ? userName : botName;
        const roleColor = item.role === "user" ? rgb(0, 0.5, 0) : rgb(0, 0, 0.7);
        const text = item.parts[0].text || "";

        if (y < margin + lineHeight * 2) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(`【${role}】`, { x: margin, y, size: fontSize, font, color: roleColor });
        y -= lineHeight;

        const lines = wrapText(text, maxWidth);
        for (const line of lines) {
          if (y < margin) {
            page = pdfDoc.addPage([pageWidth, pageHeight]);
            y = pageHeight - margin;
          }
          if (line) {
            page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
          }
          y -= lineHeight;
        }
        y -= lineHeight * 0.5;
      }

      const pdfBytes = await pdfDoc.save();

      const tempDir = path.join(process.cwd(), "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempUnencryptedPath = path.join(tempDir, `temp_unencrypted_${Date.now()}.pdf`);
      const fileName = `对话记录_${profileName}_${Date.now()}.pdf`;
      const filePath = path.join(tempDir, fileName);

      fs.writeFileSync(tempUnencryptedPath, pdfBytes);

      const pdfPassword = "1135";
      try {
        muhammara.recrypt(
          tempUnencryptedPath,
          filePath,
          {
            userPassword: pdfPassword,
            ownerPassword: pdfPassword,
            userProtectionFlag: 4
          }
        );
        if (fs.existsSync(tempUnencryptedPath)) {
          fs.unlinkSync(tempUnencryptedPath);
        }
      } catch (encryptError) {
        logger.error("PDF 加密失败，将使用未加密版本:", encryptError);
        fs.renameSync(tempUnencryptedPath, filePath);
      }

      try {
        if (e.group_id) {
          await e.group.uploadFile(filePath, fileName);
          await e.reply(`转发消息发送失败，已将对话记录上传为PDF群文件：${fileName}\nPDF密码：1135`, 10);
        } else {
          await e.reply(`转发消息发送失败，私聊暂不支持上传文件，请在群聊中使用此功能。`, 10);
        }
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    };

    if (history.length <= CHUNK_SIZE) {
      const nodes = [];
      for (const item of history) {
        const node = buildSimpleNode(item);
        if (node) nodes.push(node);
      }

      const result = await e.sendForwardMsg(nodes, {
        source: `「${profileName}」对话历史`,
        prompt: "查看对话详情",
      });

      if (!result || !result.message_id) {
        await sendAsEncryptedPdf();
      }
    } else {
      const chunks = _.chunk(history, CHUNK_SIZE);
      const outerNodes = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const innerNodes = [];

        for (const item of chunk) {
          const node = buildSimpleNode(item);
          if (node) innerNodes.push(node);
        }

        const startRound = Math.floor((i * CHUNK_SIZE) / 2) + 1;
        const endRound = Math.floor(((i + 1) * CHUNK_SIZE - 1) / 2) + 1;
        const actualEndRound = Math.min(endRound, Math.ceil(history.length / 2));

        outerNodes.push({
          user_id: e.self_id,
          nickname: `第 ${startRound}-${actualEndRound} 轮对话`,
          content: innerNodes.map((n) => ({
            type: "node",
            data: {
              user_id: n.user_id,
              nickname: n.nickname,
              content: n.content,
            },
          })),
        });
      }

      const result = await e.sendForwardMsg(outerNodes, {
        source: `「${profileName}」对话历史`,
        prompt: `共 ${Math.ceil(history.length / 2)} 轮对话`,
        summary: `共 ${chunks.length} 个分组`,
      });

      if (!result || !result.message_id) {
        await sendAsEncryptedPdf();
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
}
