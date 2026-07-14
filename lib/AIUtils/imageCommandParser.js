export const VALID_IMAGE_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
];

function clampImageCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(6, count));
}

function extractChannel(text) {
  const matched = text.match(/(?:^|\s)(grok|gpt|gemini|vertex)(?=\s|$)/i);
  if (!matched) {
    return { channel: null, text };
  }

  return {
    channel: matched[1].toLowerCase(),
    text: text.replace(matched[0], " ").replace(/\s+/g, " ").trim(),
  };
}

export function parseImageCommandArgs(rawText) {
  let promptText = `${rawText || ""}`.replace(/：/g, ":").trim();
  const extractedChannel = extractChannel(promptText);
  const channel = extractedChannel.channel;
  promptText = extractedChannel.text;

  let aspectRatio = null;
  let imageSize = null;
  let count = 1;

  const ratioRegex = new RegExp(
    `(?:^|\\s)(${VALID_IMAGE_ASPECT_RATIOS.join("|")})(?=\\s|$)`,
    "i"
  );
  const ratioMatch = promptText.match(ratioRegex);
  if (ratioMatch) {
    aspectRatio = ratioMatch[1].toLowerCase();
    promptText = promptText.replace(ratioMatch[0], " ").trim();
  }

  const sizeMatch = promptText.match(/(?:^|\s)([124]k)(?=\s|$)/i);
  if (sizeMatch) {
    imageSize = sizeMatch[1].toUpperCase();
    promptText = promptText.replace(sizeMatch[0], " ").trim();
  }

  const countMatch = promptText.match(
    /(?:^|\s)(?:(?:--)?(?:n|count)=)(\d+)(?=\s|$)/i
  );
  if (countMatch) {
    count = clampImageCount(countMatch[1]);
    promptText = promptText.replace(countMatch[0], " ").trim();
  }

  return {
    aspectRatio,
    imageSize,
    count,
    channel,
    promptText: promptText.replace(/\s+/g, " ").trim(),
  };
}
