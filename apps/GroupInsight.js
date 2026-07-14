import schedule from "node-schedule";
import { Segment, getBot, getBots } from "../../../src/api/client.js";
import Setting from "../lib/setting.js";
import { getAI } from "../lib/AIUtils/getAI.js";
import {
  getActiveRecordedGroups,
  getGroupMessagesByTimeRange,
} from "../lib/AIUtils/groupMessageStore.js";
import {
  applyGroupMemberNames,
  resolveGroupMemberNameMap,
} from "../lib/AIUtils/groupMemberNames.js";
import {
  GROUP_INSIGHT_MIN_MESSAGE_COUNT,
  buildGroupInsightAIInput,
  buildGroupInsightPrompt,
  buildGroupInsightStats,
  extractGroupInsightJson,
  getCachedGroupInsight,
  isGroupInsightCommandRecord,
  normalizeGroupInsightAnalysis,
  resolveGroupInsightDate,
  setCachedGroupInsight,
} from "../lib/AIUtils/groupInsight.js";
import { renderGroupInsightImage } from "../lib/AIUtils/groupInsightRenderer.js";

const INSIGHT_COMMAND = /^#?(?:群聊洞见|群聊报告)(?:\s*([\s\S]*))?$/i;
const DAILY_REPORT_CRON = "59 23 * * *";
const activeReports = new Set();

export function parseGroupInsightCommandArgs(rawArgs = "") {
  const tokens = String(rawArgs || "").trim().split(/\s+/).filter(Boolean);
  const forceRefresh = tokens.includes("刷新");
  const dateInput = tokens.filter((token) => token !== "刷新").join(" ");
  return { forceRefresh, dateInput };
}

