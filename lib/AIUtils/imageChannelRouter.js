export const IMAGE_CHANNEL_TYPES = ["openai", "grok", "gemini", "vertex"];
const IMAGE_CHANNEL_ALIASES = {
  gpt: "openai",
};

function parseChannelReference(channelReference) {
  const raw = `${channelReference || ""}`.trim();
  const prefixed = raw.match(/^(openai|grok|gemini|vertex):(.+)$/i);

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

export function listImageChannelNames(channelsConfig = {}) {
  return IMAGE_CHANNEL_TYPES.flatMap((provider) =>
    configuredChannels(channelsConfig, provider).map((channel) => channel?.name).filter(Boolean)
  );
}

export function findImageChannel(channelsConfig, channelReference) {
  if (!channelsConfig || typeof channelsConfig !== "object") {
    return null;
  }

  const { provider: requestedProvider, name } =
    parseChannelReference(channelReference);

  if (requestedProvider) {
    const channel = configuredChannels(channelsConfig, requestedProvider).find(
      (item) => item?.name === name
    );
    return channel ? { ...channel, provider: requestedProvider } : null;
  }

  const normalizedAlias = name.toLowerCase();
  const providerAlias = IMAGE_CHANNEL_ALIASES[normalizedAlias] || normalizedAlias;
  if (IMAGE_CHANNEL_TYPES.includes(providerAlias)) {
    const channel = configuredChannels(channelsConfig, providerAlias)[0];
    return channel ? { ...channel, provider: providerAlias } : null;
  }

  for (const provider of IMAGE_CHANNEL_TYPES) {
    const channel = configuredChannels(channelsConfig, provider).find(
      (item) => item?.name === name
    );
    if (channel) {
      return { ...channel, provider };
    }
  }

  return null;
}
