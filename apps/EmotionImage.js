import { Segment } from "../../../src/api/client.js";
import { imageEmbeddingManager } from "../lib/AIUtils/ImageEmbedding.js";
import { getImg } from "../lib/utils.js";
import fs from "fs";

export class EmotionImage extends plugin {
  constructor() {
    super({
      name: "EmotionImage",
      event: "message",
      priority: 500,
    });
  }

  /**
   * 存表情 - 回复图片使用
   */
  saveEmoji = Command(/^#?存表情$/, async (e) => {
    // 使用 getImg 获取图片 URL
    const imgUrls = await getImg(e);

    if (!imgUrls || imgUrls.length === 0) {
      await e.reply("请回复一张图片来存表情", true);
      return true;
    }

    await e.reply("正在分析表情...");

    try {
      const result = await imageEmbeddingManager.addImage(imgUrls[0], {
        groupId: e.group_id,
        userId: e.user_id,
      });

      await e.reply(
        `✅ 表情已保存\n📝 描述: ${result.description}\n🆔 ID: ${result.id}`,
        true
      );
    } catch (error) {
      logger.error(`[存表情] 失败: ${error.message}`);
      await e.reply(`保存失败: ${error.message}`, true);
    }

    return true;
  });

  /**
   * 发表情xx - 根据描述搜索表情
   */
  sendEmoji = Command(/^#?发表情(.+)$/, async (e) => {
    const match = e.msg.match(/^#?发表情(.+)$/);
    if (!match) return false;

    const query = match[1].trim();
    if (!query) {
      await e.reply("请输入表情描述，如：发表情开心", true);
      return true;
    }

    if (imageEmbeddingManager.getCount() === 0) {
      await e.reply("表情库为空，请先存一些表情", true);
      return true;
    }

    try {
      const result = await imageEmbeddingManager.searchImage(query);

      if (!result) {
        await e.reply(`没有找到"${query}"相关的表情`, true);
        return true;
      }

      // 使用本地文件
      if (!result.localPath || !fs.existsSync(result.localPath)) {
        await e.reply("表情文件丢失", true);
        return true;
      }

      await e.reply([
        Segment.image(result.localPath),
        `\n📝 ${result.description}\n🎯 相似度: ${(result.similarity * 100).toFixed(1)}%`,
      ]);
    } catch (error) {
      logger.error(`[发表情] 失败: ${error.message}`);
      await e.reply(`搜索失败: ${error.message}`, true);
    }

    return true;
  });
}
