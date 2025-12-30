import { plugindata } from "../lib/path.js";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export class KeywordReply extends plugin {
  constructor() {
    super({
      name: "关键词回复",
      dsc: "引用消息添加关键词触发回复",
      event: "message.group",
      priority: 100,
    });

    // 数据存储目录
    this.dataDir = path.join(plugindata, "KeywordReply");
  }

  /**
   * 获取群数据文件路径
   * @param {number} groupId 群号
   */
  getGroupDataPath(groupId) {
    return path.join(this.dataDir, `${groupId}.json`);
  }

  /**
   * 获取群图片存储目录
   * @param {number} groupId 群号
   */
  getGroupImageDir(groupId) {
    return path.join(this.dataDir, `${groupId}_images`);
  }

  /**
   * 读取群的关键词数据
   * @param {number} groupId 群号
   */
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

  /**
   * 保存群的关键词数据
   * @param {number} groupId 群号
   * @param {object} data 数据
   */
  async saveGroupData(groupId, data) {
    await fsp.mkdir(this.dataDir, { recursive: true });
    const filePath = this.getGroupDataPath(groupId);
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 下载图片到本地
   * @param {string} url 图片URL
   * @param {number} groupId 群号
   */
  async downloadImage(url, groupId) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.warn(`下载图片失败: ${response.status}`);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 使用MD5作为文件名，避免重复
      const hash = crypto.createHash("md5").update(buffer).digest("hex");

      // 获取图片扩展名
      const contentType = response.headers.get("content-type") || "image/png";
      let ext = "png";
      if (contentType.includes("gif")) ext = "gif";
      else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
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

  /**
   * 解析消息内容，提取文字、图片、艾特
   * @param {Array} message 消息数组
   * @param {number} groupId 群号
   * @returns {Promise<object>} 解析后的内容
   */
  async parseMessageContent(message, groupId) {
    const content = {
      segments: [], // 消息段落：{ type: "text"|"image"|"at", data: ... }
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
        // 下载图片
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

  /**
   * 删除内容中的所有图片文件
   * @param {object} content 内容对象
   * @param {number} groupId 群号
   */
  async deleteContentImages(content, groupId) {
    if (!content?.segments) return;
    
    for (const seg of content.segments) {
      if (seg.type === "image") {
        const imagePath = path.join(this.getGroupImageDir(groupId), seg.data);
        try {
          await fsp.unlink(imagePath);
        } catch (err) {
          // 忽略删除失败
        }
      }
    }
  }

  /**
   * 解析关键词（按消息实际顺序，支持艾特+文字任意混合）
   * 例如："笨蛋@张三你好" -> [text:笨蛋, at:123, text:你好]
   * @param {object} e 事件对象
   * @returns {object} { keywordParts: [...], keywordKey: string }
   */
  parseKeyword(e) {
    const keywordParts = [];
    
    // 按消息顺序遍历，提取艾特和文字（跳过 reply，处理 "添加" 前缀）
    let foundAddCommand = false;
    
    for (const seg of e.message) {
      if (seg.type === "reply") continue;
      
      if (seg.type === "at" && seg.data?.qq) {
        keywordParts.push({ type: "at", data: String(seg.data.qq) });
      } else if (seg.type === "text" && seg.data?.text) {
        let text = seg.data.text.trim();
        
        // 处理 "添加" 命令前缀
        if (!foundAddCommand && text.startsWith("添加")) {
          text = text.substring(2).trim();
          foundAddCommand = true;
        }
        
        if (text) {
          keywordParts.push({ type: "text", data: text });
        }
      }
    }
    
    // 生成唯一的 keywordKey
    const keywordKey = keywordParts.map(p => `${p.type}:${p.data}`).join("|");
    
    return { keywordParts, keywordKey };
  }

  /**
   * 解析消息作为触发匹配（按实际顺序提取艾特和文字）
   * @param {object} e 事件对象
   * @returns {object} { parts: [...], partsKey: string }
   */
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
    
    const partsKey = parts.map(p => `${p.type}:${p.data}`).join("|");
    
    return { parts, partsKey };
  }

  /**
   * 格式化关键词显示
   * @param {Array} keywordParts 关键词组成部分
   */
  formatKeywordDisplay(keywordParts) {
    return keywordParts.map(p => {
      if (p.type === "at") return `@${p.data}`;
      return p.data;
    }).join(" ");
  }

  /**
   * 添加关键词 - 引用消息 + "添加xxx" 或 "添加@某人" 或 "添加@某人 xxx"
   */
  添加关键词 = Command(/^添加/, async (e) => {
    if (!e.group_id) return false;
    if (!e.reply_id) {
      await e.reply("请引用一条消息来添加关键词回复", true);
      return true;
    }

    // 解析关键词（支持艾特+文字混合）
    const { keywordParts, keywordKey } = this.parseKeyword(e);
    
    if (keywordParts.length === 0 || !keywordKey) {
      await e.reply("关键词不能为空，可以发送「添加xxx」或「添加@某人」或「添加@某人 xxx」", true);
      return true;
    }

    // 获取引用的消息
    const replyMsg = await e.getReplyMsg();
    if (!replyMsg || !replyMsg.message) {
      await e.reply("无法获取引用的消息", true);
      return true;
    }

    // 解析引用消息的内容（支持图文混排和艾特）
    const content = await this.parseMessageContent(replyMsg.message, e.group_id);

    if (content.segments.length === 0) {
      await e.reply("引用的消息中没有可保存的内容（文字/图片/艾特）", true);
      return true;
    }

    // 保存关键词数据
    const groupData = await this.loadGroupData(e.group_id);
    
    // 如果已存在该关键词，先删除旧的图片
    if (groupData[keywordKey]) {
      await this.deleteContentImages(groupData[keywordKey], e.group_id);
    }

    groupData[keywordKey] = {
      keywordParts,
      segments: content.segments,
      addedBy: e.user_id,
      addedAt: Date.now(),
    };

    await this.saveGroupData(e.group_id, groupData);
    
    // 生成内容描述
    const hasText = content.segments.some(s => s.type === "text");
    const hasImage = content.segments.some(s => s.type === "image");
    const hasAt = content.segments.some(s => s.type === "at");
    const typeDesc = [
      hasText ? "文字" : "",
      hasImage ? "图片" : "",
      hasAt ? "艾特" : "",
    ].filter(Boolean).join("+");
    
    const keywordDesc = this.formatKeywordDisplay(keywordParts);
    await e.reply(`已添加关键词「${keywordDesc}」的回复（${typeDesc}）~`, true);
    return true;
  });

  /**
   * 删除关键词 - "删除关键词xxx" 或 "删除关键词@某人" 或混合
   */
  删除关键词 = Command(/^删除关键词/, async (e) => {
    if (!e.group_id) return false;

    // 解析要删除的关键词（复用解析逻辑，把"删除关键词"当作"添加"处理）
    const keywordParts = [];
    let foundCommand = false;
    
    for (const seg of e.message) {
      if (seg.type === "reply") continue;
      
      if (seg.type === "at" && seg.data?.qq) {
        keywordParts.push({ type: "at", data: String(seg.data.qq) });
      } else if (seg.type === "text" && seg.data?.text) {
        let text = seg.data.text.trim();
        
        if (!foundCommand && text.startsWith("删除关键词")) {
          text = text.substring(5).trim();
          foundCommand = true;
        }
        
        if (text) {
          keywordParts.push({ type: "text", data: text });
        }
      }
    }
    
    const keywordKey = keywordParts.map(p => `${p.type}:${p.data}`).join("|");

    if (!keywordKey) {
      await e.reply("请指定要删除的关键词，可以发送「删除关键词xxx」或「删除关键词@某人」", true);
      return true;
    }

    const groupData = await this.loadGroupData(e.group_id);

    if (!groupData[keywordKey]) {
      const keywordDesc = this.formatKeywordDisplay(keywordParts);
      await e.reply(`关键词「${keywordDesc}」不存在`, true);
      return true;
    }

    // 删除关联的图片文件
    await this.deleteContentImages(groupData[keywordKey], e.group_id);

    delete groupData[keywordKey];
    await this.saveGroupData(e.group_id, groupData);
    
    const keywordDesc = this.formatKeywordDisplay(keywordParts);
    await e.reply(`已删除关键词「${keywordDesc}」`, true);
    return true;
  });

  /**
   * 查看关键词列表 - "关键词列表"
   */
  关键词列表 = Command(/^关键词列表$/, async (e) => {
    if (!e.group_id) return false;

    const groupData = await this.loadGroupData(e.group_id);
    const keywordKeys = Object.keys(groupData);

    if (keywordKeys.length === 0) {
      await e.reply("本群还没有设置任何关键词回复~", true);
      return true;
    }

    let msg = "📝 本群关键词列表：\n";
    keywordKeys.forEach((key, index) => {
      const item = groupData[key];
      const hasText = item.segments?.some(s => s.type === "text");
      const hasImage = item.segments?.some(s => s.type === "image");
      const hasAt = item.segments?.some(s => s.type === "at");
      const typeIcons = [
        hasText ? "📄" : "",
        hasImage ? "🖼️" : "",
        hasAt ? "👤" : "",
      ].filter(Boolean).join("");
      
      // 显示关键词
      const keywordDisplay = this.formatKeywordDisplay(item.keywordParts || []);
      const hasAtKeyword = item.keywordParts?.some(p => p.type === "at");
      const triggerIcon = hasAtKeyword ? "🎯" : "💬";
      msg += `${index + 1}. ${triggerIcon}「${keywordDisplay}」→ ${typeIcons}\n`;
    });

    await e.reply(msg.trim(), true);
    return true;
  });

  /**
   * 监听消息，匹配关键词并回复
   */
  关键词触发 = OnEvent("message.group", async (e) => {
    if (!e.group_id) return false;

    const groupData = await this.loadGroupData(e.group_id);
    const keywordKeys = Object.keys(groupData);

    if (keywordKeys.length === 0) return false;

    // 解析当前消息的组成部分
    const { partsKey } = this.parseMessageForMatch(e);
    
    if (!partsKey) return false;

    // 精确匹配关键词
    let matchedKey = null;
    if (groupData[partsKey]) {
      matchedKey = partsKey;
    }

    if (!matchedKey) return false;

    const replyData = groupData[matchedKey];

    // 构建回复消息（支持图文混排和艾特）
    const messageSegments = [];
    let hasValidContent = true;

    for (const seg of replyData.segments) {
      if (seg.type === "text") {
        messageSegments.push(segment.text(seg.data));
      } else if (seg.type === "image") {
        const imagePath = path.join(this.getGroupImageDir(e.group_id), seg.data);
        try {
          await fsp.access(imagePath);
          messageSegments.push(segment.image(imagePath));
        } catch (err) {
          // 图片文件不存在
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

    // 如果有图片丢失，清理数据
    if (!hasValidContent) {
      // 重新过滤掉无效的图片段
      replyData.segments = replyData.segments.filter(seg => {
        if (seg.type !== "image") return true;
        const imagePath = path.join(this.getGroupImageDir(e.group_id), seg.data);
        try {
          fs.accessSync(imagePath);
          return true;
        } catch {
          return false;
        }
      });
      
      if (replyData.segments.length === 0) {
        delete groupData[matchedKey];
        logger.warn(`关键词「${matchedKey}」内容已全部失效，已自动删除`);
      }
      await this.saveGroupData(e.group_id, groupData);
    }

    return false; // 不阻止其他插件处理
  });
}
