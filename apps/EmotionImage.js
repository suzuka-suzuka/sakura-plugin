import {
  imageEmbeddingManager,
  describeImage,
} from "../lib/AIUtils/ImageEmbedding.js";
import { getImg } from "../lib/utils.js";
import EconomyManager from "../lib/economy/EconomyManager.js";
import fs from "fs";

const emojiRewardCooldown = new Map();
const REWARD_COOLDOWN_MS = 5 * 60 * 1000;
const CUTE_SIMILARITY_THRESHOLD = 0.6;
const MIN_REWARD_COINS = 20;
const MAX_REWARD_COINS = 100;

function calculateRewardCoins(cuteSimilarity) {
  const ratio =
    (cuteSimilarity - CUTE_SIMILARITY_THRESHOLD) /
    (1 - CUTE_SIMILARITY_THRESHOLD);
  const coins =
    MIN_REWARD_COINS + ratio * (MAX_REWARD_COINS - MIN_REWARD_COINS);
  return Math.floor(coins);
}

export class EmotionImage extends plugin {
  constructor() {
    super({
      name: "EmotionImage",
      event: "message",
      priority: 1135,
    });
  }

  saveEmoji = Command(/^#?存表情$/, async (e) => {
    const imgUrls = await getImg(e);

    if (!imgUrls || imgUrls.length === 0) {
      return false;
    }

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
            source: "表情向量库",
          }
        );
        return true;
      }

      let description;
      try {
        description = await describeImage({ imageUrl: imgUrls[0] });
      } catch (err) {
        if (
          checkResult.fileInfo?.filepath &&
          fs.existsSync(checkResult.fileInfo.filepath)
        ) {
          fs.unlinkSync(checkResult.fileInfo.filepath);
        }
        throw err;
      }

      if (!description) {
        if (
          checkResult.fileInfo?.filepath &&
          fs.existsSync(checkResult.fileInfo.filepath)
        ) {
          fs.unlinkSync(checkResult.fileInfo.filepath);
        }
        throw new Error("识图失败");
      }

      const result = await imageEmbeddingManager.addPreparedImage(
        checkResult.fileInfo,
        description,
        {
          groupId: e.group_id,
          userId: e.user_id,
        }
      );

      let rewardMsg = null;
      const userId = e.user_id;
      const now = Date.now();
      const lastRewardTime = emojiRewardCooldown.get(userId) || 0;
      const canGetReward = now - lastRewardTime >= REWARD_COOLDOWN_MS;

      if (canGetReward && e.group_id) {
        try {
          const cuteSimilarity =
            await imageEmbeddingManager.calculateSimilarity(
              description,
              "可爱"
            );

          if (cuteSimilarity >= CUTE_SIMILARITY_THRESHOLD) {
            const rewardCoins = calculateRewardCoins(cuteSimilarity);
            const economyManager = new EconomyManager(e);
            economyManager.addCoins(e, rewardCoins);
            emojiRewardCooldown.set(userId, now);
            rewardMsg = `🎉 可爱表情奖励！+${rewardCoins}樱花币\n💕 可爱度: ${(
              cuteSimilarity * 100
            ).toFixed(1)}%`;
          }
        } catch (rewardErr) {
          logger.warn(`[存表情奖励] 检查奖励失败: ${rewardErr.message}`);
        }
      }

      const nickname = e.sender.card || e.sender.nickname || "表情库";
      const forwardMsgContent = [
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
      ];

      if (rewardMsg) {
        forwardMsgContent.push({
          nickname: nickname,
          user_id: e.user_id,
          content: rewardMsg,
        });
      }

      await e.sendForwardMsg(forwardMsgContent, {
        prompt: "表情已保存",
        news: [{ text: "✅ 表情保存成功" }],
        source: "表情向量库",
      });
    } catch (error) {
      logger.error(`[存表情] 失败: ${error.message}`);
      await e.reply(`保存失败: ${error.message}`, true);
    }

    return true;
  });

  sendEmoji = Command(/^#?发表情(.+)$/, async (e) => {
    const match = e.msg.match(/^#?发表情(.+)$/);
    if (!match) return false;

    const query = match[1].trim();
    if (!query) {
      return false
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

      if (!result.localPath || !fs.existsSync(result.localPath)) {
        await e.reply("表情文件丢失", true);
        return true;
      }

      await e.reply(segment.image(result.localPath));

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
        source: "表情向量库",
      });
    } catch (error) {
      logger.error(`[发表情] 失败: ${error.message}`);
      await e.reply(`搜索失败: ${error.message}`, true);
    }

    return true;
  });

  deleteEmoji = Command(/^#?删表情(.*)$/, async (e) => {
    if (!e.isMaster) {
      await e.reply("只有主人才能删除表情哦~", true);
      return true;
    }

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
              source: "表情向量库",
            }
          );
        } else {
          await e.reply("删除失败，请稍后重试", true);
        }
      } catch (error) {
        logger.error(`[删表情] 失败: ${error.message}`);
        await e.reply(`删除失败: ${error.message}`, true);
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
            source: "表情向量库",
          }
        );
      } else {
        await e.reply("删除失败，请稍后重试", true);
      }
    } catch (error) {
      logger.error(`[删表情] 失败: ${error.message}`);
      await e.reply(`删除失败: ${error.message}`, true);
    }

    return true;
  });
}
