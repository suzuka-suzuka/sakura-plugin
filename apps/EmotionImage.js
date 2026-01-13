import {
  imageEmbeddingManager,
  describeImage,
} from "../lib/AIUtils/ImageEmbedding.js";
import { getImg } from "../lib/utils.js";
import fs from "fs";

export class EmotionImage extends plugin {
  constructor() {
    super({
      name: "EmotionImage",
      event: "message",
      priority: 1135,
    });
  }

  autoCleanup = Cron("0 3 * * 0", async () => {
    const keyword = "可爱";
    const cleanupCount = 20;

    try {
      const count = imageEmbeddingManager.getCount();
      if (count === 0) {
        return;
      }

      if (count <= cleanupCount) {
        return;
      }

      const leastSimilar = await imageEmbeddingManager.findLeastSimilar(
        keyword,
        cleanupCount
      );

      if (leastSimilar.length === 0) {
        return;
      }

      const ids = leastSimilar.map((item) => item.id);
      const result = await imageEmbeddingManager.deleteMultiple(ids);

      logger.mark(
        `[表情库清理] 清理完成: 成功 ${result.success} 个, 失败 ${result.failed} 个`
      );
    } catch (error) {
      logger.error(`[表情库清理] 清理失败: ${error.message}`);
    }
  });

