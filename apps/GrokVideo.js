import path from "node:path";
import {
  downloadMedia,
  generateGrokVideoAndWait,
} from "../lib/AIUtils/cliProxyMediaClient.js";
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
  options.size = size;

  if (["1280x720", "1792x1024", "1920x1080"].includes(size)) {
    options.aspectRatio = "16:9";
  } else if (["720x1280", "1024x1792", "1080x1920"].includes(size)) {
    options.aspectRatio = "9:16";
  } else if (["1024x1024", "1080x1080"].includes(size)) {
    options.aspectRatio = "1:1";
  }

  if (size.includes("1080") || size.includes("1920")) {
    options.resolution = "1080p";
  } else if (size.includes("720") || size.includes("1280")) {
    options.resolution = "720p";
  }
}

function parseVideoCommand(rawText) {
  const options = {
    aspectRatio: null,
    duration: 6,
    resolution: "720p",
    size: null,
  };
  const promptParts = [];

  for (const part of `${rawText || ""}`.split(/\s+/)) {
    const token = part.trim();
    if (!token) continue;

    const lower = token.toLowerCase();
    const sizeToken = lower.replace("*", "x");

    const durationMatch =
      lower.match(/^(?:duration|seconds|sec|s)=(\d+)$/) ||
      lower.match(/^(\d+)(?:s|sec|secs|second|seconds|\u79d2)?$/);
    if (durationMatch) {
      options.duration = clampDuration(durationMatch[1]);
      continue;
    }

    if (["480p", "720p", "1080p"].includes(lower)) {
      options.resolution = lower;
      continue;
    }

    if (/^\d{3,4}x\d{3,4}$/.test(sizeToken)) {
      applySizeOption(options, sizeToken);
      continue;
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

      const config = Setting.getConfig("CliProxyMedia");
      const result = await generateGrokVideoAndWait(
        {
          prompt,
          imageUrls: imageRefs,
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
        const localPath = await downloadMedia(result.videoURL, targetPath);
        await e.reply(segment.video(localPath));
      } catch (downloadError) {
        logger.warn(
          `[GrokVideo] video download failed, replying with URL: ${downloadError.message}`
        );
        await e.reply(`Grok video: ${result.videoURL}`);
      }
    } catch (error) {
      logger.error("[GrokVideo] CLIProxyAPI video request failed", error);
      await e.reply(`Grok video failed: ${error.message}`, 10, true);
    }

    return true;
  });
}
