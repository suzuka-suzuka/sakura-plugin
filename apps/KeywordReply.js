import { plugindata } from "../lib/path.js";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ADD_KEYWORD_COMMAND = "添加词条";
const DELETE_KEYWORD_COMMAND = "删除词条";

export class KeywordReply extends plugin {
  constructor() {
    super({
      name: "关键词回复",
      dsc: "引用消息添加关键词触发回复",
      event: "message.group",
      priority: 1136,
    });

    this.dataDir = path.join(plugindata, "KeywordReply");
  }

  getGroupDataPath(groupId) {
    return path.join(this.dataDir, `${groupId}.json`);
  }

  getGroupImageDir(groupId) {
    return path.join(this.dataDir, `${groupId}_images`);
  }

  async loadGroupData(groupId) {
    const filePath = this.getGroupDataPath(groupId);
    try {
      await fsp.access(filePath);
      const data = await fsp.readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  }

  async saveGroupData(groupId, data) {
    await fsp.mkdir(this.dataDir, { recursive: true });
    const filePath = this.getGroupDataPath(groupId);
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async downloadImage(url, groupId) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.warn(`下载图片失败: ${response.status}`);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const hash = crypto.createHash("md5").update(buffer).digest("hex");

      const contentType = response.headers.get("content-type") || "image/png";
      let ext = "png";
      if (contentType.includes("gif")) ext = "gif";
      else if (contentType.includes("jpeg") || contentType.includes("jpg"))
        ext = "jpg";
      else if (contentType.includes("webp")) ext = "webp";

      const imageDir = this.getGroupImageDir(groupId);
      await fsp.mkdir(imageDir, { recursive: true });

      const fileName = `${hash}.${ext}`;
      const filePath = path.join(imageDir, fileName);

      await fsp.writeFile(filePath, buffer);
      return fileName;
    } catch (error) {
      logger.error(`下载图片失败: ${error.message}`);
      return null;
    }
  }

  async parseMessageContent(message, groupId) {
    const content = {
      segments: [],
    };

    for (const seg of message) {
      if (seg.type === "text" && seg.data?.text) {
        const text = seg.data.text.trim();
        if (text) {
          content.segments.push({
            type: "text",
            data: text,
          });
        }
      } else if (seg.type === "image" && seg.data?.url) {
        const savedFileName = await this.downloadImage(seg.data.url, groupId);
        if (savedFileName) {
          content.segments.push({
            type: "image",
            data: savedFileName,
          });
        }
      } else if (seg.type === "at" && seg.data?.qq) {
        content.segments.push({
          type: "at",
          data: seg.data.qq,
        });
      }
    }

    return content;
  }

  async deleteContentImages(content, groupId) {
    if (!content?.segments) return;

    for (const seg of content.segments) {
      if (seg.type === "image") {
        const imagePath = path.join(this.getGroupImageDir(groupId), seg.data);
        try {
          await fsp.unlink(imagePath);
        } catch (err) { }
      }
    }
  }

  async deleteAllRepliesImages(keywordData, groupId) {
    if (!keywordData?.replies) return;

    for (const reply of keywordData.replies) {
      await this.deleteContentImages(reply, groupId);
    }
  }

  parseKeyword(e, commandName = ADD_KEYWORD_COMMAND) {
    const keywordParts = [];
    let foundCommand = false;
    const commandPrefixes = [`#${commandName}`, commandName];

    for (const seg of e.message) {
      if (seg.type === "reply") continue;

      if (seg.type === "at" && seg.data?.qq) {
        keywordParts.push({ type: "at", data: String(seg.data.qq) });
      } else if (seg.type === "text" && seg.data?.text) {
        let text = seg.data.text.trim();

        if (!foundCommand) {
          const commandPrefix = commandPrefixes.find((prefix) =>
            text.startsWith(prefix)
          );
          if (commandPrefix) {
            text = text.substring(commandPrefix.length).trim();
            foundCommand = true;
          }
        }

        if (text) {
          keywordParts.push({ type: "text", data: text });
        }
      }
    }

    const keywordKey = keywordParts.map((p) => `${p.type}:${p.data}`).join("|");

    return { keywordParts, keywordKey };
  }

