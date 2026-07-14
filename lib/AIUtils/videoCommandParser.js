export const VALID_VIDEO_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
];

const ASPECT_RATIO_ALIASES = {
  square: "1:1",
  landscape: "16:9",
  portrait: "9:16",
};

const VIDEO_SIZES = new Set([
  "854x480",
  "480x854",
  "480x480",
  "1280x720",
  "720x1280",
  "720x720",
]);

function clampDuration(value) {
  const duration = Number.parseInt(value, 10);
  if (!Number.isFinite(duration)) return 6;
  return Math.max(1, Math.min(15, duration));
}

function extractChannel(text) {
  const matched = text.match(/(?:^|\s)(grok|gemini)(?=\s|$)/i);
  if (!matched) {
    return { channel: null, text };
  }

  return {
    channel: matched[1].toLowerCase(),
    text: text.replace(matched[0], " ").replace(/\s+/g, " ").trim(),
  };
}

function applySizeOption(options, size) {
  if (!VIDEO_SIZES.has(size)) return false;
  options.size = size;

  if (["854x480", "1280x720"].includes(size)) {
    options.aspectRatio = "16:9";
  } else if (["480x854", "720x1280"].includes(size)) {
    options.aspectRatio = "9:16";
  } else {
    options.aspectRatio = "1:1";
  }

  options.resolution = size.includes("720") || size.includes("1280")
    ? "720p"
    : "480p";
  return true;
}

export function parseVideoCommandArgs(rawText) {
  let text = `${rawText || ""}`.replace(/：/g, ":").trim();
  const extractedChannel = extractChannel(text);
  text = extractedChannel.text;

  const options = {
    aspectRatio: null,
    duration: 6,
    resolution: "720p",
    size: null,
  };
  const promptParts = [];

  for (const part of text.split(/\s+/)) {
    const token = part.trim();
    if (!token) continue;

    const lower = token.toLowerCase();
    const sizeToken = lower.replace("*", "x");
    const durationMatch =
      lower.match(/^(?:duration|seconds|sec|s)=(\d+)$/) ||
      lower.match(/^(\d+)(?:s|sec|secs|second|seconds|秒)$/);

    if (durationMatch) {
      options.duration = clampDuration(durationMatch[1]);
      continue;
    }
    if (["480p", "720p", "1080p"].includes(lower)) {
      options.resolution = lower;
      continue;
    }
    if (/^\d{3,4}x\d{3,4}$/.test(sizeToken)) {
      if (applySizeOption(options, sizeToken)) continue;
    }

    const normalizedRatio = ASPECT_RATIO_ALIASES[lower] || lower;
    if (VALID_VIDEO_ASPECT_RATIOS.includes(normalizedRatio)) {
      options.aspectRatio = normalizedRatio;
      continue;
    }

    promptParts.push(token);
  }

  return {
    channel: extractedChannel.channel,
    prompt: promptParts.join(" ").trim(),
    options,
  };
}
