import { generateGrokImage } from "../lib/AIUtils/cliProxyMediaClient.js";
import { formatGrokUserError } from "../lib/AIUtils/grokErrorMessages.js";
import { grokRequest } from "../lib/AIUtils/GrokClient.js";
import {
  buildGrokMediaMessages,
  GROK_MEDIA_ROUTE_API,
  GROK_MEDIA_ROUTE_AUTO,
  GROK_MEDIA_ROUTE_WEB,
  parseGrokMediaRouteToken,
  resolveGrokMediaRoute,
  resolveGrokWebConfig,
} from "../lib/AIUtils/grokMediaRouting.js";
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
    route: GROK_MEDIA_ROUTE_AUTO,
  };
  const promptParts = [];

  for (const part of `${rawText || ""}`.split(/\s+/)) {
    const token = part.trim();
    if (!token) continue;

    const lower = token.toLowerCase();
    const route = parseGrokMediaRouteToken(lower);
    if (route) {
      options.route = route;
      continue;
    }

    const countMatch = lower.match(/^(?:--)?(?:n|count)=(\d+)$/);
    if (countMatch) {
      options.n = clampCount(countMatch[1]);
      continue;
    }

    if (ASPECT_RATIOS.has(lower)) {
      options.aspectRatio = normalizeAspectRatio(lower);
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

async function generateViaWeb(prompt, options, images, e) {
  const result = await grokRequest(
    {
      model: "grok-imagine-image",
      messages: buildGrokMediaMessages(prompt, images),
      imageOptions: {
        prompt,
        aspectRatio: options.aspectRatio,
        count: options.n,
        enablePro: options.resolution === "2k" ? true : undefined,
      },
    },
    resolveGrokWebConfig(),
    e
  );

  const imageSources = (result.images || [])
    .map((image) => image.localPath || image.url)
    .filter(Boolean);

  if (imageSources.length === 0) {
    throw new Error(
      result.text ||
        "Grok 网页没有返回图片，可能是提示词被拦截、额度不足，或页面状态异常。"
    );
  }

  return imageSources;
}

async function generateViaOpenAICompatible(prompt, options, images) {
  const config = Setting.getConfig("CliProxyMedia");
  const result = await generateGrokImage(
    {
      prompt,
      images: toImageReferences(images),
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      n: options.n,
      responseFormat: "b64_json",
    },
    config
  );

  return result.buffers;
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
      await e.reply("请输入图片提示词，例如：#gi 16:9 赛博城市夜景。", 10, true);
      return true;
    }

    await e.react(124);

    try {
      const imgBase64List = (await getImg(e, true, true)) || [];
      const route = resolveGrokMediaRoute(options.route);

      if (route === GROK_MEDIA_ROUTE_WEB) {
        const imageSources = await generateViaWeb(prompt, options, imgBase64List, e);
        await e.reply(imageSources.map((source) => segment.image(source)));
        return true;
      }

      if (route === GROK_MEDIA_ROUTE_API) {
        const buffers = await generateViaOpenAICompatible(
          prompt,
          options,
          imgBase64List
        );
        await e.reply(buffers.map((buffer) => segment.image(buffer)));
        return true;
      }

      throw new Error(`Grok 媒体渠道不支持：${route}`);
    } catch (error) {
      logger.error("[GrokImage] image request failed", error);
      await e.reply(
        `Grok 图片生成失败：${formatGrokUserError(error, "image")}`,
        10,
        true
      );
    }

    return true;
  });
}
