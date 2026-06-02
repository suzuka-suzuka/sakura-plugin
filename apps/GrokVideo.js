import path from "node:path";
import {
  downloadMedia,
  generateGrokVideoAndWait,
} from "../lib/AIUtils/cliProxyMediaClient.js";
import { grokRequest } from "../lib/AIUtils/GrokClient.js";
import {
  buildGrokMediaMessages,
  GROK_MEDIA_ROUTE_API,
  GROK_MEDIA_ROUTE_AUTO,
  GROK_MEDIA_ROUTE_WEB,
  parseGrokMediaRouteToken,
  resolveGrokWebConfig,
} from "../lib/AIUtils/grokMediaRouting.js";
import { getImg } from "../lib/utils.js";
import { plugindata } from "../lib/path.js";
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

function clampDuration(value) {
  const duration = Number.parseInt(value, 10);
  if (!Number.isFinite(duration)) return 6;
  return Math.max(1, Math.min(15, duration));
}

function applySizeOption(options, rawSize) {
  const size = rawSize.toLowerCase();
  if (
    ![
      "854x480",
      "480x854",
      "480x480",
      "1280x720",
      "720x1280",
      "720x720",
    ].includes(size)
  ) {
    return false;
  }

  options.size = size;

  if (["854x480", "1280x720"].includes(size)) {
    options.aspectRatio = "16:9";
  } else if (["480x854", "720x1280"].includes(size)) {
    options.aspectRatio = "9:16";
  } else if (["480x480", "720x720"].includes(size)) {
    options.aspectRatio = "1:1";
  }

  if (size.includes("720") || size.includes("1280")) {
    options.resolution = "720p";
  } else if (size.includes("480") || size.includes("854")) {
    options.resolution = "480p";
  }

  return true;
}

function parseVideoCommand(rawText) {
  const options = {
    aspectRatio: null,
    duration: 6,
    resolution: "720p",
    route: GROK_MEDIA_ROUTE_AUTO,
    size: null,
  };
  const promptParts = [];

  for (const part of `${rawText || ""}`.split(/\s+/)) {
    const token = part.trim();
    if (!token) continue;

    const lower = token.toLowerCase();
    const sizeToken = lower.replace("*", "x");

    const route = parseGrokMediaRouteToken(lower);
    if (route) {
      options.route = route;
      continue;
    }

    const durationMatch =
      lower.match(/^(?:duration|seconds|sec|s)=(\d+)$/) ||
      lower.match(/^(\d+)(?:s|sec|secs|second|seconds|\u79d2)?$/);
    if (durationMatch) {
      options.duration = clampDuration(durationMatch[1]);
      continue;
    }

    if (["480p", "720p"].includes(lower)) {
      options.resolution = lower;
      continue;
    }

    if (/^\d{3,4}x\d{3,4}$/.test(sizeToken)) {
      if (applySizeOption(options, sizeToken)) {
        continue;
      }
    }

    if (ASPECT_RATIOS.has(lower)) {
      options.aspectRatio = normalizeAspectRatio(lower);
      continue;
    }

    promptParts.push(token);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options,
  };
}

function videoExtensionFromURL(url) {
  const dataMatch = `${url}`.match(/^data:video\/([^;]+)/i);
  if (dataMatch?.[1]) {
    return dataMatch[1] === "quicktime" ? "mov" : dataMatch[1].toLowerCase();
  }

  const urlMatch = `${url}`.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  if (["mp4", "webm", "mov"].includes(urlMatch?.[1]?.toLowerCase())) {
    return urlMatch[1].toLowerCase();
  }

  return "mp4";
}

async function generateViaWeb(prompt, options, images, e) {
  const result = await grokRequest(
    {
      model: "grok-imagine-video",
      messages: buildGrokMediaMessages(prompt, images),
      videoOptions: {
        prompt,
        durationSec: options.duration,
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
        size: options.size,
      },
    },
    resolveGrokWebConfig(),
    e
  );

  const video = (result.videos || []).find((item) => item?.localPath || item?.url);
  const source = video?.localPath || video?.url;
  if (!source) {
    throw new Error(result.text || "Grok web did not return video output.");
  }

  return source;
}

async function generateViaOpenAICompatible(prompt, options, images) {
  const config = Setting.getConfig("CliProxyMedia");
  const result = await generateGrokVideoAndWait(
    {
      prompt,
      imageUrls: images,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      native: true,
    },
    config
  );

  const extension = videoExtensionFromURL(result.videoURL);
  const targetPath = path.join(
    plugindata,
    "grok",
    "videos",
    `video_${Date.now()}.${extension}`
  );

  try {
    return await downloadMedia(result.videoURL, targetPath);
  } catch (downloadError) {
    logger.warn(
      `[GrokVideo] video download failed, replying with URL: ${downloadError.message}`
    );
    return result.videoURL;
  }
}

async function replyVideoSource(e, videoSource) {
  if (/^https?:\/\//i.test(videoSource) || /^data:video\//i.test(videoSource)) {
    await e.reply(`Grok video: ${videoSource}`);
    return;
  }

  await e.reply(segment.video(videoSource));
}

export class GrokVideo extends plugin {
  constructor() {
    super({
      name: "Grok Video",
      event: "message",
      priority: 1000,
    });
  }

  generateVideo = Command(/^#gv(.*)/, async (e) => {
    const match = e.msg.match(/^#gv(.*)/);
    if (!match) return false;

    try {
      const { prompt, options } = parseVideoCommand(match[1]);
      const imageRefs = (await getImg(e, true, true)) || [];
      if (!prompt && imageRefs.length === 0) {
        return false;
      }

      await e.react(124);

      let webError = null;

      if (options.route !== GROK_MEDIA_ROUTE_API) {
        try {
          const videoSource = await generateViaWeb(prompt, options, imageRefs, e);
          await replyVideoSource(e, videoSource);
          return true;
        } catch (error) {
          webError = error;
          const suffix =
            options.route === GROK_MEDIA_ROUTE_WEB
              ? ""
              : ", falling back to OpenAI-compatible API";
          logger.warn(`[GrokVideo] web video request failed${suffix}: ${error.message}`);

          if (options.route === GROK_MEDIA_ROUTE_WEB) {
            throw error;
          }
        }
      }

      const videoSource = await generateViaOpenAICompatible(
        prompt,
        options,
        imageRefs
      );

      await replyVideoSource(e, videoSource);

      if (webError) {
        logger.info("[GrokVideo] OpenAI-compatible fallback succeeded.");
      }
    } catch (error) {
      logger.error("[GrokVideo] video request failed", error);
      await e.reply(`Grok video failed: ${error.message}`, 10, true);
    }

    return true;
  });
}
