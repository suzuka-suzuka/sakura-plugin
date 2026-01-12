import { GoogleGenAI } from "@google/genai";
import { LocalIndex } from "vectra";
import Setting from "../setting.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { plugindata } from "../path.js";
import { getAI } from "./getAI.js";
import sharp from "sharp";

const EMOJI_DATA_DIR = path.join(plugindata, "emoji_embeddings");
const VECTRA_INDEX_DIR = path.join(EMOJI_DATA_DIR, "vectra_index");
const EMOJI_IMAGES_DIR = path.join(EMOJI_DATA_DIR, "images");
const METADATA_PATH = path.join(EMOJI_DATA_DIR, "metadata.json");

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
    this.metadata = new Map();
    this.embeddingModel = "gemini-embedding-001";
    this.initialized = false;
    this.initPromise = this.init();
  }

  async init() {
    try {
      this.ensureDirs();
      await this.loadMetadata();
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

  async loadMetadata() {
    try {
      if (fs.existsSync(METADATA_PATH)) {
        const data = fs.readFileSync(METADATA_PATH, "utf-8");
        const arr = JSON.parse(data);
        this.metadata = new Map(arr.map((item) => [item.hash, item]));
      }
    } catch (error) {
      logger.error(`[表情向量] 加载元数据失败: ${error.message}`);
      this.metadata = new Map();
    }
  }

  saveMetadata() {
    try {
      const arr = Array.from(this.metadata.values());
      fs.writeFileSync(METADATA_PATH, JSON.stringify(arr, null, 2));
    } catch (error) {
      logger.error(`[表情向量] 保存元数据失败: ${error.message}`);
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

  async generateEmbedding(text, taskType = "SEMANTIC_SIMILARITY") {
    try {
      const client = this.createClient();

      const result = await client.models.embedContent({
        model: this.embeddingModel,
        contents: text,
        config: {
          taskType: taskType,
          outputDimensionality: 768,
        },
      });

      return result.embeddings[0].values;
    } catch (error) {
      logger.error(`[表情向量] 生成向量失败: ${error.message}`);
      throw error;
    }
  }

  async checkImage(imageUrl) {
    await this.ensureInit();

    const { filepath, filename, hash } = await this.downloadImage(imageUrl, true);

    const existing = this.metadata.get(hash);

    if (existing) {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      return { exists: true, item: existing };
    }

    return {
      exists: false,
      fileInfo: { filepath, filename, hash },
    };
  }

  async checkImageExists(imageUrl) {
    await this.ensureInit();

    const { hash } = await this.downloadImage(imageUrl, false);
    const existing = this.metadata.get(hash);

    if (existing) {
      return { exists: true, item: existing };
    }

    return { exists: false };
  }

  async addPreparedImage(fileInfo, description, metadata = {}) {
    await this.ensureInit();

    const { filepath, filename, hash } = fileInfo;

    const embedding = await this.generateEmbedding(
      description,
      "RETRIEVAL_DOCUMENT"
    );

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);

    await this.index.insertItem({
      id: id,
      vector: embedding,
      metadata: {
        hash: hash,
        description: description,
      },
    });

    const imageData = {
      id: id,
      hash: hash,
      localPath: filepath,
      filename: filename,
      description: description,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
      },
    };

    this.metadata.set(hash, imageData);
    this.saveMetadata();

    logger.info(`[表情向量] 已添加: ${description.substring(0, 50)}...`);
    return imageData;
  }

  async addImage(imageUrl, description, metadata = {}) {
    const checkResult = await this.checkImage(imageUrl);

    if (checkResult.exists) {
      throw new Error(`表情已存在，描述: ${checkResult.item.description}`);
    }

    return this.addPreparedImage(checkResult.fileInfo, description, metadata);
  }

  async searchImage(query, topK = 1) {
    await this.ensureInit();

    if (this.metadata.size === 0) {
      return null;
    }

    const queryEmbedding = await this.generateEmbedding(
      query,
      "RETRIEVAL_QUERY"
    );

    const results = await this.index.queryItems(queryEmbedding, topK);

    if (!results || results.length === 0) {
      return null;
    }

    const enrichedResults = results.map((result) => {
      const meta = this.metadata.get(result.item.metadata.hash);
      return {
        ...meta,
        similarity: result.score,
        description: result.item.metadata.description,
      };
    });

    return topK === 1 ? enrichedResults[0] || null : enrichedResults;
  }

  async deleteImage(id) {
    await this.ensureInit();

    let targetHash = null;
    for (const [hash, item] of this.metadata) {
      if (item.id === id) {
        targetHash = hash;
        if (item.localPath && fs.existsSync(item.localPath)) {
          fs.unlinkSync(item.localPath);
        }
        break;
      }
    }

    if (targetHash) {
      await this.index.deleteItem(id);
      this.metadata.delete(targetHash);
      this.saveMetadata();
      return true;
    }
    return false;
  }

  getCount() {
    return this.metadata.size;
  }

  getAll() {
    return Array.from(this.metadata.values());
  }

  /**
   * 查找与指定关键词相似度最低的 N 个表情包
   * @param {string} keyword - 用于比较的关键词
   * @param {number} count - 要返回的数量
   * @returns {Promise<Array>} 相似度最低的表情包列表
   */
  async findLeastSimilar(keyword, count = 20) {
    await this.ensureInit();

    if (this.metadata.size === 0) {
      return [];
    }

    const queryEmbedding = await this.generateEmbedding(
      keyword,
      "RETRIEVAL_QUERY"
    );

    const allResults = await this.index.queryItems(queryEmbedding, this.metadata.size);

    if (!allResults || allResults.length === 0) {
      return [];
    }

    const sortedResults = allResults.sort((a, b) => a.score - b.score);

    const leastSimilar = sortedResults.slice(0, count);

    return leastSimilar.map((result) => {
      const meta = this.metadata.get(result.item.metadata.hash);
      return {
        ...meta,
        similarity: result.score,
        description: result.item.metadata.description,
      };
    });
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
   * 清理孤儿索引（图片文件不存在但索引仍然存在的记录）
   * @returns {Promise<{cleaned: number, total: number}>} 清理结果
   */
  async cleanupOrphanedIndexes() {
    await this.ensureInit();

    const orphanedIds = [];
    
    for (const [hash, item] of this.metadata) {
      if (!item.localPath || !fs.existsSync(item.localPath)) {
        orphanedIds.push(item.id);
        logger.warn(`[表情向量] 发现孤儿索引: ${item.id} - ${item.description?.substring(0, 30)}...`);
      }
    }

    if (orphanedIds.length === 0) {
      return { cleaned: 0, total: this.metadata.size };
    }

    let cleaned = 0;
    for (const id of orphanedIds) {
      try {
        // 找到对应的 hash
        let targetHash = null;
        for (const [hash, item] of this.metadata) {
          if (item.id === id) {
            targetHash = hash;
            break;
          }
        }
        
        if (targetHash) {
          await this.index.deleteItem(id);
          this.metadata.delete(targetHash);
          cleaned++;
        }
      } catch (error) {
        logger.error(`[表情向量] 清理孤儿索引 ${id} 失败: ${error.message}`);
      }
    }

    this.saveMetadata();
    logger.mark(`[表情向量] 孤儿索引清理完成: 清理 ${cleaned} 个, 剩余 ${this.metadata.size} 个`);
    
    return { cleaned, total: this.metadata.size };
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
        this.generateEmbedding(text1, "SEMANTIC_SIMILARITY"),
        this.generateEmbedding(text2, "SEMANTIC_SIMILARITY"),
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
}

export async function describeImage({
  imageUrl,
  buffer,
  mimeType = "image/gif",
}) {
  let base64, finalMimeType;
  let imageBuffer;

  if (buffer) {
    imageBuffer = buffer;
    finalMimeType = mimeType;
  } else if (imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`获取图片失败: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
    finalMimeType = response.headers.get("content-type") || mimeType;
  } else {
    throw new Error("必须提供 imageUrl 或 buffer");
  }

  if (finalMimeType.includes("gif")) {
    try {
      imageBuffer = await sharp(imageBuffer, { animated: false })
        .png()
        .toBuffer();
      finalMimeType = "image/png";
    } catch (err) {
      logger.warn(`[表情向量] GIF转PNG失败，尝试原格式: ${err.message}`);
    }
  }

  base64 = imageBuffer.toString("base64");

  const queryParts = [
    {
      text: `请用一段连贯的中文描述这张表情包/图片的内容、情感和氛围。不要使用Markdown格式，不要分段，不要包含标题（如"情感："等），直接输出纯文本描述。不要开场白。`,
    },
    {
      inlineData: {
        mimeType: finalMimeType,
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

export const imageEmbeddingManager = new ImageEmbeddingManager();
export default imageEmbeddingManager;
