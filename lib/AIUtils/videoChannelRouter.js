export const VIDEO_CHANNEL_TYPES = ["grok", "gemini"];

function migrateLegacyConfig(config = {}) {
  if (Array.isArray(config?.grok) || Array.isArray(config?.gemini)) {
    return config;
  }

  const hasLegacyConfig = [
    "baseURL",
    "baseUrl",
    "apiKey",
    "api",
    "videoModel",
    "pollIntervalMs",
    "timeoutMs",
    "preferNativeVideo",
  ].some((key) => Object.hasOwn(config || {}, key));

  if (!hasLegacyConfig) return config;
  return {
    grok: [
      {
        name: "grok-video",
        baseURL: config.baseURL || config.baseUrl,
        api: config.apiKey || config.api,
        model: config.videoModel,
        pollIntervalMs: config.pollIntervalMs,
        timeoutMs: config.timeoutMs,
        preferNativeVideo: config.preferNativeVideo,
      },
    ],
    gemini: [],
  };
}

function parseChannelReference(channelReference) {
  const raw = `${channelReference || ""}`.trim();
  const prefixed = raw.match(/^(grok|gemini):(.+)$/i);

  if (!prefixed) {
    return { provider: null, name: raw };
  }

  return {
    provider: prefixed[1].toLowerCase(),
    name: prefixed[2].trim(),
  };
}

function configuredChannels(channelsConfig, provider) {
  const channels = channelsConfig?.[provider];
  return Array.isArray(channels) ? channels : [];
}

export function normalizeVideoChannelsConfig(channelsConfig = {}) {
  return migrateLegacyConfig(channelsConfig);
}

export function listVideoChannelNames(channelsConfig = {}) {
  const normalizedConfig = normalizeVideoChannelsConfig(channelsConfig);
  return VIDEO_CHANNEL_TYPES.flatMap((provider) =>
    configuredChannels(normalizedConfig, provider)
      .map((channel) => channel?.name)
      .filter(Boolean)
  );
}

export function findVideoChannel(channelsConfig, channelReference) {
  if (!channelsConfig || typeof channelsConfig !== "object") {
    return null;
  }

  const normalizedConfig = normalizeVideoChannelsConfig(channelsConfig);
  const { provider: requestedProvider, name } =
    parseChannelReference(channelReference);

  if (requestedProvider) {
    const channel = configuredChannels(normalizedConfig, requestedProvider).find(
      (item) => item?.name === name
    );
    return channel ? { ...channel, provider: requestedProvider } : null;
  }

  const providerAlias = name.toLowerCase();
  if (VIDEO_CHANNEL_TYPES.includes(providerAlias)) {
    const channel = configuredChannels(normalizedConfig, providerAlias)[0];
    return channel ? { ...channel, provider: providerAlias } : null;
  }

  for (const provider of VIDEO_CHANNEL_TYPES) {
    const channel = configuredChannels(normalizedConfig, provider).find(
      (item) => item?.name === name
    );
    if (channel) {
      return { ...channel, provider };
    }
  }

  return null;
}
