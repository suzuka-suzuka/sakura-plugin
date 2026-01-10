import { plugindata } from "../lib/path.js";
import setting from "../lib/setting.js";
import fsp from "fs/promises";
import path from "path";
import axios from "axios";
import _ from "lodash";
import crypto from "crypto";
import { imageEmbeddingManager, describeImage } from "../lib/AIUtils/ImageEmbedding.js";
export class TextMsg extends plugin {
  constructor() {
    super({
      name: "表情包小偷",
      dsc: "表情包小偷",
      event: "message.group",
      priority: 35,
    });
    this.fixOldData();
  }

  get appconfig() {
    return setting.getConfig("EmojiThief");
  }

  async saveToVectorDb(buffer, hash, groupId, userId) {
    try {
      const existing = imageEmbeddingManager.getAll().find((item) => item.hash === hash);
      if (existing) {
        return false;
      }

      let description;
      try {
        description = await describeImage({ buffer, mimeType: "image/gif" });
      } catch (err) {
        logger.warn(`[表情包小偷] 无法获取表情描述，跳过向量库存储: ${hash}`);
        return false;
      }

      const EMOJI_IMAGES_DIR = path.join(plugindata, "emoji_embeddings", "images");
      await fsp.mkdir(EMOJI_IMAGES_DIR, { recursive: true });
      
      const filename = `${hash}.gif`;
      const filepath = path.join(EMOJI_IMAGES_DIR, filename);
      await fsp.writeFile(filepath, buffer);

      await imageEmbeddingManager.addPreparedImage(
        { filepath, filename, hash },
        description,
        {
          groupId: groupId,
          userId: userId,
        }
      );

      logger.info(`[表情包小偷] 表情已存入向量库: ${description.substring(0, 30)}...`);
      return true;
    } catch (error) {
      logger.error(`[表情包小偷] 存入向量库失败: ${error.message}`);
      return false;
    }
  }

  表情包小偷 = OnEvent("message.group", async (e) => {
    const EmojiThiefConfig = this.appconfig;
    let rate = EmojiThiefConfig.rate;
    let groups = EmojiThiefConfig.Groups;
    let vectorRate = EmojiThiefConfig.vectorRate ?? 0;

    if (!groups || groups.length === 0 || !groups.includes(e.group_id)) {
      return false;
    }

    for (const item of e.message) {
      if (item.type === "image" && (item.data?.sub_type === 1 || item.data?.emoji_id)) {
        try {
          if (vectorRate <= 0 || _.random(true) >= vectorRate) {
            continue;
          }

          const response = await axios.get(item.data?.url, {
            responseType: "arraybuffer",
            timeout: 10000,
          });
          const buffer = response.data;

          const hash = crypto.createHash("md5").update(buffer).digest("hex");

          this.saveToVectorDb(buffer, hash, e.group_id, e.user_id).catch((err) => {
            logger.error(`[表情包小偷] 向量库存储异常: ${err.message}`);
          });
        } catch (error) {
          logger.error(`处理表情包失败: ${error}`);
        }
      }
    }

    if (_.random(true) < rate) {
      try {
        const allEmojis = imageEmbeddingManager.getAll();

        if (allEmojis.length === 0) {
          return false;
        }

        const randomEmoji = allEmojis[_.random(0, allEmojis.length - 1)];
        logger.info(`触发表情包: ${randomEmoji.description?.substring(0, 30)}...`);
        await e.reply(segment.image(randomEmoji.filepath, 1));
      } catch (error) {
        logger.error(`表情包发送失败: ${error}`);
      }
    }

    return false;
  });

  async fixOldData() {
    try {
      const allEmojis = imageEmbeddingManager.getAll();
      const toDelete = allEmojis.filter((emoji) => emoji.metadata?.source);
      
      if (toDelete.length > 0) {
        logger.info(`[表情包小偷] 发现 ${toDelete.length} 条旧数据，正在自动修复...`);
        for (const emoji of toDelete) {
          if (emoji.id) {
            await imageEmbeddingManager.deleteImage(emoji.id);
          }
        }
        logger.info(`[表情包小偷] 已自动删除 ${toDelete.length} 条旧表情数据`);
      }
    } catch (error) {
      logger.error(`[表情包小偷] 自动修复数据失败: ${error.message}`);
    }
  }
}
