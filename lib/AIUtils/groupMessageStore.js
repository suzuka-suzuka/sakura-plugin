import {
  getMessageIdentifier,
  normalizeMessageIdentifier,
} from "./messageIdentifiers.js";

export const GROUP_MESSAGE_MAX_COUNT = 5000;
export const GROUP_MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

const SEARCH_BATCH_SIZE = 500;
const MAX_STORED_CONTENT_LENGTH = 4000;
const KEY_PREFIX = "sakura:group-message-history:v3";
const STORED_POST_TYPES = new Set(["message", "message_sent"]);
const RUNTIME_EVENT_FIELDS = new Set([
  "bot",
  "group",
  "friend",
  "__routeKey",
]);
const GROUP_CONTEXT_MESSAGE_TYPES = new Set([
  "text",
  "at",
  "image",
  "video",
  "file",
  "forward",
  "json",
]);

async function resolveRedis(redis) {
  if (redis) return redis;
  const { getRedis } = await import("../../../../src/utils/redis.js");
  return getRedis();
}

const APPEND_MESSAGE_SCRIPT = `
local timelineKey = KEYS[1]
local dataKey = KEYS[2]
local groupRegistryKey = KEYS[3]
local groupRegistryDataKey = KEYS[4]
local messageId = ARGV[1]
local score = tonumber(ARGV[2])
local payload = ARGV[3]
local maxCount = tonumber(ARGV[4])
local ttlSeconds = tonumber(ARGV[5])
local cutoff = tonumber(ARGV[6])
local groupId = ARGV[7]
local groupPayload = ARGV[8]

local expiredIds = redis.call('ZRANGEBYSCORE', timelineKey, '-inf', cutoff)
if #expiredIds > 0 then
  redis.call('ZREM', timelineKey, unpack(expiredIds))
  redis.call('HDEL', dataKey, unpack(expiredIds))
end

redis.call('HSET', dataKey, messageId, payload)
redis.call('ZADD', timelineKey, score, messageId)

local expiredGroupIds = redis.call('ZRANGEBYSCORE', groupRegistryKey, '-inf', cutoff)
if #expiredGroupIds > 0 then
  redis.call('ZREM', groupRegistryKey, unpack(expiredGroupIds))
  redis.call('HDEL', groupRegistryDataKey, unpack(expiredGroupIds))
end
redis.call('ZADD', groupRegistryKey, score, groupId)
redis.call('HSET', groupRegistryDataKey, groupId, groupPayload)

local count = redis.call('ZCARD', timelineKey)
if count > maxCount then
  local overflowIds = redis.call('ZRANGE', timelineKey, 0, count - maxCount - 1)
  if #overflowIds > 0 then
    redis.call('ZREM', timelineKey, unpack(overflowIds))
    redis.call('HDEL', dataKey, unpack(overflowIds))
  end
end

redis.call('EXPIRE', timelineKey, ttlSeconds)
redis.call('EXPIRE', dataKey, ttlSeconds)
redis.call('EXPIRE', groupRegistryKey, ttlSeconds)
redis.call('EXPIRE', groupRegistryDataKey, ttlSeconds)
return redis.call('ZCARD', timelineKey)
`;

function clampInteger(value, fallback, min, max) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeTimestampSeconds(value, nowMs = Date.now()) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.floor(nowMs / 1000);
  }
  if (numeric > 1e12) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
}

function getSegmentData(segment) {
  return segment?.data && typeof segment.data === "object"
    ? segment.data
    : {};
}

function normalizeSegment(segment) {
  const data = getSegmentData(segment);

  switch (segment?.type) {
    case "text":
      return data.text || "";
    case "at": {
      const target = data.qq ?? data.user_id;
      if (target === "all" || target === 0 || target === "0") {
        return "@全体成员";
      }
      return target == null ? "" : `@${target}`;
    }
    case "image":
      return data.sub_type === 1 ? "[动画表情]" : "[图片]";
    case "record":
      return "[语音]";
    case "video":
      return "[视频]";
    case "file":
      return data.name ? `[文件:${data.name}]` : "[文件]";
    case "face":
      return data.id == null ? "[表情]" : `[表情:${data.id}]`;
    case "reply":
      return data.id == null ? "[回复]" : `[回复:${data.id}]`;
    case "forward":
      return "[聊天记录]";
    case "json":
      return "[JSON]";
    default:
      return segment?.type ? `[${segment.type}]` : "";
  }
}

