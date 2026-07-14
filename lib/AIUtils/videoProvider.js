import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import Setting from "../setting.js";
import { plugindata } from "../path.js";
import {
  downloadMedia,
  generateGrokVideoAndWait,
} from "./cliProxyMediaClient.js";
import {
  findVideoChannel,
  listVideoChannelNames,
} from "./videoChannelRouter.js";
import { tagMediaError } from "./mediaErrorMessages.js";
import {
  buildGeminiClientOptions,
  DEFAULT_VERTEX_LOCATION,
} from "./vertexAuth.js";
import { VIDEO_GENERATION_TIMEOUT_MS } from "./videoGenerationConstants.js";

const GEMINI_OMNI_MODEL = "gemini-omni-flash-preview";
const GEMINI_ASPECT_RATIOS = new Set(["16:9", "9:16"]);
const VIDEO_REFERENCE_LIMITS = {
  grok: 7,
  gemini: 10,
};

function resolveVideoConfig(requestedChannel = null) {
  const featureConfig = Setting.getConfig("EditImage");
  const channelName = `${
    requestedChannel || featureConfig.videoChannel || "grok"
  }`.trim();
  const channelsConfig = Setting.getConfig("CliProxyMedia");
  const channel = findVideoChannel(channelsConfig, channelName);
  if (channel) return channel;

  const availableChannels = listVideoChannelNames(channelsConfig);
  const availableText = availableChannels.length > 0
    ? ` 可用渠道：${availableChannels.join("、")}。`
    : "";
  throw new Error(`未找到名为 "${channelName}" 的视频渠道。${availableText}`);
}

function dataUrlParts(value) {
  const matched = `${value || ""}`.match(/^data:([^;]+);base64,(.+)$/is);
  if (!matched) return null;
  return { mimeType: matched[1], data: matched[2] };
}

async function normalizeImageInput(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) {
    return { type: "image", data: input.toString("base64"), mime_type: "image/png" };
  }
  if (typeof input === "string") {
    const inline = dataUrlParts(input);
    if (inline) {
      return { type: "image", data: inline.data, mime_type: inline.mimeType };
    }
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`参考图下载失败：HTTP ${response.status}`);
    }
    return {
      type: "image",
      data: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mime_type: response.headers.get("content-type") || "image/jpeg",
    };
  }
  if (input.base64) {
    const inline = dataUrlParts(input.base64);
    return {
      type: "image",
      data: inline?.data || `${input.base64}`,
      mime_type: input.mimeType || inline?.mimeType || "image/jpeg",
    };
  }
  if (input.inlineData?.data) {
    return {
      type: "image",
      data: input.inlineData.data,
      mime_type: input.inlineData.mimeType || "image/jpeg",
    };
  }
  if (input.buffer) {
    const buffer = Buffer.isBuffer(input.buffer)
      ? input.buffer
      : Buffer.from(input.buffer);
    return {
      type: "image",
      data: buffer.toString("base64"),
      mime_type: input.mimeType || "image/png",
    };
  }
  if (input.url) return normalizeImageInput(input.url);
  return null;
}

async function buildGeminiInput(prompt, images = []) {
  const normalizedImages = (
    await Promise.all(images.slice(0, 10).map(normalizeImageInput))
  ).filter(Boolean);
  const promptText = `${prompt || ""}`.trim() ||
    "Animate the provided image into a natural, coherent video.";

  if (normalizedImages.length === 0) {
    return { input: promptText, imageCount: 0 };
  }

  return {
    input: [...normalizedImages, { type: "text", text: promptText }],
    imageCount: normalizedImages.length,
  };
}

