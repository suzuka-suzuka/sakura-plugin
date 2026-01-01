import { Segment } from "../../../src/api/client.js";
import { imageEmbeddingManager } from "../lib/AIUtils/ImageEmbedding.js";
import { getImg, urlToBase64 } from "../lib/utils.js";
import { getAI } from "../lib/AIUtils/getAI.js";
import Setting from "../lib/setting.js";
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
   * 识别图片内容
   */
  async describeImage(imageUrl, e) {
    const result = await urlToBase64(imageUrl);
    if (!result) {
      throw new Error("获取图片失败");
    }

    const queryParts = [
      { text: "请用一段连贯的中文描述这张表情包/图片的内容、情感和氛围。不要使用Markdown格式，不要分段，不要包含标题（如“情感：”等），直接输出纯文本描述。不要开场白。" },
      {
        inlineData: {
          mimeType: result.mimeType,
          data: result.base64,
        },
      },
    ];

    const Channel = Setting.getConfig("AI").toolschannel;
    const aiResult = await getAI(Channel, e, queryParts, "", false, false);

    // getAI 成功时返回对象，失败时返回错误字符串
    if (typeof aiResult === "object" && aiResult.text) {
      return aiResult.text;
    }
    
    // 返回字符串就是错误信息
    throw new Error(typeof aiResult === "string" ? aiResult : "识图返回为空");
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

    await e.reply("正在检查图片...");

    try {
      // 1. 检查图片是否已存在
      const checkResult = await imageEmbeddingManager.checkImage(imgUrls[0]);
      
      if (checkResult.exists) {
        await e.reply(`这张表情已经存过啦！\n📝 描述: ${checkResult.item.description}`, true);
        return true;
      }

      // 2. 识图获取描述
      await e.reply("图片检测通过，正在分析内容...");
      let description;
      try {
        description = await this.describeImage(imgUrls[0], e);
      } catch (err) {
        // 识图失败，清理已下载的图片
        if (checkResult.fileInfo?.filepath && fs.existsSync(checkResult.fileInfo.filepath)) {
          fs.unlinkSync(checkResult.fileInfo.filepath);
        }
        throw err;
      }

      if (!description) {
         if (checkResult.fileInfo?.filepath && fs.existsSync(checkResult.fileInfo.filepath)) {
          fs.unlinkSync(checkResult.fileInfo.filepath);
        }
        throw new Error("识图失败");
      }

      // 3. 保存到向量库
      const result = await imageEmbeddingManager.addPreparedImage(checkResult.fileInfo, description, {
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