function formatGeneratedAt(date = new Date()) {
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getGroupName(e) {
  return String(
    e.group_name
      || e.group?.name
      || e.group?.group_name
      || `群 ${e.group_id}`
  );
}

function createReportKey(selfId, groupId, dateKey) {
  return `${String(selfId)}:${String(groupId)}:${dateKey}`;
}

function createInsufficientMessagesError(messageCount) {
  const error = new Error(
    `有效群消息不足：${messageCount}/${GROUP_INSIGHT_MIN_MESSAGE_COUNT}`
  );
  error.code = "INSUFFICIENT_GROUP_MESSAGES";
  error.messageCount = messageCount;
  return error;
}

async function buildAIAnalysis(e, date, stats, aiInput) {
  if (!aiInput.text.trim()) {
    return normalizeGroupInsightAnalysis(null, { aiInput, stats });
  }

  const route = Setting.getConfig("AI", { selfId: e.self_id })?.appsRoute
    || "default";
  const prompt = buildGroupInsightPrompt({ date, stats, aiInput });
  const result = await getAI(
    route,
    e,
    [{ text: prompt }],
    null,
    false,
    false,
    []
  );

  if (!result || typeof result === "string") {
    throw new Error(String(result || "AI 未返回有效内容"));
  }

  const parsed = extractGroupInsightJson(result.text);
  if (!parsed) {
    throw new Error("AI 未按要求返回结构化 JSON");
  }
  return normalizeGroupInsightAnalysis(parsed, { aiInput, stats });
}

async function createGroupInsightReport({
  e,
  date,
  groupName,
  cacheMode = "normal",
  excludeMessageId = null,
  isDailyReport = false,
}) {
  const shouldReadCache = cacheMode === "normal";
  const shouldWriteCache = cacheMode !== "bypass";
  let report = null;

  if (shouldReadCache) {
    try {
      report = await getCachedGroupInsight({
        selfId: e.self_id,
        groupId: e.group_id,
        dateKey: date.dateKey,
      });
    } catch (error) {
      logger.warn(`[GroupInsight] 读取报告缓存失败: ${error.message}`);
    }
  }

  if (report) {
    return {
      ...report,
      groupName,
      fromCache: true,
      isDailyReport,
    };
  }

  const storedMessages = await getGroupMessagesByTimeRange({
    selfId: e.self_id,
    groupId: e.group_id,
    startTime: date.startTime,
    endTime: date.endTime,
    excludeMessageId,
  });
  const messages = storedMessages.filter(
    (record) => !isGroupInsightCommandRecord(record)
  );
  if (messages.length < GROUP_INSIGHT_MIN_MESSAGE_COUNT) {
    throw createInsufficientMessagesError(messages.length);
  }

  let memberNames = null;
  try {
    memberNames = await resolveGroupMemberNameMap(e, messages);
  } catch (error) {
    logger.warn(`[GroupInsight] 获取群名片失败，使用历史昵称: ${error.message}`);
  }

  const namedMessages = memberNames instanceof Map
    ? applyGroupMemberNames(messages, memberNames)
    : messages;
  const stats = buildGroupInsightStats(namedMessages);
  const aiInput = buildGroupInsightAIInput(namedMessages, { memberNames });
  let analysis;
  try {
    analysis = await buildAIAnalysis(e, date, stats, aiInput);
  } catch (error) {
    logger.warn(`[GroupInsight] AI 洞见生成失败，降级为本地统计: ${error.message}`);
    analysis = normalizeGroupInsightAnalysis(null, { aiInput, stats });
  }

  report = {
    groupId: String(e.group_id),
    groupName,
    date,
    stats,
    analysis,
    aiInputNote: aiInput.note,
    generatedAt: formatGeneratedAt(),
    fromCache: false,
    isDailyReport,
  };

  if (shouldWriteCache && analysis.aiAvailable) {
    try {
      await setCachedGroupInsight({
        selfId: e.self_id,
        groupId: e.group_id,
        dateKey: date.dateKey,
        isToday: date.isToday,
        report,
      });
    } catch (error) {
      logger.warn(`[GroupInsight] 写入报告缓存失败: ${error.message}`);
    }
  }

  return report;
}

export class GroupInsight extends plugin {
  constructor() {
    super({
      name: "群聊洞见",
      event: "message.group",
      priority: 1135,
    });
  }

  async init() {
    for (const currentBot of getBots()) {
      const selfId = Number(currentBot.self_id);
      if (!Number.isFinite(selfId)) continue;
      const job = schedule.scheduleJob(DAILY_REPORT_CRON, async (fireDate) => {
        await this.sendDailyReports(selfId, fireDate);
      });
      if (job) this.jobs.push(job);
    }
  }

  async sendDailyReports(selfId, fireDate = new Date()) {
    const currentBot = getBot(selfId);
    if (!currentBot) return;
    const config = Setting.getConfig("GroupInsight", { selfId });
    if (config?.autoDailyReport === false) return;

    const date = resolveGroupInsightDate("今天", fireDate);
    let groups;
    try {
      groups = await getActiveRecordedGroups({
        selfId,
        startTime: date.startTime,
        endTime: date.endTime,
      });
    } catch (error) {
      logger.error(`[GroupInsight] 获取账号 ${selfId} 的活跃群失败:`, error);
      return;
    }

    const configuredGroups = Array.isArray(config?.Groups)
      ? new Set(config.Groups.map(String))
      : new Set();
    if (configuredGroups.size > 0) {
      groups = groups.filter((group) => configuredGroups.has(String(group.groupId)));
    }

    for (const group of groups) {
      const reportKey = createReportKey(selfId, group.groupId, date.dateKey);
      if (activeReports.has(reportKey)) {
        logger.info(`[GroupInsight] 群 ${group.groupId} 正在生成报告，跳过自动日报`);
        continue;
      }
      activeReports.add(reportKey);

      try {
        const mockEvent = {
          self_id: selfId,
          group_id: Number(group.groupId),
          user_id: selfId,
          group_name: group.groupName,
          sender: { user_id: selfId, nickname: currentBot.nickname || "Sakura" },
          bot: currentBot,
        };
        const report = await createGroupInsightReport({
          e: mockEvent,
          date,
          groupName: group.groupName,
          cacheMode: "bypass",
          isDailyReport: true,
        });
        const imageBuffer = await renderGroupInsightImage(report);
        await currentBot.sendGroupMsg(
          Number(group.groupId),
          [Segment.image(imageBuffer)]
        );
        logger.info(`[GroupInsight] 已向群 ${group.groupId} 发送 ${date.dateKey} 自动日报`);
      } catch (error) {
        if (error?.code === "INSUFFICIENT_GROUP_MESSAGES") {
          logger.info(
            `[GroupInsight] 群 ${group.groupId} 当天仅 ${error.messageCount} 条有效消息，跳过自动日报`
          );
        } else {
          logger.error(`[GroupInsight] 群 ${group.groupId} 自动日报失败:`, error);
        }
      } finally {
        activeReports.delete(reportKey);
      }
    }
  }

  generateInsight = Command(
    INSIGHT_COMMAND,
    "message.group",
    1135,
    async (e) => {
      const { forceRefresh, dateInput } = parseGroupInsightCommandArgs(
        e.match?.[1]
      );
      let date;

      try {
        date = resolveGroupInsightDate(dateInput);
      } catch (error) {
        await e.reply(
          `${error.message}\n用法：#群聊洞见 [今天|昨天|前天|YYYY-MM-DD] [刷新]`
        );
        return true;
      }

      const reportKey = createReportKey(e.self_id, e.group_id, date.dateKey);
      if (activeReports.has(reportKey)) {
        await e.reply("这个日期的群聊洞见正在生成，请稍等一下。");
        return true;
      }

      await e.react?.(124).catch(() => {});
      activeReports.add(reportKey);

      try {
        const report = await createGroupInsightReport({
          e,
          date,
          groupName: getGroupName(e),
          cacheMode: forceRefresh ? "refresh" : "normal",
          excludeMessageId: e.message_id ?? e.message_seq,
        });
        const imageBuffer = await renderGroupInsightImage(report);
        await e.reply(Segment.image(imageBuffer));
        return true;
      } catch (error) {
        if (error?.code === "INSUFFICIENT_GROUP_MESSAGES") {
          await e.reply(
            `这一天只记录到 ${error.messageCount} 条有效群消息，至少需要 `
              + `${GROUP_INSIGHT_MIN_MESSAGE_COUNT} 条才能生成洞见。`
          );
          return true;
        }
        logger.error("[GroupInsight] 生成群聊洞见失败:", error);
        await e.reply(`群聊洞见生成失败：${error?.message || error}`, 10, true);
        return true;
      } finally {
        activeReports.delete(reportKey);
      }
    }
  );
}