export function normalizeVideoGenerationOptions(
  provider,
  options = {},
  imageCount = 0,
  modelName = ""
) {
  const normalized = { ...options };
  const warnings = [];
  const referenceLimit = VIDEO_REFERENCE_LIMITS[provider];
  const model = `${modelName || ""}`.toLowerCase();
  let imageLimit = referenceLimit || imageCount;

  if (referenceLimit && imageCount > referenceLimit) {
    warnings.push(
      `${provider === "gemini" ? "Gemini Omni" : "Grok"} 最多支持 ${referenceLimit} 张参考图，已忽略其余 ${imageCount - referenceLimit} 张`
    );
  }

  if (provider === "gemini") {
    if (normalized.aspectRatio === "auto") {
      normalized.aspectRatio = null;
      warnings.push("Gemini Omni 不支持 auto 比例，已省略并使用默认 16:9");
    } else if (
      normalized.aspectRatio &&
      !GEMINI_ASPECT_RATIOS.has(normalized.aspectRatio)
    ) {
      warnings.push(
        `Gemini Omni 不支持 ${normalized.aspectRatio} 比例，已省略并使用默认 16:9`
      );
      normalized.aspectRatio = null;
    }

    if (normalized.resolution && normalized.resolution !== "720p") {
      warnings.push(
        `Gemini Omni 不支持 ${normalized.resolution}，已省略并使用固定的 720p`
      );
      normalized.resolution = null;
    }

    const duration = Number.parseInt(normalized.duration, 10);
    if (Number.isFinite(duration) && (duration < 3 || duration > 10)) {
      warnings.push(
        `Gemini Omni 不支持 ${duration} 秒时长，已省略并使用模型默认时长`
      );
      normalized.duration = null;
    }
  }

  if (provider === "grok") {
    if (normalized.aspectRatio === "auto") {
      normalized.aspectRatio = null;
      warnings.push("Grok 视频不接受 auto 比例，已省略并使用模型默认比例");
    }

    if (model.includes("video-1.5") && imageCount > 1) {
      imageLimit = 1;
      warnings.push(
        `${modelName} 不支持多参考图模式，已仅保留第 1 张参考图`
      );
    }

    const usesMultipleReferences = Math.min(imageCount, imageLimit) > 1;
    if (
      usesMultipleReferences &&
      Number.parseInt(normalized.duration, 10) > 10
    ) {
      warnings.push(
        `Grok 多参考图模式不支持 ${normalized.duration} 秒时长，已省略并使用模型默认时长`
      );
      normalized.duration = null;
    }

    if (
      normalized.resolution === "1080p" &&
      !(model.includes("video-1.5") && imageLimit === 1 && imageCount === 1)
    ) {
      normalized.resolution = null;
      warnings.push(
        "当前 Grok 模型或生成模式不支持 1080p，已省略并使用模型默认分辨率"
      );
    }
  }

  return {
    options: normalized,
    imageLimit,
    warnings,
  };
}

async function notifyParameterWarnings(callback, warnings) {
  if (warnings.length > 0 && typeof callback === "function") {
    await callback(warnings);
  }
}

function extractVideoOutput(interaction) {
  if (interaction?.output_video) return interaction.output_video;

  for (let index = (interaction?.steps || []).length - 1; index >= 0; index--) {
    const step = interaction.steps[index];
    const video = step?.content?.find((item) => item?.type === "video");
    if (video) return video;
  }
  return null;
}

