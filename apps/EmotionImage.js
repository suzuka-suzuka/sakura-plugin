import {
  imageEmbeddingManager,
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

      if (checkResult.exists) {
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
              content: `📝 描述: ${checkResult.item.description || "无"}`,
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

      const result = await imageEmbeddingManager.addPreparedImage(
        checkResult.fileInfo,
        {
          groupId: e.group_id,
          userId: e.user_id,
        }
      );

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
            content: `📝 描述: ${result.description || "无"}`,
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
      const results = await imageEmbeddingManager.searchImage(query, 3, 0.4);

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
          content: `📝 描述: ${result.description || "无"}`,
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

  clearEmoji = Command(/^#?清空表情库$/, "master", async (e) => {
    try {
      const count = imageEmbeddingManager.getCount();

      if (count === 0) {
        await e.reply("表情库已经是空的了");
        return true;
      }

      const cleared = await imageEmbeddingManager.clearAll();
      await e.reply(`✅ 已清空表情库，共删除 ${cleared} 个表情`);
    } catch (error) {
      logger.error(`[清空表情库] 失败: ${error.message}`);
      await e.reply(`清空失败: ${error.message}`, 10);
    }

    return true;
  });
}
