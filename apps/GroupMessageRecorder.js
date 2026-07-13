import {
  appendGroupMessage,
  removeGroupMessage,
  searchGroupMessages,
} from "../lib/AIUtils/groupMessageStore.js";

const SEARCH_COMMAND = /^#?(?:搜群消息|搜索群消息|查群消息|搜索聊天记录)(?:\s*([\s\S]*))?$/i;
const SEARCH_COMMAND_PREFIX = /^#?(?:搜群消息|搜索群消息|查群消息|搜索聊天记录)/i;
const QQ_PREFIX_PATTERN = /^(?:(?:qq|用户)\s*[:：=]?\s*)?(\d{5,12})(?:\s+([\s\S]*))?$/i;
const RECORD_PRIORITY = -Infinity;
const SEARCH_RESULT_LIMIT = 20;

export function getAtTarget(e) {
  if (!Array.isArray(e?.message)) return null;

  let textBeforeAt = "";
  for (const segment of e.message) {
    if (segment?.type === "text") {
      textBeforeAt += segment.data?.text || "";
      continue;
    }
    if (segment?.type !== "at") continue;

    const target = segment.data?.qq ?? segment.data?.user_id;
    if (target == null || target === "all") continue;

    const commandAppearsBeforeAt = SEARCH_COMMAND_PREFIX.test(
      textBeforeAt.trimStart()
    );
    const isLeadingBotMention = String(target) === String(e.self_id)
      && !commandAppearsBeforeAt;

    // “@Bot 搜群消息 ...”里的开头艾特只是唤醒方式；
    // “搜群消息 @Bot”里的艾特则是在搜索 Bot 自己的消息。
    if (!isLeadingBotMention) return String(target);
  }

  return null;
}

function parseSearchCriteria(e) {
  let keyword = String(e?.msg || "")
    .replace(SEARCH_COMMAND_PREFIX, "")
    .trim();
  let userId = getAtTarget(e);

  if (!userId && keyword) {
    const match = keyword.match(QQ_PREFIX_PATTERN);
    if (match) {
      userId = match[1];
      keyword = String(match[2] || "").trim();
    }
  }

  return { userId, keyword };
}

function formatTime(timestamp) {
  return new Date(Number(timestamp || 0) * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function shortenContent(content, maxLength = 500) {
  const normalized = String(content || "").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function toForwardUserId(userId) {
  const numeric = Number(userId);
  return Number.isSafeInteger(numeric) ? numeric : String(userId);
}

export class GroupMessageRecorder extends plugin {
  constructor() {
    super({
      name: "群消息记录",
      event: "message.group",
      priority: 1135,
    });
  }

  async recordEvent(e) {
    try {
      await appendGroupMessage(e);
    } catch (error) {
      logger.warn(`[GroupMessageRecorder] 记录群消息失败: ${error.message}`);
    }
    return false;
  }

  recordIncoming = OnEvent("message.group", RECORD_PRIORITY, async (e) => {
    return await this.recordEvent(e);
  });

  recordSent = OnEvent("message_sent", RECORD_PRIORITY, async (e) => {
    if (e.message_type !== "group" || !e.group_id) return false;
    return await this.recordEvent(e);
  });

  removeRecalled = OnEvent("notice.group_recall", RECORD_PRIORITY, async (e) => {
    try {
      await removeGroupMessage({
        selfId: e.self_id,
        groupId: e.group_id,
        messageId: e.message_id,
      });
    } catch (error) {
      logger.warn(`[GroupMessageRecorder] 清理撤回消息失败: ${error.message}`);
    }
    return false;
  });

  searchMessages = Command(SEARCH_COMMAND, "message.group", 1135, async (e) => {
    const { userId, keyword } = parseSearchCriteria(e);
    if (!userId && !keyword) {
      await e.reply(
        "用法：\n"
          + "#搜群消息 关键词\n"
          + "#搜群消息 QQ号\n"
          + "#搜群消息 QQ号 关键词\n"
          + "也可以艾特群友后输入关键词。"
      );
      return true;
    }

    try {
      const results = await searchGroupMessages({
        selfId: e.self_id,
        groupId: e.group_id,
        userId,
        keyword,
        limit: SEARCH_RESULT_LIMIT,
        excludeMessageId: e.message_id ?? e.message_seq,
      });

      if (results.length === 0) {
        const conditions = [
          userId ? `QQ:${userId}` : "",
          keyword ? `关键词“${keyword}”` : "",
        ].filter(Boolean).join("，");
        await e.reply(`没有找到符合条件的群消息：${conditions}`);
        return true;
      }

      const orderedResults = [...results].reverse();
      const nodes = orderedResults.map((record) => {
        const seq = record.realSeq || record.messageSeq || record.messageId;
        return {
          user_id: toForwardUserId(record.userId),
          nickname: record.senderName || record.userId,
          content: [{
            type: "text",
            data: {
              text: `[${formatTime(record.time)} | QQ:${record.userId} | seq:${seq}]\n`
                + shortenContent(record.content),
            },
          }],
        };
      });

      try {
        await e.sendForwardMsg(nodes, {
          source: "群消息搜索",
          prompt: `找到 ${results.length} 条群消息`,
          news: orderedResults.slice(-4).map((record) => ({
            text: `${record.senderName}: ${shortenContent(record.content, 60)}`,
          })),
        });
      } catch (forwardError) {
        logger.warn(
          `[GroupMessageRecorder] 合并转发搜索结果失败，改用文本回复: ${forwardError.message}`
        );
        const fallbackText = results.map((record, index) => {
          const seq = record.realSeq || record.messageSeq || record.messageId;
          return `${index + 1}. [${formatTime(record.time)}] `
            + `${record.senderName}(QQ:${record.userId}, seq:${seq})：`
            + shortenContent(record.content, 160);
        }).join("\n");
        await e.reply(`找到 ${results.length} 条群消息：\n${fallbackText}`);
      }
    } catch (error) {
      logger.error(`[GroupMessageRecorder] 搜索群消息失败: ${error.message}`);
      await e.reply("搜索群消息失败，请稍后再试。");
    }

    return true;
  });
}