export function normalizeGroupMessageContent(message, rawMessage = "") {
  const content = Array.isArray(message)
    ? message.map(normalizeSegment).join("").trim()
    : "";
  const fallback = typeof rawMessage === "string" ? rawMessage.trim() : "";
  return (content || fallback).slice(0, MAX_STORED_CONTENT_LENGTH);
}

export function normalizeGroupTextContent(message) {
  if (!Array.isArray(message)) return "";
  return message
    .map((segment) => {
      const data = getSegmentData(segment);
      if (segment?.type === "text") return data.text || "";
      if (segment?.type === "at") {
        const target = data.qq ?? data.user_id;
        return target == null ? "" : `@${target}`;
      }
      return "";
    })
    .join("")
    .trim()
    .slice(0, MAX_STORED_CONTENT_LENGTH);
}

function normalizeGroupContextSegment(segment) {
  const data = getSegmentData(segment);

  switch (segment?.type) {
    case "text":
      return data.text || "";
    case "at": {
      const target = data.qq ?? data.user_id;
      return target == null ? "" : `@${target}`;
    }
    case "image":
      return data.sub_type === 1 ? "[动画表情]" : "[图片]";
    case "video":
      return "[视频]";
    case "file":
      return data.name ? `[文件:${data.name}]` : "[文件:未命名文件]";
    case "forward":
      return "[聊天记录]";
    case "json": {
      try {
        const rawJson = typeof segment.data === "string"
          ? segment.data
          : segment.data?.data;
        const jsonData = typeof rawJson === "string"
          ? JSON.parse(rawJson)
          : rawJson;
        return jsonData?.meta?.detail?.resid ? "[聊天记录]" : "";
      } catch {
        return "";
      }
    }
    default:
      return "";
  }
}

export function normalizeGroupContextContent(message) {
  if (!Array.isArray(message)) return "";
  return message
    .filter((segment) => segment?.type !== "reply")
    .map(normalizeGroupContextSegment)
    .join("")
    .slice(0, MAX_STORED_CONTENT_LENGTH);
}

function isGroupContextEligible(message) {
  return Array.isArray(message)
    && message.some((segment) => GROUP_CONTEXT_MESSAGE_TYPES.has(segment?.type));
}

function getReplyMessageId(message) {
  if (!Array.isArray(message)) return "";
  const reply = message.find((segment) => segment?.type === "reply");
  const id = reply?.data?.id ?? reply?.data?.message_id;
  return id == null ? "" : String(id);
}

function getAtTargets(message) {
  if (!Array.isArray(message)) return [];
  return [...new Set(
    message
      .filter((segment) => segment?.type === "at")
      .map((segment) => segment?.data?.qq ?? segment?.data?.user_id)
      .filter((target) => (
        target != null
        && target !== "all"
        && target !== 0
        && target !== "0"
      ))
      .map(String)
  )];
}

export function getGroupMessageStoreKeys(selfId, groupId) {
  const scope = `${String(selfId ?? "default")}:${String(groupId)}`;
  return {
    timelineKey: `${KEY_PREFIX}:${scope}:timeline`,
    dataKey: `${KEY_PREFIX}:${scope}:data`,
  };
}

export function getGroupMessageRegistryKeys(selfId) {
  const scope = String(selfId ?? "default");
  return {
    registryKey: `${KEY_PREFIX}:${scope}:groups`,
    registryDataKey: `${KEY_PREFIX}:${scope}:group-data`,
  };
}

export function createGroupMessageEventSnapshot(
  event,
  { nowMs = Date.now() } = {}
) {
  if (
    !event?.group_id
    || event.message_type !== "group"
    || !STORED_POST_TYPES.has(event.post_type)
  ) {
    return null;
  }

  const messageId = getMessageIdentifier(
    event.message_id,
    event.message_seq,
    event.real_id,
    event.real_seq
  );
  if (!messageId) return null;

  const snapshot = Object.fromEntries(
    Object.entries(event).filter(([key, value]) => (
      !RUNTIME_EVENT_FIELDS.has(key) && typeof value !== "function"
    ))
  );
  snapshot.time = normalizeTimestampSeconds(event.time, nowMs);

  return JSON.parse(JSON.stringify(snapshot));
}

