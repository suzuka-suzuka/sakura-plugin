import { GoogleGenAI } from "@google/genai";
import Setting from "../setting.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { plugindata } from "../path.js";

// 表情向量数据目录
const EMOJI_DATA_DIR = path.join(plugindata, "emoji_embeddings");
// 向量数据库文件路径
const EMBEDDINGS_DB_PATH = path.join(EMOJI_DATA_DIR, "data.json");
// 表情图片保存目录
const EMOJI_IMAGES_DIR = path.join(EMOJI_DATA_DIR, "images");

/**
 * 获取工具渠道配置
 */
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

/**
 * 获取 API Key（支持轮询）
 */
const channelApiKeyIndex = new Map();
function getApiKey(channel) {
  let apiKeys = channel.api;

  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys.split("\n").map((k) => k.trim()).filter((k) => k);
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

/**
 * 图片向量管理器
 */
class ImageEmbeddingManager {
  constructor() {
    this.embeddings = [];
    this.embeddingModel = "gemini-embedding-001";
    this.loadEmbeddings();
    this.ensureImageDir();
  }

  /**
   * 确保图片目录存在
   */
  ensureImageDir() {
    if (!fs.existsSync(EMOJI_IMAGES_DIR)) {
      fs.mkdirSync(EMOJI_IMAGES_DIR, { recursive: true });
    }
  }

  /**
   * 创建 Gemini 客户端
   */
  createClient() {
    const channel = getToolsChannelConfig();
    const apiKey = getApiKey(channel);
    return new GoogleGenAI({ apiKey });
  }

  /**
   * 获取工具渠道的模型名称
   */
  getVisionModel() {
    const channel = getToolsChannelConfig();
    return channel.model;
  }

  /**
   * 加载向量数据
   */
  loadEmbeddings() {
    try {
      if (fs.existsSync(EMBEDDINGS_DB_PATH)) {
        const data = fs.readFileSync(EMBEDDINGS_DB_PATH, "utf-8");
        this.embeddings = JSON.parse(data);
        logger.info(`[表情向量] 已加载 ${this.embeddings.length} 条数据`);
      }
    } catch (error) {
      logger.error(`[表情向量] 加载失败: ${error.message}`);
      this.embeddings = [];
    }
  }

  /**
   * 保存向量数据
   */
  saveEmbeddings() {
    try {
      const dir = path.dirname(EMBEDDINGS_DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(EMBEDDINGS_DB_PATH, JSON.stringify(this.embeddings, null, 2));
    } catch (error) {
      logger.error(`[表情向量] 保存失败: ${error.message}`);
    }
  }

  /**
   * 下载图片到本地
   */
  async downloadImage(imageUrl) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`下载失败: ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = response.headers.get("content-type") || "image/png";
      
      // 计算图片 MD5 哈希
      const hash = crypto.createHash("md5").update(buffer).digest("hex");
      
      // 保存原始图片
      const ext = mimeType.includes("gif") ? "gif" : "png";
      const filename = `${hash}.${ext}`;
      const filepath = path.join(EMOJI_IMAGES_DIR, filename);

      fs.writeFileSync(filepath, buffer);
      logger.info(`[表情向量] 图片已保存: ${filename}`);

      return { filepath, filename, hash };
    } catch (error) {
      logger.error(`[表情向量] 下载图片失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 生成文本向量
   */
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

  /**
   * 归一化向量
   */
  normalizeVector(vector) {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  /**
   * 余弦相似度
   */
  cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) return 0;

    let dot = 0, norm1 = 0, norm2 = 0;
    for (let i = 0; i < vec1.length; i++) {
      dot += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    return norm1 && norm2 ? dot / (norm1 * norm2) : 0;
  }

  /**
   * 检查图片是否已存在（下载并计算Hash）
   */
  async checkImage(imageUrl) {
    // 下载图片到本地
    const { filepath, filename, hash } = await this.downloadImage(imageUrl);

    // 检查是否已存在相同哈希的图片
    const existing = this.embeddings.find((item) => item.hash === hash);
    
    if (existing) {
      // 删除刚下载的重复文件
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      return { exists: true, item: existing };
    }

    return { 
      exists: false, 
      fileInfo: { filepath, filename, hash } 
    };
  }

  /**
   * 添加已准备好的图片（跳过下载和查重）
   */
  async addPreparedImage(fileInfo, description, metadata = {}) {
    const { filepath, filename, hash } = fileInfo;

    // 生成向量
    const embedding = await this.generateEmbedding(description, "RETRIEVAL_DOCUMENT");
    const normalizedEmbedding = this.normalizeVector(embedding);

    const imageData = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
      hash: hash,
      localPath: filepath,
      filename: filename,
      description: description,
      embedding: normalizedEmbedding,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
      },
    };

    this.embeddings.push(imageData);
    this.saveEmbeddings();

    logger.info(`[表情向量] 已添加: ${description.substring(0, 50)}...`);
    return imageData;
  }

  /**
   * 添加表情图片（接收 URL 和描述）
   */
  async addImage(imageUrl, description, metadata = {}) {
    const checkResult = await this.checkImage(imageUrl);
    
    if (checkResult.exists) {
      throw new Error(`表情已存在，描述: ${checkResult.item.description}`);
    }

    return this.addPreparedImage(checkResult.fileInfo, description, metadata);
  }

  /**
   * 搜索最匹配的表情
   */
  async searchImage(query, topK = 1) {
    if (this.embeddings.length === 0) {
      return null;
    }

    // 生成查询向量
    const queryEmbedding = await this.generateEmbedding(query, "RETRIEVAL_QUERY");
    const normalizedQuery = this.normalizeVector(queryEmbedding);

    // 计算相似度并排序
    const results = this.embeddings
      .map((item) => ({
        ...item,
        similarity: this.cosineSimilarity(normalizedQuery, item.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    logger.info(
      `[表情向量] 搜索"${query}" 最高相似度: ${results[0]?.similarity?.toFixed(4) || 0}`
    );

    return topK === 1 ? results[0] || null : results;
  }

  /**
   * 删除表情
   */
  deleteImage(id) {
    const index = this.embeddings.findIndex((item) => item.id === id);
    if (index !== -1) {
      const item = this.embeddings[index];
      // 删除本地文件
      if (item.localPath && fs.existsSync(item.localPath)) {
        fs.unlinkSync(item.localPath);
      }
      this.embeddings.splice(index, 1);
      this.saveEmbeddings();
      return true;
    }
    return false;
  }

  getCount() {
    return this.embeddings.length;
  }

  getAll() {
    return this.embeddings;
  }
}

export const imageEmbeddingManager = new ImageEmbeddingManager();
export default imageEmbeddingManager;
