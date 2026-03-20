import { CronExpressionParser } from 'cron-parser';
import Setting from '../setting.js';
import { getRedis, onRedisKeyExpired } from '../../../../src/utils/redis.js';
import { getAI } from './getAI.js';

const ONCE_REMINDER_TRIGGER_PREFIX = 'sakura:reminder:once:trigger:';
const ONCE_REMINDER_DATA_PREFIX = 'sakura:reminder:once:data:';
let onceReminderListenerReady = false;

const REMINDER_AI_SYSTEM_PROMPT =
  '你是一个提醒文案助手。将输入的提醒内容改写为自然、简短、友好的中文提醒。' +
  '要求：保留核心含义；不要添加额外事实；不要输出解释，只输出最终可发送文本。';

export async function renderReminderContentWithAI(content, context = {}) {
  const raw = String(content || '').trim();
  if (!raw) return raw;

  try {
    const aiConfig = Setting.getConfig('AI') || {};
    const channelName = aiConfig.appschannel || aiConfig.defaultchannel;
    if (!channelName) return raw;

    const query = `原始提醒内容：${raw}\n请输出改写后的提醒文本。`;

    const result = await getAI(
      channelName,
      null,
      [{ text: query }],
      REMINDER_AI_SYSTEM_PROMPT,
      false,
      false,
      []
    );

    // getAI 返回 string 代表错误信息，直接回退原文
    if (typeof result === 'string') {
      logger.warn(`[Reminder] AI 文案生成返回错误文本，使用原文: ${result}`);
      return raw;
    }

    const aiText = typeof result?.text === 'string' ? result.text.trim() : '';
    return aiText || raw;
  } catch (error) {
    logger.warn(`[Reminder] AI 文案生成失败，使用原文: ${error.message}`);
    return raw;
  }
}

export function resolveReminderTarget(e, qq) {
  const groupId = Number(e?.group_id || 0);
  const targetQQ = String(qq || e?.user_id || '').trim();
  return {
    groupId,
    targetQQ,
    hasQQ: !!targetQQ,
    hasGroup: groupId > 0,
  };
}

export function parseDelayMs(time, relativeTime) {
  if ((time && relativeTime) || (!time && !relativeTime)) {
    return { ok: false, message: "参数错误：'time' (绝对时间) 和 'relativeTime' (相对时间) 必须提供一个，且只能提供一个。" };
  }

  const now = new Date();

  if (time) {
    if (!/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(time)) {
      return { ok: false, message: `参数错误：提供的时间 "${time}" 格式不正确，请使用 'HH:mm' 或 'HH:mm:ss' 格式。` };
    }
    const [hour, minute, second = 0] = time.split(':').map(Number);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return { ok: false, message: `参数错误：时间 ${time} 包含无效的数值。` };
    }
    const targetDate = new Date();
    targetDate.setHours(hour, minute, second, 0);
    if (targetDate <= now) targetDate.setDate(targetDate.getDate() + 1);
    const delayMs = targetDate.getTime() - now.getTime();
    return { ok: true, delayMs, targetDate };
  }

  const hoursMatch = relativeTime.match(/(\d+)\s*h/i);
  const minutesMatch = relativeTime.match(/(\d+)\s*m/i);
  const secondsMatch = relativeTime.match(/(\d+)\s*s/i);
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
  const delayMs = (hours * 3600000) + (minutes * 60000) + (seconds * 1000);
  if (delayMs <= 0) {
    return { ok: false, message: `参数错误：相对时间 "${relativeTime}" 解析后的总时长必须大于0秒。` };
  }

  return { ok: true, delayMs, targetDate: new Date(now.getTime() + delayMs) };
}

export function buildRepeatCron(cron) {
  const expression = String(cron || '').trim();
  if (!expression) {
    return { ok: true, hasCron: false, cronExpression: '' };
  }

  const parts = expression.split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, message: '参数错误：cron 必须是标准 5 段 cron 表达式。' };
  }

  try {
    CronExpressionParser.parse(expression);
  } catch {
    return { ok: false, message: `参数错误：cron "${expression}" 无效。` };
  }

  return { ok: true, hasCron: true, cronExpression: expression };
}

export function addRepeatReminderTask({ targetQQ, groupId, content, cronExpression }) {
  const reminderConfig = Setting.getConfig('reminderTask') || {};
  const tasks = Array.isArray(reminderConfig.tasks) ? [...reminderConfig.tasks] : [];

  const taskId = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  tasks.push({
    id: taskId,
    enable: true,
    cron: cronExpression,
    qq: targetQQ,
    groupId,
    content: String(content).trim(),
    createdAt: new Date().toISOString(),
    source: 'ReminderTool',
  });

  const ok = Setting.setConfig('reminderTask', {
    ...reminderConfig,
    tasks,
  });

  return { ok, taskId };
}

export async function scheduleOnceReminder({ delayMs, targetQQ, groupId, content }) {
  await ensureOnceReminderListener();

  const redis = getRedis();
  const taskId = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const triggerKey = `${ONCE_REMINDER_TRIGGER_PREFIX}${taskId}`;
  const dataKey = `${ONCE_REMINDER_DATA_PREFIX}${taskId}`;
  const ttlSeconds = Math.ceil(delayMs / 1000);

  const payload = {
    qq: targetQQ,
    groupId,
    content: String(content).trim(),
  };

  await redis.setex(dataKey, ttlSeconds + 3600, JSON.stringify(payload));
  await redis.setex(triggerKey, ttlSeconds, '1');

  return { taskId, ttlSeconds };
}

async function ensureOnceReminderListener() {
  if (onceReminderListenerReady) return;

  await onRedisKeyExpired(async (expiredKey) => {
    if (!expiredKey?.startsWith(ONCE_REMINDER_TRIGGER_PREFIX)) return;

    const taskId = expiredKey.slice(ONCE_REMINDER_TRIGGER_PREFIX.length);
    if (!taskId) return;

    try {
      const redis = getRedis();
      const dataKey = `${ONCE_REMINDER_DATA_PREFIX}${taskId}`;
      const raw = await redis.get(dataKey);
      if (!raw) return;

      let task;
      try {
        task = JSON.parse(raw);
      } catch {
        await redis.del(dataKey);
        return;
      }

      const currentBot = (typeof bot !== 'undefined' ? bot : null);
      if (!currentBot) return;

      const finalContent = await renderReminderContentWithAI(task.content, {
        groupId: Number(task.groupId || 0),
        qq: String(task.qq || '').trim(),
        taskId,
      });

      if (task.groupId > 0) {
        const text = String(finalContent || '').trim();
        const msg = task.qq ? [segment.at(String(task.qq)), segment.text(` ${text}`)] : text;
        await currentBot.pickGroup(task.groupId).sendMsg(msg);
        await redis.del(dataKey);
        return;
      }

      if (task.qq) {
        await currentBot.pickFriend(Number(task.qq)).sendMsg(finalContent);
        await redis.del(dataKey);
      }
    } catch (error) {
      console.error(`[Reminder] Redis 过期提醒发送失败: ${error.message}`);
    }
  });

  onceReminderListenerReady = true;
}