export function deriveGroupMessageRecord(event) {
  if (!event || typeof event !== "object") return null;

  const time = normalizeTimestampSeconds(event.time);
  const userId = String(event.user_id ?? event.sender?.user_id ?? "unknown");
  const messageId = getMessageIdentifier(
    event.message_id,
    event.message_seq,
    event.real_id,
    event.real_seq
  );
  if (!messageId) return null;
  const messageSeq = getMessageIdentifier(
    event.message_seq,
    event.message_id,
    event.real_seq,
    event.real_id,
    event.seq
  );
  const content = normalizeGroupMessageContent(event.message, event.raw_message);

  return {
    ...event,
    messageId,
    messageSeq,
    realSeq: normalizeMessageIdentifier(event.real_seq),
    selfId: String(event.self_id ?? "default"),
    groupId: String(event.group_id),
    groupName: String(
      event.group_name
        || event.group?.group_name
        || event.group?.name
        || `群 ${event.group_id}`
    ),
    userId,
    senderName: String(
      event.sender?.card
        || event.sender?.nickname
        || userId
    ),
    senderRole: String(event.sender?.role || "member"),
    senderTitle: String(event.sender?.title || ""),
    time,
    message: Array.isArray(event.message) ? event.message : [],
    content,
    textContent: normalizeGroupTextContent(event.message),
    contextContent: normalizeGroupContextContent(event.message),
    contextEligible: isGroupContextEligible(event.message),
    replyToMessageId: getReplyMessageId(event.message),
    atTargets: getAtTargets(event.message),
    isBot: event.post_type === "message_sent"
      || String(event.self_id ?? "") === userId,
  };
}

export async function appendGroupMessage(
  event,
  { redis = null, nowMs = Date.now() } = {}
) {
  const storedEvent = createGroupMessageEventSnapshot(event, { nowMs });
  const record = deriveGroupMessageRecord(storedEvent);
  if (!record) return null;
  const redisClient = await resolveRedis(redis);

  const { timelineKey, dataKey } = getGroupMessageStoreKeys(
    record.selfId,
    record.groupId
  );
  const { registryKey, registryDataKey } = getGroupMessageRegistryKeys(
    record.selfId
  );
  const score = record.time;
  const cutoff = Math.floor(nowMs / 1000) - GROUP_MESSAGE_TTL_SECONDS;

  await redisClient.eval(
    APPEND_MESSAGE_SCRIPT,
    4,
    timelineKey,
    dataKey,
    registryKey,
    registryDataKey,
    record.messageId,
    String(score),
    JSON.stringify(storedEvent),
    String(GROUP_MESSAGE_MAX_COUNT),
    String(GROUP_MESSAGE_TTL_SECONDS),
    String(cutoff),
    record.groupId,
    JSON.stringify({
      selfId: record.selfId,
      groupId: record.groupId,
      groupName: record.groupName,
      lastMessageTime: record.time,
    })
  );

  return storedEvent;
}