  saveEmoji = Command(/^#?存表情$/, "white", async (e) => {
    let imageMsg = e.message?.find((item) => item.type === "image");

    if (!imageMsg && e.reply_id) {
      const sourceMsg = await e.getReplyMsg();
      imageMsg = sourceMsg?.message?.find((item) => item.type === "image");
    }

    if (
      !imageMsg ||
      (imageMsg.data?.sub_type !== 1 && !imageMsg.data?.emoji_id)
    ) {
      return false;
    }

    const imgUrls = await getImg(e);

    if (!imgUrls || imgUrls.length === 0) {
      return false;
    }

    await e.react(124);
    try {
      const checkResult = await imageEmbeddingManager.checkImage(imgUrls[0]);
      
      logger.mark(`[存表情] checkImage 返回: exists=${checkResult.exists}, fileInfo=${JSON.stringify(checkResult.fileInfo)}`);

      if (checkResult.exists) {
        logger.mark(`[存表情] 表情已存在 ID=${checkResult.item.id}, 检查已存在表情的文件是否存在`);
        
        // 检查已存在表情的文件是否真的存在
        const existingFilePath = checkResult.item.localPath;
        const existingFileExists = existingFilePath && fs.existsSync(existingFilePath);
        
        logger.mark(`[存表情] 已存在表情文件路径: ${existingFilePath}, 文件存在: ${existingFileExists}`);
        
        if (!existingFileExists) {
          logger.error(`[存表情] 检测到孤儿索引！索引 ID=${checkResult.item.id} 存在，但文件 ${existingFilePath} 不存在`);
          
          // 如果新下载的文件存在，用它来修复
          if (
            checkResult.fileInfo?.filepath &&
            fs.existsSync(checkResult.fileInfo.filepath)
          ) {
            logger.warn(`[存表情] 尝试用新下载的文件修复孤儿索引: ${checkResult.fileInfo.filepath} -> ${existingFilePath}`);
            // 这里需要调用 imageEmbeddingManager 的更新方法来修复
            // 暂时先记录问题
            await e.reply(`⚠️ 检测到数据异常：表情索引存在但文件丢失\n索引ID: ${checkResult.item.id}\n请联系管理员修复`, 10);
          } else {
            logger.error(`[存表情] 无法修复：新文件也不存在`);
            await e.reply(`❌ 检测到严重数据异常：表情索引和文件都丢失\n索引ID: ${checkResult.item.id}\n建议删除此索引`, 10);
          }
          return true;
        }
        
        // 已存在的表情文件正常，清理新下载的临时文件
        if (
          checkResult.fileInfo?.filepath &&
          fs.existsSync(checkResult.fileInfo.filepath)
        ) {
          logger.warn(`[存表情] 表情已存在且文件正常，清理新下载的临时文件: ${checkResult.fileInfo.filepath}`);
          fs.unlinkSync(checkResult.fileInfo.filepath);
          logger.mark(`[存表情] 临时文件已清理`);
        } else {
          logger.mark(`[存表情] 无临时文件需要清理`);
        }
        
        const nickname = e.sender.card || e.sender.nickname || "表情库";
        await e.sendForwardMsg(
          [
            {
              nickname: nickname,
              user_id: e.user_id,
              content: "这张表情已经存过啦！",
            },
            {
              nickname: nickname,
              user_id: e.user_id,
              content: `📝 描述: ${checkResult.item.description}`,
            },
            {
              nickname: nickname,
              user_id: e.user_id,
              content: `🆔 ID: ${checkResult.item.id}`,
            },
          ],
          {
            prompt: "表情已存在",
            news: [{ text: "这张表情已经存过啦" }],
            source: "小叶的表情库",
          }
        );
        return true;
      }
      
      logger.mark(`[存表情] 表情不存在，准备保存新表情，临时文件路径: ${checkResult.fileInfo?.filepath}`);

      let description;
      try {
        description = await describeImage({ imageUrl: imgUrls[0] });
        logger.mark(`[存表情] 识图成功: ${description}`);
      } catch (err) {
        logger.error(`[存表情] 识图失败: ${err.message}`);
        if (
          checkResult.fileInfo?.filepath &&
          fs.existsSync(checkResult.fileInfo.filepath)
        ) {
          logger.mark(`[存表情] 清理识图失败的临时文件: ${checkResult.fileInfo.filepath}`);
          fs.unlinkSync(checkResult.fileInfo.filepath);
        }
        throw err;
      }

      if (!description) {
        logger.error(`[存表情] 识图返回空描述`);
        if (
          checkResult.fileInfo?.filepath &&
          fs.existsSync(checkResult.fileInfo.filepath)
        ) {
          logger.mark(`[存表情] 清理空描述的临时文件: ${checkResult.fileInfo.filepath}`);
          fs.unlinkSync(checkResult.fileInfo.filepath);
        }
        throw new Error("识图失败");
      }

      logger.mark(`[存表情] 准备添加到表情库...`);
      const result = await imageEmbeddingManager.addPreparedImage(
        checkResult.fileInfo,
        description,
        {
          groupId: e.group_id,
          userId: e.user_id,
        }
      );
      logger.mark(`[存表情] 成功添加到表情库 ID=${result.id}`);

      const nickname = e.sender.card || e.sender.nickname || "表情库";
      await e.sendForwardMsg(
        [
          {
            nickname: nickname,
            user_id: e.user_id,
            content: "✅ 表情已保存",
          },
          {
            nickname: nickname,
            user_id: e.user_id,
            content: `📝 描述: ${result.description}`,
          },
          {
            nickname: nickname,
            user_id: e.user_id,
            content: `🆔 ID: ${result.id}`,
          },
        ],
        {
          prompt: "表情已保存",
          news: [{ text: "✅ 表情保存成功" }],
          source: "小叶的表情库",
        }
      );
    } catch (error) {
      logger.error(`[存表情] 失败: ${error.message}`);
      await e.reply(`保存失败: ${error.message}`, 10);
    }

    return true;
  });

  sendEmoji = Command(/^#?发表情(.+)$/, "white", async (e) => {
    const match = e.msg.match(/^#?发表情(.+)$/);
    if (!match) return false;

    const query = match[1].trim();
    if (!query) {
      return false;
    }

    if (imageEmbeddingManager.getCount() === 0) {
      await e.reply("表情库为空，请先存一些表情", true);
      return true;
    }

    try {
      const results = await imageEmbeddingManager.searchImage(query, 3);

      if (!results || (Array.isArray(results) && results.length === 0)) {
        await e.reply(`没有找到"${query}"相关的表情`, 10);
        return true;
      }

      const candidates = Array.isArray(results) ? results : [results];
      const result = candidates[Math.floor(Math.random() * candidates.length)];

      if (!result.localPath || !fs.existsSync(result.localPath)) {
        await e.reply("表情文件丢失", 10);
        return true;
      }

      await e.reply(segment.image(result.localPath, 1));

      const nickname = e.sender.card || e.sender.nickname || "表情库";
      const forwardMsg = [
        {
          nickname: nickname,
          user_id: e.user_id,
          content: `🔍 搜索: ${query}`,
        },
        {
          nickname: nickname,
          user_id: e.user_id,
          content: `📝 描述: ${result.description}`,
        },
        {
          nickname: nickname,
          user_id: e.user_id,
          content: `🎯 相似度: ${(result.similarity * 100).toFixed(
            1
          )}%\n🆔 ID: ${result.id}`,
        },
      ];

      await e.sendForwardMsg(forwardMsg, {
        prompt: "表情详情",
        news: [{ text: `搜索: ${query}` }],
        source: "小叶的表情库",
      });
    } catch (error) {
      logger.error(`[发表情] 失败: ${error.message}`);
      await e.reply(`搜索失败: ${error.message}`, 10);
    }

    return true;
  });

  deleteEmoji = Command(/^#?删表情(.*)$/, "white", async (e) => {
    const imgUrls = await getImg(e);

    if (imgUrls && imgUrls.length > 0) {
      try {
        const checkResult = await imageEmbeddingManager.checkImageExists(
          imgUrls[0]
        );

        if (!checkResult.exists) {
          await e.reply("这张表情不在表情库中", true);
          return true;
        }

        const deleted = await imageEmbeddingManager.deleteImage(
          checkResult.item.id
        );

        if (deleted) {
          const nickname = e.sender.card || e.sender.nickname || "表情库";
          await e.sendForwardMsg(
            [
              {
                nickname: nickname,
                user_id: e.user_id,
                content: "🗑️ 表情已删除",
              },
              {
                nickname: nickname,
                user_id: e.user_id,
                content: `📝 描述: ${checkResult.item.description}`,
              },
              {
                nickname: nickname,
                user_id: e.user_id,
                content: `🆔 ID: ${checkResult.item.id}`,
              },
            ],
            {
              prompt: "表情已删除",
              news: [{ text: "🗑️ 表情删除成功" }],
              source: "小叶的表情库",
            }
          );
        } else {
          await e.reply("删除失败，请稍后重试", 10);
        }
      } catch (error) {
        logger.error(`[删表情] 失败: ${error.message}`);
        await e.reply(`删除失败: ${error.message}`, 10);
      }
      return true;
    }

    const match = e.msg.match(/^#?删表情(.+)$/);
    if (!match || !match[1].trim()) {
      return false;
    }

    const targetId = match[1].trim();

    try {
      const allEmojis = imageEmbeddingManager.getAll();
      const targetEmoji = allEmojis.find((item) => item.id === targetId);

      if (!targetEmoji) {
        return false;
      }

      const deleted = await imageEmbeddingManager.deleteImage(targetId);

      if (deleted) {
        const nickname = e.sender.card || e.sender.nickname || "表情库";
        await e.sendForwardMsg(
          [
            {
              nickname: nickname,
              user_id: e.user_id,
              content: "🗑️ 表情已删除",
            },
            {
              nickname: nickname,
              user_id: e.user_id,
              content: `📝 描述: ${targetEmoji.description}`,
            },
            {
              nickname: nickname,
              user_id: e.user_id,
              content: `🆔 ID: ${targetId}`,
            },
          ],
          {
            prompt: "表情已删除",
            news: [{ text: "🗑️ 表情删除成功" }],
            source: "小叶的表情库",
          }
        );
      } else {
        await e.reply("删除失败，请稍后重试", 10);
      }
    } catch (error) {
      logger.error(`[删表情] 失败: ${error.message}`);
      await e.reply(`删除失败: ${error.message}`, 10);
    }

    return true;
  });

  cleanOrphanedEmoji = Command(/^#?清理孤儿表情$/, "white", async (e) => {
    await e.reply("正在清理孤儿表情索引...", true);

    try {
      const result = await imageEmbeddingManager.cleanupOrphanedIndexes();

      if (result.cleaned === 0) {
        await e.reply(
          `✅ 没有发现孤儿索引，表情库共 ${result.total} 个表情`,
          true
        );
      } else {
        await e.reply(
          `✅ 清理完成！\n🗑️ 清理孤儿索引: ${result.cleaned} 个\n📦 剩余表情: ${result.total} 个`,
          true
        );
      }
    } catch (error) {
      logger.error(`[清理孤儿表情] 失败: ${error.message}`);
      await e.reply(`清理失败: ${error.message}`, 10);
    }

    return true;
  });
}