  parseMessageForMatch(e) {
    const parts = [];

    for (const seg of e.message) {
      if (seg.type === "reply") continue;

      if (seg.type === "at" && seg.data?.qq) {
        parts.push({ type: "at", data: String(seg.data.qq) });
      } else if (seg.type === "text" && seg.data?.text) {
        const text = seg.data.text.trim();
        if (text) {
          parts.push({ type: "text", data: text });
        }
      }
    }

    const partsKey = parts.map((p) => `${p.type}:${p.data}`).join("|");

    return { parts, partsKey };
  }

  formatKeywordDisplay(keywordParts) {
    return keywordParts
      .map((p) => {
        if (p.type === "at") return `@${p.data}`;
        return p.data;
      })
      .join(" ");
  }

  normalizeKeywordDisplay(keywordParts) {
    return this.formatKeywordDisplay(keywordParts)
      .replace(/\s+/g, " ")
      .trim();
  }

  findKeywordKey(groupData, keywordParts, keywordKey) {
    if (groupData[keywordKey]) return keywordKey;

    // 兼容历史数据：纯文本“@QQ”和真正的 at 消息段在列表中的显示相同，
    // 但序列化后的 key 不同。直接 key 未命中时，按列表显示内容再匹配一次。
    const targetDisplay = this.normalizeKeywordDisplay(keywordParts);
    if (!targetDisplay) return null;

    return Object.keys(groupData).find((key) => {
      const storedParts = groupData[key]?.keywordParts;
      return (
        Array.isArray(storedParts) &&
        this.normalizeKeywordDisplay(storedParts) === targetDisplay
      );
    }) || null;
  }

