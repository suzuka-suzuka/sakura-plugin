import { GoogleGenAI } from "@google/genai";
import { LocalIndex } from "vectra";
import Setting from "../setting.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { plugindata } from "../path.js";
import { getAI } from "./getAI.js";
import sharp from "sharp";
import db from "../Database.js";

const EMOJI_DATA_DIR = path.join(plugindata, "emoji_embeddings");
const VECTRA_INDEX_DIR = path.join(EMOJI_DATA_DIR, "vectra_index");
const EMOJI_IMAGES_DIR = path.join(EMOJI_DATA_DIR, "images");

function getToolsChannelConfig() {
  const aiConfig = Setting.getConfig("AI");
  const toolsChannelName = aiConfig?.toolschannel;

  if (!toolsChannelName) {
    throw new Error("未配置 toolschannel");
  }

  const channelsConfig = Setting.getConfig("Channels");
  const geminiChannels = channelsConfig?.gemini || [];
  const channel = geminiChannels.find((c) => c.name === toolsChannelName);

  if (!channel || !channel.api) {
    throw new Error(`未找到工具渠道 ${toolsChannelName} 的配置`);
  }

  return channel;
}

const channelApiKeyIndex = new Map();
function getApiKey(channel) {
  let apiKeys = channel.api;

  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys
      .split("\n")
      .map((k) => k.trim())
      .filter((k) => k);
  }

  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    let currentIndex = channelApiKeyIndex.get(channel.name) || 0;
    if (currentIndex >= apiKeys.length) currentIndex = 0;
    const key = apiKeys[currentIndex];
    channelApiKeyIndex.set(channel.name, (currentIndex + 1) % apiKeys.length);
    return key;
  }

  return typeof apiKeys === "string" ? apiKeys : null;
}

class ImageEmbeddingManager {
  constructor() {
    this.index = null;
    this.embeddingModel = "gemini-embedding-2-preview";
    this.initialized = false;
    this.initPromise = this.init();
  }

  async init() {
    try {
      this.ensureDirs();
      await this.initVectraIndex();
      this.initialized = true;
    } catch (error) {
      logger.error(`[表情向量] 初始化失败: ${error.message}`);
    }
  }

