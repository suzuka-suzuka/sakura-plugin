function cloneMessage(message) {
  if (!Array.isArray(message)) return [];

  return message.map((segment) => {
    if (!segment || typeof segment !== "object") return segment;
    const data = segment.data && typeof segment.data === "object"
      ? { ...segment.data }
      : segment.data;
    return { ...segment, data };
  });
}

function getHttpImageUrl(data) {
  for (const value of [data?.url, data?.file]) {
    const url = String(value || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function normalizeRkey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const match = raw.match(/(?:^|[?&])rkey=([^&]*)/i);
  if (!match) return raw;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function getGroupRkey(response) {
  const data = response?.data ?? response;

  if (data && !Array.isArray(data) && typeof data === "object") {
    const direct = data.group_rkey ?? data.groupRkey ?? data.group;
    if (direct && typeof direct === "object") {
      return normalizeRkey(direct.rkey ?? direct.key);
    }
    if (direct) return normalizeRkey(direct);
  }

  const entries = Array.isArray(data)
    ? data
    : Array.isArray(data?.rkeys)
      ? data.rkeys
      : [];
  const groupEntry = entries.find((entry) => {
    const type = entry?.type;
    return String(type).toLowerCase() === "group" || Number(type) === 20;
  });

  return normalizeRkey(groupEntry?.rkey ?? groupEntry?.key);
}

function replaceRkey(url, rkey) {
  const normalizedRkey = normalizeRkey(rkey);
  if (!url || !normalizedRkey) return "";

  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("rkey")) return "";
    parsed.searchParams.set("rkey", normalizedRkey);
    return parsed.toString();
  } catch {
    return "";
  }
}

async function getMilkyResourceUrls(bot, resourceIds) {
  const urls = new Map();
  if (typeof bot?.getResourceTempUrl !== "function") return urls;

  await Promise.all([...resourceIds].map(async (resourceId) => {
    try {
      const result = await bot.getResourceTempUrl({ resource_id: resourceId });
      const url = typeof result === "string"
        ? result
        : result?.url ?? result?.temp_url;
      if (url) urls.set(resourceId, String(url));
    } catch {
      // 刷新失败时保留原链接，让转发仍有机会成功。
    }
  }));

  return urls;
}

async function getOb11GroupRkey(bot, shouldRequest) {
  if (!shouldRequest || typeof bot?.sendRequest !== "function") return "";

  try {
    return getGroupRkey(await bot.sendRequest("get_rkey", {}));
  } catch {
    return "";
  }
}

/**
 * 刷新 Redis 中历史消息的图片地址，只修改本次发送使用的消息副本。
 * Milky 使用 resource_id 换取临时地址；OB11 群图片统一替换本次获取的群 rkey。
 */
export async function refreshGroupMessageImages(bot, messages) {
  const refreshedMessages = (Array.isArray(messages) ? messages : [])
    .map(cloneMessage);
  const milkyImages = [];
  const ob11Images = [];
  const resourceIds = new Set();

  for (const message of refreshedMessages) {
    for (const segment of message) {
      if (segment?.type !== "image" || !segment.data) continue;

      const resourceId = String(segment.data.resource_id || "").trim();
      if (resourceId) {
        resourceIds.add(resourceId);
        milkyImages.push({ data: segment.data, resourceId });
        continue;
      }

      const url = getHttpImageUrl(segment.data);
      if (url && /(?:[?&])rkey=/i.test(url)) {
        ob11Images.push({ data: segment.data, url });
      }
    }
  }

  const [resourceUrls, groupRkey] = await Promise.all([
    getMilkyResourceUrls(bot, resourceIds),
    getOb11GroupRkey(bot, ob11Images.length > 0),
  ]);

  for (const { data, resourceId } of milkyImages) {
    const url = resourceUrls.get(resourceId);
    if (!url) continue;
    data.file = url;
    data.url = url;
  }

  if (groupRkey) {
    for (const { data, url } of ob11Images) {
      const refreshedUrl = replaceRkey(url, groupRkey);
      if (!refreshedUrl) continue;
      data.file = refreshedUrl;
      data.url = refreshedUrl;
    }
  }

  return refreshedMessages;
}