export async function generateGeminiOmniVideo(
  { prompt, images = [], options = {} },
  channelConfig = {}
) {
  if (!channelConfig.serviceAccountRef) {
    throw new Error("Gemini Omni 视频渠道未选择 Vertex 服务账号凭证。");
  }

  const { input, imageCount } = await buildGeminiInput(prompt, images);
  const ai = new GoogleGenAI(
    buildGeminiClientOptions({
      ...channelConfig,
      vertex: true,
      location: DEFAULT_VERTEX_LOCATION,
    })
  );

  let interaction;
  try {
    interaction = await ai.interactions.create(
      {
        model: channelConfig.model || GEMINI_OMNI_MODEL,
        input,
        response_format: {
          type: "video",
          delivery: "inline",
          ...(options.aspectRatio && {
            aspect_ratio: options.aspectRatio,
          }),
          ...(options.duration && {
            duration: `${options.duration}s`,
          }),
        },
        generation_config: {
          video_config: {
            task: imageCount === 0
              ? "text_to_video"
              : imageCount === 1
                ? "image_to_video"
                : "reference_to_video",
          },
        },
        background: false,
        store: false,
        stream: false,
      },
      {
        timeout: VIDEO_GENERATION_TIMEOUT_MS,
        maxRetries: 0,
      }
    );
  } catch (error) {
    throw tagMediaError(error, "gemini", "video");
  }

  const videoOutput = extractVideoOutput(interaction);
  if (!videoOutput?.data) {
    const status = interaction?.status ? `，状态：${interaction.status}` : "";
    const uriHint = videoOutput?.uri ? "，接口返回了 URI 而非内联视频" : "";
    throw new Error(`Gemini Omni 没有返回视频数据${status}${uriHint}。`);
  }

  return {
    buffer: Buffer.from(videoOutput.data, "base64"),
    mimeType: videoOutput.mime_type || "video/mp4",
    interaction,
  };
}

function extensionFromMimeType(mimeType = "video/mp4") {
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  return "mp4";
}

function extensionFromURL(url) {
  const dataMatch = `${url}`.match(/^data:video\/([^;]+)/i);
  if (dataMatch?.[1]) return extensionFromMimeType(`video/${dataMatch[1]}`);
  const urlMatch = `${url}`.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  if (["mp4", "webm", "mov"].includes(urlMatch?.[1]?.toLowerCase())) {
    return urlMatch[1].toLowerCase();
  }
  return "mp4";
}

async function saveVideoBuffer(buffer, provider, extension = "mp4") {
  const targetPath = path.join(
    plugindata,
    provider,
    "videos",
    `video_${Date.now()}.${extension}`
  );
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

async function generateWithGrok(channel, prompt, images, options) {
  const result = await generateGrokVideoAndWait(
    {
      prompt,
      imageUrls: images,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      model: channel.model,
      native: channel.preferNativeVideo,
    },
    channel
  );

  const targetPath = path.join(
    plugindata,
    "grok",
    "videos",
    `video_${Date.now()}.${extensionFromURL(result.videoURL)}`
  );
  try {
    return await downloadMedia(result.videoURL, targetPath);
  } catch (error) {
    logger.warn(`[VideoProvider] Grok 视频下载失败，返回原始链接：${error.message}`);
    return result.videoURL;
  }
}

export async function generateVideoWithProvider({
  channel: requestedChannel = null,
  prompt,
  images = [],
  options = {},
  onParameterWarnings = null,
}) {
  const channel = resolveVideoConfig(requestedChannel);
  const normalized = normalizeVideoGenerationOptions(
    channel.provider,
    options,
    images.length,
    channel.model
  );
  await notifyParameterWarnings(onParameterWarnings, normalized.warnings);
  const compatibleImages = images.slice(0, normalized.imageLimit);
  const compatibleOptions = normalized.options;

  if (channel.provider === "grok") {
    try {
      return {
        provider: "grok",
        source: await generateWithGrok(
          channel,
          prompt,
          compatibleImages,
          compatibleOptions
        ),
      };
    } catch (error) {
      throw tagMediaError(error, "grok", "video");
    }
  }
  if (channel.provider === "gemini") {
    try {
      const result = await generateGeminiOmniVideo(
        { prompt, images: compatibleImages, options: compatibleOptions },
        channel
      );
      return {
        provider: "gemini",
        source: await saveVideoBuffer(
          result.buffer,
          "gemini",
          extensionFromMimeType(result.mimeType)
        ),
      };
    } catch (error) {
      throw tagMediaError(error, "gemini", "video");
    }
  }

  throw new Error(`不支持的视频渠道类型：${channel.provider || "unknown"}`);
}