  async ensureInit() {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  ensureDirs() {
    if (!fs.existsSync(EMOJI_DATA_DIR)) {
      fs.mkdirSync(EMOJI_DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(EMOJI_IMAGES_DIR)) {
      fs.mkdirSync(EMOJI_IMAGES_DIR, { recursive: true });
    }
  }

  async initVectraIndex() {
    this.index = new LocalIndex(VECTRA_INDEX_DIR);

    if (!(await this.index.isIndexCreated())) {
      await this.index.createIndex();
    }
  }

  createClient() {
    const channel = getToolsChannelConfig();
    const apiKey = getApiKey(channel);
    return new GoogleGenAI({ apiKey });
  }

  /**
   * 下载图片并计算hash（可选是否保存到本地）
   * @param {string} imageUrl - 图片URL
   * @param {boolean} saveToLocal - 是否保存到本地
   * @param {number} maxSize - 最大文件大小（字节），默认2MB
   */
  async downloadImage(imageUrl, saveToLocal = true, maxSize = 2 * 1024 * 1024) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`下载失败: ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length > maxSize) {
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
        throw new Error(`图片太大了(${sizeMB}MB)，表情包最大支持2MB`);
      }

      const mimeType = response.headers.get("content-type") || "image/png";

      const hash = crypto.createHash("md5").update(buffer).digest("hex");

      const ext = mimeType.includes("gif") ? "gif" : "png";
      const filename = `${hash}.${ext}`;
      const filepath = path.join(EMOJI_IMAGES_DIR, filename);

      if (saveToLocal) {
        fs.writeFileSync(filepath, buffer);
      }

      return { filepath, filename, hash };
    } catch (error) {
      logger.error(`[表情向量] 下载图片失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 生成图片的嵌入向量（支持图片+描述文本混合嵌入）
   * @param {Buffer} imageBuffer - 图片buffer
   * @param {string} mimeType - 图片MIME类型
   * @param {string} [description] - 可选的描述文本，与图片一起嵌入
   * @returns {Promise<number[]>} 嵌入向量
   */
  async generateImageEmbedding(imageBuffer, mimeType = "image/png", description = "") {
    try {
      const client = this.createClient();

      // GIF 转 PNG（嵌入模型不支持 GIF）
      let processedBuffer = imageBuffer;
      let processedMimeType = mimeType;
      if (mimeType.includes("gif")) {
        try {
          processedBuffer = await sharp(imageBuffer, { animated: false })
            .png()
            .toBuffer();
          processedMimeType = "image/png";
        } catch (err) {
          logger.warn(`[表情向量] GIF转PNG失败，尝试原格式: ${err.message}`);
        }
      }

      const base64 = processedBuffer.toString("base64");

      // 构建 parts：图片 + 可选描述文本（混合嵌入）
      const parts = [
        {
          inlineData: {
            mimeType: processedMimeType,
            data: base64,
          },
        },
      ];

      if (description) {
        parts.push({ text: description });
      }

      const result = await client.models.embedContent({
        model: this.embeddingModel,
        contents: {
          parts: parts,
        },
        config: {
          outputDimensionality: 768,
        },
      });

      return result.embeddings[0].values;
    } catch (error) {
      logger.error(`[表情向量] 生成图片向量失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 使用AI识别图片，提取关键词描述
   * @param {Buffer} imageBuffer - 图片buffer
   * @param {string} mimeType - 图片MIME类型
   * @returns {Promise<string>} 描述文本
   */
  async describeImage(imageBuffer, mimeType = "image/png") {
    // GIF 转 PNG
    let processedBuffer = imageBuffer;
    let processedMimeType = mimeType;
    if (mimeType.includes("gif")) {
      try {
        processedBuffer = await sharp(imageBuffer, { animated: false })
          .png()
          .toBuffer();
        processedMimeType = "image/png";
      } catch (err) {
        logger.warn(`[表情向量] GIF转PNG失败，尝试原格式: ${err.message}`);
      }
    }

    const base64 = processedBuffer.toString("base64");

    const queryParts = [
      {
        text: `用一两句简短的自然语言描述这张表情包/图片的内容、情感和使用场景。直接输出描述，不要开场白。`
      },
      {
        inlineData: {
          mimeType: processedMimeType,
          data: base64,
        },
      },
    ];

    const Channel = Setting.getConfig("AI").toolschannel;
    const aiResult = await getAI(Channel, null, queryParts, "", false, false);

    if (typeof aiResult === "object" && aiResult.text) {
      return aiResult.text;
    }

    throw new Error(typeof aiResult === "string" ? aiResult : "识图返回为空");
  }

  /**
   * 生成文本的嵌入向量
   * @param {string} text - 文本内容
   * @param {string} taskPrefix - 任务指令前缀，用于优化嵌入效果
   * @returns {Promise<number[]>} 嵌入向量
   */
  async generateTextEmbedding(text, taskPrefix = "") {
    try {
      const client = this.createClient();
      const content = taskPrefix ? `${taskPrefix}${text}` : text;

      const result = await client.models.embedContent({
        model: this.embeddingModel,
        contents: content,
        config: {
          outputDimensionality: 768,
        },
      });

      return result.embeddings[0].values;
    } catch (error) {
      logger.error(`[表情向量] 生成文本向量失败: ${error.message}`);
      throw error;
    }
  }

  async checkImage(imageUrl) {
    await this.ensureInit();

    const { hash } = await this.downloadImage(imageUrl, false);
    const existing = db.prepare('SELECT * FROM image_metadata WHERE hash = ?').get(hash);

    if (existing) {
      const item = {
        id: existing.id,
        hash: existing.hash,
        localPath: existing.file_path,
        filename: existing.file_name,
        description: existing.description,
        metadata: JSON.parse(existing.metadata || '{}')
      };
      return { exists: true, item: item };
    }

    const { filepath, filename } = await this.downloadImage(imageUrl, true);

    return {
      exists: false,
      fileInfo: { filepath, filename, hash },
    };
  }

  async checkImageExists(imageUrl) {
    await this.ensureInit();

    const { hash } = await this.downloadImage(imageUrl, false);
    const existing = db.prepare('SELECT * FROM image_metadata WHERE hash = ?').get(hash);

    if (existing) {
      const item = {
        id: existing.id,
        hash: existing.hash,
        localPath: existing.file_path,
        filename: existing.file_name,
        description: existing.description,
        metadata: JSON.parse(existing.metadata || '{}')
      };
      return { exists: true, item };
    }

    return { exists: false };
  }

  /**
   * 添加已准备好的图片（AI识图 + 图片+描述混合嵌入）
   * @param {Object} fileInfo - 文件信息 {filepath, filename, hash}
   * @param {Object} metadata - 额外元数据
   */
  async addPreparedImage(fileInfo, metadata = {}) {
    await this.ensureInit();

    const { filepath, filename, hash } = fileInfo;

    // 读取图片文件
    const imageBuffer = fs.readFileSync(filepath);
    const mimeType = filename.endsWith(".gif") ? "image/gif" : "image/png";

    // AI 识图生成描述关键词
    const description = await this.describeImage(imageBuffer, mimeType);
    logger.info(`[表情向量] 识图结果: ${description.substring(0, 50)}`);

    // 图片 + 描述文本 混合嵌入
    const embedding = await this.generateImageEmbedding(imageBuffer, mimeType, description);

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);

    await this.index.insertItem({
      id: id,
      vector: embedding,
      metadata: {
        hash: hash,
      },
    });

    const createdAt = new Date().toISOString();
    const createdTimestamp = Date.now();

    try {
      db.prepare(`
            INSERT INTO image_metadata (id, hash, file_path, file_name, description, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
        id,
        hash,
        filepath,
        filename,
        description,
        JSON.stringify({ ...metadata, createdAt }),
        createdTimestamp
      );
    } catch (err) {
      logger.error(`[表情向量] 保存元数据到数据库失败: ${err.message}`);
      await this.index.deleteItem(id);
      throw err;
    }

    const imageData = {
      id: id,
      hash: hash,
      localPath: filepath,
      filename: filename,
      description: description,
      metadata: {
        ...metadata,
        createdAt: createdAt,
      },
    };

    logger.info(`[表情向量] 已添加图片: ${hash}`);
    return imageData;
  }

  async addImage(imageUrl, metadata = {}) {
    const checkResult = await this.checkImage(imageUrl);

    if (checkResult.exists) {
      throw new Error(`表情已存在`);
    }

    return this.addPreparedImage(checkResult.fileInfo, metadata);
  }

  async searchImage(query, topK = 1, minScore = 0) {
    await this.ensureInit();

    const count = db.prepare('SELECT COUNT(*) as count FROM image_metadata').get().count;

    if (count === 0) {
      return null;
    }

    const queryEmbedding = await this.generateTextEmbedding(query, "search_query: ");

    const results = await this.index.queryItems(queryEmbedding, topK);

    if (!results || results.length === 0) {
      return null;
    }

    const enrichedResults = [];
    for (const result of results) {
      const hash = result.item.metadata.hash;
      const row = db.prepare('SELECT * FROM image_metadata WHERE hash = ?').get(hash);

      if (row) {
        const item = {
          id: row.id,
          hash: row.hash,
          localPath: row.file_path,
          filename: row.file_name,
          description: row.description,
          metadata: JSON.parse(row.metadata || '{}'),
          similarity: result.score
        };
        if (result.score >= minScore) {
          enrichedResults.push(item);
        }
      }
    }

    if (enrichedResults.length === 0) {
      return null;
    }

    return topK === 1 ? enrichedResults[0] || null : enrichedResults;
  }

  async deleteImage(id) {
    await this.ensureInit();

    const row = db.prepare('SELECT * FROM image_metadata WHERE id = ?').get(id);

    if (row) {
      if (row.file_path && fs.existsSync(row.file_path)) {
        try {
          fs.unlinkSync(row.file_path);
        } catch (err) {
          logger.warn(`[表情向量] 删除文件失败: ${err.message}`);
        }
      }

      await this.index.deleteItem(id);
      db.prepare('DELETE FROM image_metadata WHERE id = ?').run(id);
      return true;
    }
    return false;
  }

  getCount() {
    return db.prepare('SELECT COUNT(*) as count FROM image_metadata').get().count;
  }

  getAll() {
    const rows = db.prepare('SELECT * FROM image_metadata').all();
    return rows.map(row => ({
      id: row.id,
      hash: row.hash,
      localPath: row.file_path,
      filename: row.file_name,
      description: row.description,
      metadata: JSON.parse(row.metadata || '{}')
    }));
  }

  /**
   * 查找与指定关键词相似度最低的 N 个表情包
   * @param {string} keyword - 用于比较的关键词
   * @param {number} count - 要返回的数量
   * @returns {Promise<Array>} 相似度最低的表情包列表
   */
  async findLeastSimilar(keyword, count = 20) {
    await this.ensureInit();

    const totalCount = this.getCount();

    if (totalCount === 0) {
      return [];
    }

    const queryEmbedding = await this.generateTextEmbedding(keyword, "search_query: ");

    const allResults = await this.index.queryItems(queryEmbedding, totalCount);

    if (!allResults || allResults.length === 0) {
      return [];
    }

    const sortedResults = allResults.sort((a, b) => a.score - b.score);

    const leastSimilar = sortedResults.slice(0, count);

    const enrichedResults = [];
    for (const result of leastSimilar) {
      const hash = result.item.metadata.hash;
      const row = db.prepare('SELECT * FROM image_metadata WHERE hash = ?').get(hash);

      if (row) {
        enrichedResults.push({
          id: row.id,
          hash: row.hash,
          localPath: row.file_path,
          filename: row.file_name,
          description: row.description,
          metadata: JSON.parse(row.metadata || '{}'),
          similarity: result.score
        });
      }
    }
    return enrichedResults;
  }

  /**
   * 批量删除表情
   * @param {Array<string>} ids - 要删除的表情 ID 列表
   * @returns {Promise<{success: number, failed: number}>} 删除结果
   */
  async deleteMultiple(ids) {
    await this.ensureInit();

    let success = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        const deleted = await this.deleteImage(id);
        if (deleted) {
          success++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`[表情向量] 删除 ${id} 失败: ${error.message}`);
        failed++;
      }
    }

    return { success, failed };
  }


  /**
   * 计算两个文本之间的相似度
   * @param {string} text1 - 第一个文本
   * @param {string} text2 - 第二个文本
   * @returns {Promise<number>} 相似度分数 (0-1)
   */
  async calculateSimilarity(text1, text2) {
    try {
      const [embedding1, embedding2] = await Promise.all([
        this.generateTextEmbedding(text1),
        this.generateTextEmbedding(text2),
      ]);

      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
      }

      const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
      return Math.max(0, Math.min(1, similarity));
    } catch (error) {
      logger.error(`[表情向量] 计算相似度失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 清空所有表情数据（SQL表 + 向量索引 + 图片文件）
   * @returns {Promise<number>} 清除的表情数量
   */
  async clearAll() {
    await this.ensureInit();

    const count = this.getCount();

    // 清空数据库表
    db.prepare('DELETE FROM image_metadata').run();

    // 删除并重建向量索引
    await this.index.deleteIndex();
    await this.index.createIndex();

    // 清空图片文件夹
    if (fs.existsSync(EMOJI_IMAGES_DIR)) {
      const files = fs.readdirSync(EMOJI_IMAGES_DIR);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(EMOJI_IMAGES_DIR, file));
        } catch (err) {
          logger.warn(`[表情向量] 删除文件失败: ${file} - ${err.message}`);
        }
      }
    }

    logger.mark(`[表情向量] 已清空所有数据，共 ${count} 条`);
    return count;
  }
}

export const imageEmbeddingManager = new ImageEmbeddingManager();
export default imageEmbeddingManager;