function parseJsonObject(payload) {
  if (!payload) return null;
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function parseStoredGroupMessage(payload) {
  const event = parseJsonObject(payload);
  if (
    !event
    || event.message_type !== "group"
    || !STORED_POST_TYPES.has(event.post_type)
  ) {
    return null;
  }
  return deriveGroupMessageRecord(event);
}

export async function getRecentGroupMessages({
  selfId,
  groupId,
  limit = 20,
  scanLimit = GROUP_MESSAGE_MAX_COUNT,
  redis = null,
}) {
  if (groupId == null) return [];

  const redisClient = await resolveRedis(redis);
  const resultLimit = clampInteger(limit, 20, 1, 200);
  const maxScan = clampInteger(
    scanLimit,
    GROUP_MESSAGE_MAX_COUNT,
    1,
    GROUP_MESSAGE_MAX_COUNT
  );
  const { timelineKey, dataKey } = getGroupMessageStoreKeys(selfId, groupId);
  const recentRecords = [];

  for (let offset = 0; offset < maxScan && recentRecords.length < resultLimit;) {
    const batchSize = Math.min(SEARCH_BATCH_SIZE, maxScan - offset);
    const ids = await redisClient.zrevrange(
      timelineKey,
      offset,
      offset + batchSize - 1
    );
    if (!Array.isArray(ids) || ids.length === 0) break;

    const payloads = await redisClient.hmget(dataKey, ...ids);
    for (const payload of payloads || []) {
      const record = parseStoredGroupMessage(payload);
      if (!record || record.contextEligible !== true) continue;
      recentRecords.push(record);
      if (recentRecords.length >= resultLimit) break;
    }

    offset += ids.length;
    if (ids.length < batchSize) break;
  }

  const chronologicalRecords = recentRecords.reverse();
  const replyIds = [...new Set(
    chronologicalRecords
      .map((record) => String(record.replyToMessageId || ""))
      .filter(Boolean)
  )];

  if (replyIds.length === 0) return chronologicalRecords;

  const replyPayloads = await redisClient.hmget(dataKey, ...replyIds);
  const replyRecordMap = new Map();
  replyIds.forEach((id, index) => {
    const replyRecord = parseStoredGroupMessage(replyPayloads?.[index]);
    if (replyRecord) replyRecordMap.set(id, replyRecord);
  });

  return chronologicalRecords.map((record) => ({
    ...record,
    repliedMessage: replyRecordMap.get(String(record.replyToMessageId || "")) || null,
  }));
}

export async function getUserGroupTextMessages({
  selfId,
  groupId,
  userId,
  limit = 100,
  scanLimit = GROUP_MESSAGE_MAX_COUNT,
  excludeMessageId = null,
  excludedTexts = [],
  redis = null,
}) {
  if (groupId == null || userId == null) return [];

  const redisClient = await resolveRedis(redis);
  const resultLimit = clampInteger(limit, 100, 1, 1000);
  const maxScan = clampInteger(
    scanLimit,
    GROUP_MESSAGE_MAX_COUNT,
    1,
    GROUP_MESSAGE_MAX_COUNT
  );
  const excludedTextSet = new Set(
    (Array.isArray(excludedTexts) ? excludedTexts : [])
      .map((text) => String(text || "").trim())
      .filter(Boolean)
  );
  const targetUserId = String(userId);
  const { timelineKey, dataKey } = getGroupMessageStoreKeys(selfId, groupId);
  const userMessages = [];

  for (let offset = 0; offset < maxScan && userMessages.length < resultLimit;) {
    const batchSize = Math.min(SEARCH_BATCH_SIZE, maxScan - offset);
    const ids = await redisClient.zrevrange(
      timelineKey,
      offset,
      offset + batchSize - 1
    );
    if (!Array.isArray(ids) || ids.length === 0) break;

    const payloads = await redisClient.hmget(dataKey, ...ids);
    for (const payload of payloads || []) {
      const record = parseStoredGroupMessage(payload);
      if (!record || String(record.userId) !== targetUserId) continue;
      if (
        excludeMessageId != null
        && String(record.messageId) === String(excludeMessageId)
      ) {
        continue;
      }

      const textContent = String(record.textContent || "").trim();
      if (!textContent || excludedTextSet.has(textContent)) continue;

      userMessages.push({ ...record, textContent });
      if (userMessages.length >= resultLimit) break;
    }

    offset += ids.length;
    if (ids.length < batchSize) break;
  }

  return userMessages.reverse();
}

export async function getGroupMessagesByTimeRange({
  selfId,
  groupId,
  startTime,
  endTime,
  limit = GROUP_MESSAGE_MAX_COUNT,
  excludeMessageId = null,
  redis = null,
}) {
  if (groupId == null) return [];

  const normalizedStartTime = Number(startTime);
  const normalizedEndTime = Number(endTime);
  if (
    !Number.isFinite(normalizedStartTime)
    || !Number.isFinite(normalizedEndTime)
    || normalizedEndTime < normalizedStartTime
  ) {
    return [];
  }

  const redisClient = await resolveRedis(redis);
  const resultLimit = clampInteger(
    limit,
    GROUP_MESSAGE_MAX_COUNT,
    1,
    GROUP_MESSAGE_MAX_COUNT
  );
  const { timelineKey, dataKey } = getGroupMessageStoreKeys(selfId, groupId);
  const ids = await redisClient.zrangebyscore(
    timelineKey,
    String(Math.floor(normalizedStartTime)),
    String(Math.floor(normalizedEndTime)),
    "LIMIT",
    0,
    resultLimit
  );

  if (!Array.isArray(ids) || ids.length === 0) return [];

  const records = [];
  for (let offset = 0; offset < ids.length; offset += SEARCH_BATCH_SIZE) {
    const batchIds = ids.slice(offset, offset + SEARCH_BATCH_SIZE);
    const payloads = await redisClient.hmget(dataKey, ...batchIds);

    for (const payload of payloads || []) {
      const record = parseStoredGroupMessage(payload);
      if (!record) continue;
      if (
        excludeMessageId != null
        && String(record.messageId) === String(excludeMessageId)
      ) {
        continue;
      }
      records.push(record);
    }
  }

  const replyIds = [...new Set(
    records
      .map((record) => String(record.replyToMessageId || ""))
      .filter(Boolean)
  )];
  if (replyIds.length === 0) return records;

  const replyPayloads = await redisClient.hmget(dataKey, ...replyIds);
  const replyRecordMap = new Map();
  replyIds.forEach((id, index) => {
    const replyRecord = parseStoredGroupMessage(replyPayloads?.[index]);
    if (replyRecord) replyRecordMap.set(id, replyRecord);
  });

  return records.map((record) => ({
    ...record,
    repliedMessage: replyRecordMap.get(String(record.replyToMessageId || "")) || null,
  }));
}

export async function getActiveRecordedGroups({
  selfId,
  startTime,
  endTime,
  limit = GROUP_MESSAGE_MAX_COUNT,
  redis = null,
}) {
  const normalizedStartTime = Number(startTime);
  const normalizedEndTime = Number(endTime);
  if (
    !Number.isFinite(normalizedStartTime)
    || !Number.isFinite(normalizedEndTime)
    || normalizedEndTime < normalizedStartTime
  ) {
    return [];
  }

  const redisClient = await resolveRedis(redis);
  const resultLimit = clampInteger(
    limit,
    GROUP_MESSAGE_MAX_COUNT,
    1,
    GROUP_MESSAGE_MAX_COUNT
  );
  const { registryKey, registryDataKey } = getGroupMessageRegistryKeys(selfId);
  const groupIds = await redisClient.zrangebyscore(
    registryKey,
    String(Math.floor(normalizedStartTime)),
    String(Math.floor(normalizedEndTime)),
    "LIMIT",
    0,
    resultLimit
  );
  if (!Array.isArray(groupIds) || groupIds.length === 0) return [];

  const payloads = await redisClient.hmget(registryDataKey, ...groupIds);
  return groupIds.map((groupId, index) => {
    const stored = parseJsonObject(payloads?.[index]);
    return {
      selfId: String(stored?.selfId ?? selfId ?? "default"),
      groupId: String(stored?.groupId ?? groupId),
      groupName: String(stored?.groupName || `群 ${groupId}`),
      lastMessageTime: Number(stored?.lastMessageTime || 0),
    };
  });
}

export async function removeGroupMessage({
  selfId,
  groupId,
  messageId,
  redis = null,
}) {
  if (groupId == null || messageId == null) return false;

  const redisClient = await resolveRedis(redis);
  const { timelineKey, dataKey } = getGroupMessageStoreKeys(selfId, groupId);
  const id = String(messageId);
  const result = await redisClient
    .multi()
    .zrem(timelineKey, id)
    .hdel(dataKey, id)
    .exec();

  return result?.some(([, count]) => Number(count) > 0) || false;
}

function matchesSearch(record, { userId, normalizedKeyword, excludeMessageId }) {
  if (!record || typeof record !== "object") return false;
  if (
    excludeMessageId != null
    && String(record.messageId) === String(excludeMessageId)
  ) {
    return false;
  }
  if (userId != null && String(record.userId) !== String(userId)) {
    return false;
  }
  if (
    normalizedKeyword
    && !String(record.content || "").toLocaleLowerCase().includes(normalizedKeyword)
  ) {
    return false;
  }
  return true;
}

export async function searchGroupMessages({
  selfId,
  groupId,
  userId = null,
  keyword = "",
  limit = 20,
  scanLimit = GROUP_MESSAGE_MAX_COUNT,
  excludeMessageId = null,
  redis = null,
}) {
  if (groupId == null) return [];

  const redisClient = await resolveRedis(redis);
  const resultLimit = clampInteger(limit, 20, 1, 50);
  const maxScan = clampInteger(
    scanLimit,
    GROUP_MESSAGE_MAX_COUNT,
    1,
    GROUP_MESSAGE_MAX_COUNT
  );
  const normalizedKeyword = String(keyword || "")
    .trim()
    .toLocaleLowerCase();
  const normalizedUserId = userId == null || String(userId).trim() === ""
    ? null
    : String(userId).trim();
  const { timelineKey, dataKey } = getGroupMessageStoreKeys(selfId, groupId);
  const results = [];

  for (let offset = 0; offset < maxScan && results.length < resultLimit;) {
    const batchSize = Math.min(SEARCH_BATCH_SIZE, maxScan - offset);
    const ids = await redisClient.zrevrange(
      timelineKey,
      offset,
      offset + batchSize - 1
    );
    if (!Array.isArray(ids) || ids.length === 0) break;

    const payloads = await redisClient.hmget(dataKey, ...ids);
    for (const payload of payloads || []) {
      const record = parseStoredGroupMessage(payload);
      if (
        matchesSearch(record, {
          userId: normalizedUserId,
          normalizedKeyword,
          excludeMessageId,
        })
      ) {
        results.push(record);
        if (results.length >= resultLimit) break;
      }
    }

    offset += ids.length;
    if (ids.length < batchSize) break;
  }

  return results;
}
