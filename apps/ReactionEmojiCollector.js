import {
  extractReactionEmojiIds,
  isReactionFromOtherUser,
  recordReactionEmojiIds,
} from "../lib/reactionEmojiStore.js";

export class ReactionEmojiCollector extends plugin {
  constructor() {
    super({
      name: "表情回应收集",
      event: "notice.group_msg_emoji_like",
      priority: -Infinity,
    });
  }

  collect = OnEvent(
    "notice.group_msg_emoji_like",
    -Infinity,
    async (e) => {
      if (!isReactionFromOtherUser(e)) return false;

      const emojiIds = extractReactionEmojiIds(e);
      if (emojiIds.length === 0) return false;

      try {
        const addedIds = await recordReactionEmojiIds(emojiIds);
        if (addedIds.length > 0) {
          logger.info(`[表情回应收集] 新增表情 ID: ${addedIds.join(", ")}`);
        }
      } catch (error) {
        logger.warn(`[表情回应收集] 保存表情 ID 失败: ${error.message}`);
      }

      return false;
    }
  );
}

