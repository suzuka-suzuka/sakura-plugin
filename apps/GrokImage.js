import { generateGrokImage } from "../lib/AIUtils/cliProxyMediaClient.js";
import { getImg } from "../lib/utils.js";
import Setting from "../lib/setting.js";

const ASPECT_RATIOS = new Set([
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "square",
  "landscape",
  "portrait",
]);

function normalizeAspectRatio(token) {
  if (token === "square") return "1:1";
  if (token === "landscape") return "16:9";
  if (token === "portrait") return "9:16";
  return token;
}

function clampCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(6, count));
}

function parseImageCommand(rawText) {
  const options = {
    aspectRatio: null,
    resolution: null,
    n: 1,
    quality: false,
  };
  const promptParts = [];

  for (const part of `${rawText || ""}`.split(/\s+/)) {
    const token = part.trim();
    if (!token) continue;

    const lower = token.toLowerCase();
    const countMatch = lower.match(/^(?:--)?(?:n|count)=(\d+)$/);
    if (countMatch) {
      options.n = clampCount(countMatch[1]);
      continue;
    }

    if (ASPECT_RATIOS.has(lower)) {
      options.aspectRatio = normalizeAspectRatio(lower);
      continue;
    }

    if (["pro", "quality", "hd", "high"].includes(lower)) {
      options.quality = true;
      continue;
    }

    if (["fast", "standard"].includes(lower)) {
      options.quality = false;
      continue;
    }

    if (["1k", "2k"].includes(lower)) {
      options.resolution = lower;
      continue;
    }

    promptParts.push(token);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options,
  };
}

function toImageReferences(images = []) {
  return images
    .filter((image) => image?.base64)
    .map((image) => ({
      base64: image.base64,
      mimeType: image.mimeType || "image/png",
    }));
}

export class GrokImage extends plugin {
  constructor() {
    super({
      name: "Grok Image",
      event: "message",
      priority: 1135,
    });
  }

  editImage = Command(/^#gi\s*(.+)/, async (e) => {
    const match = e.msg.match(/^#gi\s*(.+)/);
    if (!match) return false;

    const { prompt, options } = parseImageCommand(match[1]);
    if (!prompt) {
      await e.reply("Grok image prompt is required.", true, { recallMsg: 10 });
      return true;
    }

    await e.react(124);

    try {
      const imgBase64List = (await getImg(e, true, true)) || [];
      const config = Setting.getConfig("CliProxyMedia");
      const result = await generateGrokImage(
        {
          prompt,
          images: toImageReferences(imgBase64List),
          aspectRatio: options.aspectRatio,
          resolution: options.resolution,
          n: options.n,
          quality: options.quality,
          responseFormat: "b64_json",
        },
        config
      );

      await e.reply(result.buffers.map((buffer) => segment.image(buffer)));
    } catch (error) {
      logger.error("[GrokImage] CLIProxyAPI image request failed", error);
      await e.reply(`Grok image failed: ${error.message}`, true, {
        recallMsg: 10,
      });
    }

    return true;
  });
}
