const REDIS_BASE_PREFIX = 'AI_ConversationHistory:';
const LAST_INTERACTION_TIME_PREFIX = 'AI_LastInteractionTime:';
const SEVEN_DAYS_IN_SECONDS = 604800;
const MAX_HISTORY_ITEMS_TO_SAVE = 20 * 2;

function getConversationKey(e) {
  return e.group_id ? `${e.group_id}-${e.user_id}` : String(e.user_id);
}

async function getHistoryFromRedis(conversationKey, redisPrefix) {
  const redisKey = `${redisPrefix}${conversationKey}`;
  try {
    const cachedHistory = await redis.get(redisKey);
    if (cachedHistory) {
      return JSON.parse(cachedHistory);
    }
  } catch (err) {
    logger.error(`从Redis读取历史记录失败: ${err}`);
  }
  return [];
}

async function saveHistoryToRedis(conversationKey, history, redisPrefix, expirySeconds) {
  const redisKey = `${redisPrefix}${conversationKey}`;
  try {
    await redis.set(redisKey, JSON.stringify(history), 'EX', expirySeconds);
  } catch (err) {
    logger.error(`向Redis保存历史记录失败: ${err}`);
  }
}

async function clearHistoryInRedis(conversationKey, redisPrefix) {
  const redisKey = `${redisPrefix}${conversationKey}`;
  try {
    await redis.del(redisKey);
  } catch (err) {
    logger.error(`从Redis删除历史记录失败: ${err}`);
  }
}

export async function loadConversationHistory(e, profilePrefix) {
  const conversationKey = getConversationKey(e);
  const fullRedisPrefix = `${REDIS_BASE_PREFIX}${profilePrefix}:`;
  return await getHistoryFromRedis(conversationKey, fullRedisPrefix);
}

export async function saveConversationHistory(e, currentFullHistory, profilePrefix) {
    const conversationKey = getConversationKey(e);
    const fullRedisPrefix = `${REDIS_BASE_PREFIX}${profilePrefix}:`;

    while (currentFullHistory.length > MAX_HISTORY_ITEMS_TO_SAVE) {
        currentFullHistory.shift();
    }
    await saveHistoryToRedis(conversationKey, currentFullHistory, fullRedisPrefix, SEVEN_DAYS_IN_SECONDS);

    if (e.group_id) {
        const timeKey = `${LAST_INTERACTION_TIME_PREFIX}${profilePrefix}:${conversationKey}`;
        try {
            await redis.set(timeKey, Date.now().toString(), 'EX', SEVEN_DAYS_IN_SECONDS);
        } catch (err) {
            logger.error(`保存最后互动时间失败: ${err}`);
        }
    }
}


export async function clearConversationHistory(e, profilePrefix) {
  const conversationKey = getConversationKey(e);
  const fullRedisPrefix = `${REDIS_BASE_PREFIX}${profilePrefix}:`;
  await clearHistoryInRedis(conversationKey, fullRedisPrefix);

  if (e.group_id) {
      const timeKey = `${LAST_INTERACTION_TIME_PREFIX}${profilePrefix}:${conversationKey}`;
      try {
          await redis.del(timeKey);
      } catch (err) {
          logger.error(`删除最后互动时间失败: ${err}`);
      }
  }
}

export async function clearAllPrefixesForUser(e) {
  const conversationKey = getConversationKey(e);
  if (!conversationKey) return;
  try {
    const historyKeys = await redis.keys(`${REDIS_BASE_PREFIX}*:${conversationKey}`);
    const timeKeys = await redis.keys(`${LAST_INTERACTION_TIME_PREFIX}*:${conversationKey}`);
    const allKeysToDelete = [...historyKeys, ...timeKeys];

    if (allKeysToDelete && allKeysToDelete.length > 0) {
      await redis.del(allKeysToDelete);
    }
  } catch (err) {
    logger.error(`清除用户所有历史记录和时间戳失败: ${err}`);
  }
}

export async function clearAllConversationHistories() {
  try {
    const historyKeys = await redis.keys(`${REDIS_BASE_PREFIX}*`);
    const timeKeys = await redis.keys(`${LAST_INTERACTION_TIME_PREFIX}*`);
    const allKeysToDelete = [...historyKeys, ...timeKeys];

    if (allKeysToDelete.length > 0) {
      await redis.del(allKeysToDelete);
    }
  } catch (err) {
    logger.error(`清除全部历史记录和时间戳失败: ${err}`);
  }
}