  添加词条 = Command(/^#?添加词条/, async (e) => {
    if (!e.group_id) return false;
    if (!e.reply_id) {
      return false;
    }

    const { keywordParts, keywordKey } = this.parseKeyword(e);

    if (keywordParts.length === 0 || !keywordKey) {
      return false;
    }

    const replyMsg = await e.getReplyMsg();
    if (!replyMsg || !replyMsg.message) {
      return false;
    }

    const content = await this.parseMessageContent(
      replyMsg.message,
      e.group_id
    );

    if (content.segments.length === 0) {
      return false;
    }

    const groupData = await this.loadGroupData(e.group_id);

    const newReply = {
      segments: content.segments,
      addedBy: e.user_id,
      addedAt: Date.now(),
    };

    if (groupData[keywordKey]) {
      groupData[keywordKey].replies.push(newReply);
    } else {
      groupData[keywordKey] = {
        keywordParts,
        replies: [newReply],
      };
    }

    await this.saveGroupData(e.group_id, groupData);

    const hasText = content.segments.some((s) => s.type === "text");
    const hasImage = content.segments.some((s) => s.type === "image");
    const hasAt = content.segments.some((s) => s.type === "at");
    const typeDesc = [
      hasText ? "文字" : "",
      hasImage ? "图片" : "",
      hasAt ? "艾特" : "",
    ]
      .filter(Boolean)
      .join("+");

    const keywordDesc = this.formatKeywordDisplay(keywordParts);
    const replyCount = groupData[keywordKey].replies.length;
    const countInfo = replyCount > 1 ? `，当前共${replyCount}条回复` : "";
    await e.reply(
      `已添加词条「${keywordDesc}」（${typeDesc}）${countInfo}~`,
      true
    );
    return true;
  });

  删除词条 = Command(/^#?删除词条/, async (e) => {
    if (!e.group_id) return false;

    const { keywordParts, keywordKey } = this.parseKeyword(
      e,
      DELETE_KEYWORD_COMMAND
    );

    if (!keywordKey) {
      return false;
    }

    const groupData = await this.loadGroupData(e.group_id);

    const matchedKey = this.findKeywordKey(groupData, keywordParts, keywordKey);

    if (!matchedKey) {
      const keywordDesc = this.formatKeywordDisplay(keywordParts);
      await e.reply(`词条「${keywordDesc}」不存在`, 10, true);
      return true;
    }

    await this.deleteAllRepliesImages(groupData[matchedKey], e.group_id);

    delete groupData[matchedKey];
    await this.saveGroupData(e.group_id, groupData);

    const keywordDesc = this.formatKeywordDisplay(keywordParts);
    await e.reply(`已删除词条「${keywordDesc}」`, 10, true);
    return true;
  });

  词条列表 = Command(/^#?词条列表$/, async (e) => {
    if (!e.group_id) return false;

    const groupData = await this.loadGroupData(e.group_id);
    const keywordKeys = Object.keys(groupData);

    if (keywordKeys.length === 0) {
      return false;
    }

    const PAGE_SIZE = 20;
    const forwardMsgs = [];

    for (let i = 0; i < keywordKeys.length; i += PAGE_SIZE) {
      const pageItems = keywordKeys.slice(i, i + PAGE_SIZE);
      const pageNum = Math.floor(i / PAGE_SIZE) + 1;
      const totalPages = Math.ceil(keywordKeys.length / PAGE_SIZE);

      let content = `📝 词条列表 (${pageNum}/${totalPages})\n\n`;
      pageItems.forEach((key, idx) => {
        const item = groupData[key];
        const keywordDisplay = this.formatKeywordDisplay(
          item.keywordParts || []
        );
        const replyCount = item.replies?.length || 1;
        const countInfo = replyCount > 1 ? ` (${replyCount}条回复)` : "";
        content += `${i + idx + 1}. ${keywordDisplay}${countInfo}\n`;
      });

      forwardMsgs.push(content.trim());
    }

    await e.sendForwardMsg(forwardMsgs, {
      prompt: `词条列表 (${keywordKeys.length}条)`,
      news: [{ text: `共 ${keywordKeys.length} 条词条` }],
    });
    return true;
  });

  关键词触发 = OnEvent("message.group", async (e) => {
    if (!e.group_id) return false;

    const groupData = await this.loadGroupData(e.group_id);
    const keywordKeys = Object.keys(groupData);

    if (keywordKeys.length === 0) return false;

    const { partsKey } = this.parseMessageForMatch(e);

    if (!partsKey) return false;

    let matchedKey = null;
    if (groupData[partsKey]) {
      matchedKey = partsKey;
    }

    if (!matchedKey) return false;

    const keywordData = groupData[matchedKey];

    if (!keywordData.replies || keywordData.replies.length === 0) {
      return false;
    }

    const randomIndex = Math.floor(Math.random() * keywordData.replies.length);
    const replyData = keywordData.replies[randomIndex];

    const messageSegments = [];
    let hasValidContent = true;

    for (const seg of replyData.segments) {
      if (seg.type === "text") {
        messageSegments.push(segment.text(seg.data));
      } else if (seg.type === "image") {
        const imagePath = path.join(
          this.getGroupImageDir(e.group_id),
          seg.data
        );
        try {
          await fsp.access(imagePath);
          messageSegments.push(segment.image(imagePath));
        } catch (err) {
          hasValidContent = false;
          logger.warn(`关键词「${matchedKeyword}」的图片 ${seg.data} 不存在`);
        }
      } else if (seg.type === "at") {
        messageSegments.push(segment.at(seg.data));
      }
    }

    if (messageSegments.length > 0) {
      await e.reply(messageSegments);
    }

    if (!hasValidContent) {
      replyData.segments = replyData.segments.filter((seg) => {
        if (seg.type !== "image") return true;
        const imagePath = path.join(
          this.getGroupImageDir(e.group_id),
          seg.data
        );
        try {
          fs.accessSync(imagePath);
          return true;
        } catch {
          return false;
        }
      });

      if (replyData.segments.length === 0) {
        keywordData.replies = keywordData.replies.filter(
          (r) => r !== replyData
        );
        if (keywordData.replies.length === 0) {
          delete groupData[matchedKey];
          logger.warn(`关键词「${matchedKey}」内容已全部失效，已自动删除`);
        }
      }
      await this.saveGroupData(e.group_id, groupData);
    }

    return false;
  });
}
