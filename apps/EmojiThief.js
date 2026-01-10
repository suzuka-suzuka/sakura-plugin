import setting from "../lib/setting.js";
import fsp from "fs/promises";
import _ from "lodash";
import { imageEmbeddingManager, describeImage } from "../lib/AIUtils/ImageEmbedding.js";
export class TextMsg extends plugin {
  constructor() {
    super({
      name: "表情包小偷",
      dsc: "表情包小偷",
      event: "message.group",
      priority: 35,
    });
  }

  get appconfig() {
    return setting.getConfig("EmojiThief");
  }

  async saveToVectorDb(imageUrl, groupId, userId) {
    try {
      const checkResult = await imageEmbeddingManager.checkImage(imageUrl);

      if (checkResult.exists) {
        return false;
      }

      let description;
      try {
        const buffer = await fsp.readFile(checkResult.fileInfo.filepath);
        description = await describeImage({ buffer, mimeType: "image/gif" });
      } catch (err) {
        logger.warn(`[表情包小偷] 无法获取表情描述，跳过向量库存储: ${checkResult.fileInfo.hash}`);
        if (checkResult.fileInfo.filepath) {
          await fsp.rm(checkResult.fileInfo.filepath, { force: true }).catch(() => {});
        }
        return false;
      }

      await imageEmbeddingManager.addPreparedImage(
        checkResult.fileInfo,
        description,
        {
          groupId: groupId,
          userId: userId,
        }
      );

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

    const emojiItem = e.message.find(
      (item) => item.type === "image" && (item.data?.sub_type === 1 || item.data?.emoji_id)
    );

    if (emojiItem) {
      try {
        if (vectorRate > 0 && _.random(true) < vectorRate) {
          this.saveToVectorDb(emojiItem.data.url, e.group_id, e.user_id).catch((err) => {
            logger.error(`[表情包小偷] 向量库存储异常: ${err.message}`);
          });
        }
      } catch (error) {
        logger.error(`处理表情包失败: ${error}`);
      }
    }

    if (_.random(true) < rate) {
      try {
        const allEmojis = imageEmbeddingManager.getAll();

        if (allEmojis.length === 0) {
          return false;
        }

        const randomEmoji = allEmojis[_.random(0, allEmojis.length - 1)];
        logger.info(`触发表情包`);
        
        if (randomEmoji && randomEmoji.localPath) {
             await e.reply(segment.image(randomEmoji.localPath, 1));
        } else {
             logger.warn(`[表情包小偷] 表情包路径无效`);
        }
      } catch (error) {
        logger.error(`表情包发送失败: ${error}`);
      }
    }

    return false;
  });
}
