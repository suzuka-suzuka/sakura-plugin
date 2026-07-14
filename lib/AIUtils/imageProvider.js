import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import Setting from "../setting.js";
import { generateGrokImage } from "./cliProxyMediaClient.js";
import {
  findImageChannel,
  listImageChannelNames,
} from "./imageChannelRouter.js";
import { tagMediaError } from "./mediaErrorMessages.js";
import {
  buildGeminiClientOptions,
  DEFAULT_VERTEX_LOCATION,
} from "./vertexAuth.js";

const PORTRAIT_RATIOS = new Set(["2:3", "3:4", "4:5", "9:16"]);
const LANDSCAPE_RATIOS = new Set(["3:2", "4:3", "5:4", "16:9", "21:9"]);
const GROK_IMAGE_ASPECT_RATIOS = new Set([
  "auto",
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
]);
const GPT_IMAGE_2_MAX_PIXELS = 8294400;
const GPT_IMAGE_2_2K_MAX_PIXELS = 4194304;

const channelApiKeyIndex = new Map();

function normalizeProvider(provider) {
  return provider || "gemini";
}

function imageProviderName(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "grok") return "Grok";
  if (provider === "vertex") return "Vertex";
  return "Gemini";
}

function normalizeLegacyOpenAIAspectRatio(aspectRatio) {
  if (!aspectRatio || aspectRatio === "1:1") return aspectRatio;
  if (PORTRAIT_RATIOS.has(aspectRatio)) return "2:3";
  if (LANDSCAPE_RATIOS.has(aspectRatio)) return "3:2";
  return "1:1";
}

export function normalizeImageGenerationOptions(
  provider,
  modelName,
  options = {},
  sourceImageCount = 0
) {
  const normalized = { ...options };
  const warnings = [];
  const model = `${modelName || ""}`.toLowerCase();
  const providerName = imageProviderName(provider);
  let sourceImageLimit = sourceImageCount;

  if (
    provider === "openai" &&
    model.includes("gpt-image-2") &&
    normalized.aspectRatio === "auto" &&
    normalized.imageSize
  ) {
    normalized.aspectRatio = null;
    warnings.push(
      `GPT Image 2 无法同时使用 auto 比例和 ${normalized.imageSize} 尺寸等级，已省略 auto 并按方形尺寸生成`
    );
  }

  if (provider === "gemini" || provider === "vertex") {
    if (normalized.aspectRatio === "auto") {
      normalized.aspectRatio = null;
      warnings.push(`${providerName} 生图不接受 auto 比例，已省略比例参数`);
    }

    if (Number.isInteger(normalized.count) && normalized.count > 1) {
      normalized.count = 1;
      warnings.push(`${providerName} 当前接口不支持 n=${options.count}，已改为生成 1 张`);
    }

    const onlySupports1K =
      model.includes("gemini-2.5-flash-image") ||
      model.includes("gemini-3.1-flash-lite-image");
    if (
      onlySupports1K &&
      normalized.imageSize &&
      normalized.imageSize !== "1K"
    ) {
      warnings.push(
        `${modelName} 不支持 ${normalized.imageSize}，已省略清晰度参数并使用模型默认值`
      );
      normalized.imageSize = null;
    }
  }

  if (provider === "grok") {
    if (
      normalized.aspectRatio &&
      !GROK_IMAGE_ASPECT_RATIOS.has(normalized.aspectRatio)
    ) {
      warnings.push(
        `Grok 生图不支持 ${normalized.aspectRatio} 比例，已省略并使用模型默认比例`
      );
      normalized.aspectRatio = null;
    }

    if (normalized.imageSize === "4K") {
      normalized.imageSize = "2K";
      warnings.push("Grok 生图不支持 4K，已改为 2K");
    }

    if (sourceImageCount > 3) {
      sourceImageLimit = 3;
      warnings.push(
        `Grok 图片编辑最多支持 3 张参考图，已忽略其余 ${sourceImageCount - 3} 张`
      );
    }
  }

  const legacyGptImage =
    provider === "openai" &&
    model.includes("gpt-image") &&
    !model.includes("gpt-image-2");
  if (legacyGptImage) {
    if (normalized.aspectRatio && normalized.aspectRatio !== "auto") {
      const supportedRatio = normalizeLegacyOpenAIAspectRatio(
        normalized.aspectRatio
      );
      if (supportedRatio !== normalized.aspectRatio) {
        warnings.push(
          `${modelName} 不支持 ${normalized.aspectRatio}，已调整为 ${supportedRatio}`
        );
        normalized.aspectRatio = supportedRatio;
      }
    }

    if (["2K", "4K"].includes(normalized.imageSize)) {
      warnings.push(
        `${modelName} 不支持 ${normalized.imageSize} 清晰度参数，已省略并使用模型默认值`
      );
      normalized.imageSize = null;
    }
  }

  if (provider === "openai" && model.includes("dall-e-3")) {
    if (normalized.aspectRatio === "auto") {
      normalized.aspectRatio = null;
      warnings.push("DALL·E 3 不支持 auto 比例，已省略比例参数");
    } else if (normalized.aspectRatio) {
      const supportedRatio = normalizeLegacyOpenAIAspectRatio(
        normalized.aspectRatio
      );
      if (supportedRatio !== normalized.aspectRatio) {
        warnings.push(
          `DALL·E 3 不支持 ${normalized.aspectRatio}，已调整为 ${supportedRatio}`
        );
        normalized.aspectRatio = supportedRatio;
      }
    }

    if (["2K", "4K"].includes(normalized.imageSize)) {
      warnings.push(
        `DALL·E 3 不支持 ${normalized.imageSize} 清晰度参数，已省略并使用模型默认值`
      );
      normalized.imageSize = null;
    }

    if (Number.isInteger(normalized.count) && normalized.count > 1) {
      normalized.count = 1;
      warnings.push(`DALL·E 3 单次只能生成 1 张，已忽略 n=${options.count}`);
    }
  }

  if (provider === "openai" && model.includes("dall-e-2")) {
    if (normalized.aspectRatio === "auto") {
      normalized.aspectRatio = null;
      warnings.push("DALL·E 2 不支持 auto 比例，已省略比例参数");
    } else if (normalized.aspectRatio && normalized.aspectRatio !== "1:1") {
      warnings.push(
        `DALL·E 2 不支持 ${normalized.aspectRatio}，已调整为 1:1`
      );
      normalized.aspectRatio = "1:1";
    }

    if (["2K", "4K"].includes(normalized.imageSize)) {
      warnings.push(
        `DALL·E 2 不支持 ${normalized.imageSize} 清晰度参数，已省略并使用模型默认值`
      );
      normalized.imageSize = null;
    }
  }

  return { options: normalized, sourceImageLimit, warnings };
}

async function notifyParameterWarnings(callback, warnings) {
  if (warnings.length > 0 && typeof callback === "function") {
    await callback(warnings);
  }
}

function resolveImageConfig(imageConfig = {}, requestedChannel = null) {
  const channelName = `${requestedChannel || imageConfig.imageChannel || ""}`.trim();

  if (!channelName) {
    throw new Error("未配置生图渠道，请在 EditImage.imageChannel 中选择一个 ImageChannels 渠道。");
  }

  const imageChannelsConfig = Setting.getConfig("ImageChannels");
  const imageChannel = findImageChannel(imageChannelsConfig, channelName);
  if (imageChannel) {
    return imageChannel;
  }

  const availableChannels = listImageChannelNames(imageChannelsConfig);
  const availableText = availableChannels.length > 0
    ? ` 可用渠道：${availableChannels.join("、")}。`
    : "";
  throw new Error(`未找到名为 "${channelName}" 的生图渠道。${availableText}`);
}

function pickApiKey(imageConfig) {
  let apiKeys = imageConfig.api;

  if (typeof apiKeys === "string" && apiKeys.includes("\n")) {
    apiKeys = apiKeys
      .split("\n")
      .map((key) => key.trim())
      .filter(Boolean);
  }

  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const channelName = imageConfig.name || imageConfig.imageChannel || "image";
    let currentIndex = channelApiKeyIndex.get(channelName) || 0;

    if (currentIndex >= apiKeys.length) {
      currentIndex = 0;
    }

    const apiKey = apiKeys[currentIndex];
    channelApiKeyIndex.set(channelName, (currentIndex + 1) % apiKeys.length);
    return apiKey;
  }

  if (typeof apiKeys === "string") {
    return apiKeys.trim();
  }

  return "";
}

function getFileExtension(mimeType = "image/png") {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  return mimeType.split("/")[1] || "png";
}

function normalizeBase64Data(base64String) {
  if (!base64String) {
    return "";
  }

  const parts = `${base64String}`.split(",");
  return parts.length > 1 ? parts.pop() : parts[0];
}

function getMimeTypeFromDataUrl(base64String) {
  if (!base64String || !`${base64String}`.startsWith("data:")) {
    return null;
  }

  const matched = `${base64String}`.match(/^data:([^;]+);base64,/i);
  return matched?.[1] || null;
}

function parseAspectRatio(aspectRatio) {
  if (!aspectRatio || !`${aspectRatio}`.includes(":")) {
    return 1;
  }

  const [width, height] = `${aspectRatio}`.split(":").map(Number);
  if (!width || !height) {
    return 1;
  }

  return width / height;
}

function floorToMultiple(value, multiple = 16) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function pickGptImage2Size(aspectRatio, imageSize) {
  const ratio = parseAspectRatio(aspectRatio || "1:1");
  const normalizedSize = `${imageSize || "1K"}`.toUpperCase();
  const isSquare = Math.abs(ratio - 1) < 0.001;

  let longEdge = isSquare ? 1024 : 1536;
  let maxPixels = longEdge * longEdge;

  if (normalizedSize === "2K") {
    longEdge = 2048;
    maxPixels = GPT_IMAGE_2_2K_MAX_PIXELS;
  } else if (normalizedSize === "4K") {
    longEdge = 3840;
    maxPixels = GPT_IMAGE_2_MAX_PIXELS;
  }

  let width;
  let height;

  if (ratio >= 1) {
    width = longEdge;
    height = longEdge / ratio;
  } else {
    height = longEdge;
    width = longEdge * ratio;
  }

  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width *= scale;
    height *= scale;
  }

  return `${floorToMultiple(width)}x${floorToMultiple(height)}`;
}

async function normalizeDownloadedImage(buffer, mimeType) {
  if (mimeType === "image/gif") {
    return {
      buffer: await sharp(buffer).png().toBuffer(),
      mimeType: "image/png",
    };
  }

  return { buffer, mimeType };
}

async function fetchImageBytes(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const rawBuffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get("content-type") || "image/png";
  const normalized = await normalizeDownloadedImage(rawBuffer, mimeType);

  return {
    buffer: normalized.buffer,
    mimeType: normalized.mimeType,
  };
}

async function normalizeImageInput(input, index) {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    const downloaded = await fetchImageBytes(input);
    return {
      ...downloaded,
      fileName: `image-${index + 1}.${getFileExtension(downloaded.mimeType)}`,
    };
  }

  if (Buffer.isBuffer(input)) {
    return {
      buffer: input,
      mimeType: "image/png",
      fileName: `image-${index + 1}.png`,
    };
  }

  if (input.url) {
    const downloaded = await fetchImageBytes(input.url);
    return {
      ...downloaded,
      fileName:
        input.fileName ||
        `image-${index + 1}.${getFileExtension(downloaded.mimeType)}`,
    };
  }

  if (input.inlineData?.data) {
    const mimeType = input.inlineData.mimeType || "image/png";
    const buffer = Buffer.from(normalizeBase64Data(input.inlineData.data), "base64");
    const normalized = await normalizeDownloadedImage(buffer, mimeType);

    return {
      buffer: normalized.buffer,
      mimeType: normalized.mimeType,
      fileName: `image-${index + 1}.${getFileExtension(normalized.mimeType)}`,
    };
  }

  if (input.base64) {
    const mimeType =
      input.mimeType || getMimeTypeFromDataUrl(input.base64) || "image/png";
    const buffer = Buffer.from(normalizeBase64Data(input.base64), "base64");
    const normalized = await normalizeDownloadedImage(buffer, mimeType);

    return {
      buffer: normalized.buffer,
      mimeType: normalized.mimeType,
      fileName:
        input.fileName ||
        `image-${index + 1}.${getFileExtension(normalized.mimeType)}`,
    };
  }

  if (input.buffer) {
    const buffer = Buffer.isBuffer(input.buffer)
      ? input.buffer
      : Buffer.from(input.buffer);
    const mimeType = input.mimeType || "image/png";
    const normalized = await normalizeDownloadedImage(buffer, mimeType);

    return {
      buffer: normalized.buffer,
      mimeType: normalized.mimeType,
      fileName:
        input.fileName ||
        `image-${index + 1}.${getFileExtension(normalized.mimeType)}`,
    };
  }

  return null;
}

async function normalizeImageInputs(inputs = []) {
  const normalized = await Promise.all(
    inputs.map((input, index) => normalizeImageInput(input, index))
  );

  return normalized.filter(Boolean);
}

function buildGeminiContents(promptText, sourceImages) {
  const contents = [];

  if (promptText) {
    contents.push({ text: promptText });
  }

  for (const image of sourceImages) {
    contents.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.buffer.toString("base64"),
      },
    });
  }

  return contents;
}

function buildGeminiImageConfig(options = {}, isVertex = false) {
  const config = {
    tools: [{ googleSearch: {} }],
    responseModalities: ["IMAGE"],
    imageConfig: {
      imageSize: options.imageSize || "1K",
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    ],
  };

  if (isVertex) {
    config.imageConfig.outputMimeType = "image/png";
  }

  if (options.aspectRatio) {
    config.imageConfig.aspectRatio = options.aspectRatio;
  }

  return config;
}

function extractGeminiImageBuffers(response) {
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.inlineData && part.inlineData.mimeType?.startsWith("image/"))
    .map((part) => Buffer.from(part.inlineData.data, "base64"));
}

function isGrokImageModel(modelName) {
  return `${modelName || ""}`.toLowerCase().includes("grok-imagine-image");
}

function createImageGeminiClient(imageConfig, apiKey, isVertex) {
  return new GoogleGenAI(
    buildGeminiClientOptions({
      ...imageConfig,
      apiKey,
      vertex: isVertex,
      ...(isVertex && { location: DEFAULT_VERTEX_LOCATION }),
    })
  );
}

async function callGeminiModel(
  imageConfig,
  promptText,
  sourceImages,
  options,
  apiKey,
  isVertex = false
) {
  const ai = createImageGeminiClient(imageConfig, apiKey, isVertex);
  const config = buildGeminiImageConfig(options, isVertex);

  const response = await ai.models.generateContent({
    model: imageConfig.model,
    contents: buildGeminiContents(promptText, sourceImages),
    config,
  });

  return extractGeminiImageBuffers(response);
}

function pickOpenAISize(modelName, aspectRatio, imageSize) {
  const normalizedModel = `${modelName || ""}`.toLowerCase();

  if (isGrokImageModel(normalizedModel)) {
    return null;
  }

  if (!aspectRatio && !imageSize) {
    return null;
  }

  if (aspectRatio === "auto" && !imageSize) {
    return "auto";
  }

  if (normalizedModel.includes("gpt-image-2")) {
    return pickGptImage2Size(aspectRatio, imageSize);
  }

  if (!aspectRatio) {
    return null;
  }

  if (aspectRatio === "1:1") {
    return "1024x1024";
  }

  const isPortrait = PORTRAIT_RATIOS.has(aspectRatio);
  const isLandscape = LANDSCAPE_RATIOS.has(aspectRatio);

  if (normalizedModel.includes("dall-e-3")) {
    if (isPortrait) {
      return "1024x1536";
    }

    if (isLandscape) {
      return "1536x1024";
    }

    return "1024x1024";
  }

  if (normalizedModel.includes("dall-e-2")) {
    return "1024x1024";
  }

  if (isPortrait) {
    return "1024x1536";
  }

  if (isLandscape) {
    return "1536x1024";
  }

  return "1024x1024";
}

function pickOpenAIQuality(modelName, imageSize) {
  const normalizedModel = `${modelName || ""}`.toLowerCase();

  if (isGrokImageModel(normalizedModel)) {
    return null;
  }

  if (!imageSize) {
    return null;
  }

  if (normalizedModel.includes("dall-e-2")) {
    return null;
  }

  if (normalizedModel.includes("dall-e-3")) {
    return imageSize === "4K" ? "hd" : "standard";
  }

  if (imageSize === "4K") {
    return "high";
  }

  if (imageSize === "2K") {
    return "medium";
  }

  if (imageSize === "1K") {
    return "low";
  }

  return null;
}

function pickGrokImageResolution(imageSize) {
  const normalizedSize = `${imageSize || ""}`.toUpperCase();

  if (normalizedSize === "2K" || normalizedSize === "4K") {
    return "2k";
  }

  if (normalizedSize === "1K") {
    return "1k";
  }

  return null;
}

async function extractOpenAIImageBuffers(response) {
  const imageDataList = response?.data || [];
  const buffers = [];

  for (const item of imageDataList) {
    if (item?.b64_json) {
      buffers.push(Buffer.from(item.b64_json, "base64"));
      continue;
    }

    if (item?.url) {
      const downloaded = await fetchImageBytes(item.url);
      buffers.push(downloaded.buffer);
    }
  }

  return buffers;
}

async function callOpenAIImage(
  imageConfig,
  promptText,
  sourceImages,
  options
) {
  const client = new OpenAI({
    apiKey: pickApiKey(imageConfig),
    baseURL: imageConfig.baseURL?.trim() || undefined,
    maxRetries: 0,
  });

  const request = {
    model: imageConfig.model,
    prompt: promptText,
  };
  const size = pickOpenAISize(
    imageConfig.model,
    options.aspectRatio,
    options.imageSize
  );
  const quality = pickOpenAIQuality(imageConfig.model, options.imageSize);

  if (size) {
    request.size = size;
  }

  if (quality) {
    request.quality = quality;
  }

  if (Number.isInteger(options.count) && options.count > 1) {
    request.n = options.count;
  }

  if (isGrokImageModel(imageConfig.model)) {
    request.response_format = "b64_json";

    if (options.aspectRatio && options.aspectRatio !== "auto") {
      request.aspect_ratio = options.aspectRatio;
    }

    const resolution = pickGrokImageResolution(options.imageSize);
    if (resolution) {
      request.resolution = resolution;
    }
  }

  let response;

  if (sourceImages.length > 0) {
    const files = await Promise.all(
      sourceImages.map((image) =>
        toFile(image.buffer, image.fileName, { type: image.mimeType })
      )
    );

    response = await client.images.edit({
      ...request,
      image: files.length === 1 ? files[0] : files,
    });
  } else {
    response = await client.images.generate(request);
  }

  return await extractOpenAIImageBuffers(response);
}

async function callGrokImage(imageConfig, promptText, sourceImages, options) {
  const result = await generateGrokImage(
    {
      model: imageConfig.model,
      prompt: promptText,
      images: sourceImages,
      aspectRatio: options.aspectRatio,
      resolution: pickGrokImageResolution(options.imageSize),
      n: options.count,
      responseFormat: "b64_json",
    },
    {
      baseURL: imageConfig.baseURL,
      apiKey: pickApiKey(imageConfig),
      imageModel: imageConfig.model,
    }
  );

  return result.buffers;
}

export async function generateImagesWithProvider(
  imageConfig,
  promptText,
  sourceInputs = [],
  options = {},
  hooks = {}
) {
  const resolvedConfig = resolveImageConfig(imageConfig, options.channel);
  const provider = normalizeProvider(resolvedConfig.provider);
  try {
    validateResolvedImageConfig(resolvedConfig, provider);
    const normalized = normalizeImageGenerationOptions(
      provider,
      resolvedConfig.model,
      options,
      sourceInputs.length
    );
    await notifyParameterWarnings(
      hooks.onParameterWarnings,
      normalized.warnings
    );
    const sourceImages = await normalizeImageInputs(
      sourceInputs.slice(0, normalized.sourceImageLimit)
    );
    const compatibleOptions = normalized.options;

    if (provider === "openai") {
      return await callOpenAIImage(
        resolvedConfig,
        promptText,
        sourceImages,
        compatibleOptions
      );
    }

    if (provider === "grok") {
      return await callGrokImage(
        resolvedConfig,
        promptText,
        sourceImages,
        compatibleOptions
      );
    }

    const isVertex = provider === "vertex";
    return await callGeminiModel(
      resolvedConfig,
      promptText,
      sourceImages,
      compatibleOptions,
      isVertex ? "" : pickApiKey(resolvedConfig),
      isVertex
    );
  } catch (error) {
    throw tagMediaError(error, provider, "image");
  }
}

function validateResolvedImageConfig(imageConfig, provider) {
  if (!imageConfig?.model) {
    throw new Error("生图渠道未配置模型。");
  }

  if (provider === "vertex") {
    if (!imageConfig.serviceAccountRef) {
      throw new Error("Vertex 生图渠道未选择服务账号凭证。");
    }
    return;
  }

  if (provider === "grok") {
    if (!imageConfig.baseURL) {
      throw new Error("Grok 生图渠道未配置 API 地址。");
    }
    return;
  }

  if (!imageConfig.api) {
    throw new Error(`${provider === "openai" ? "OpenAI" : "Gemini"} 生图渠道未配置 API Key。`);
  }
}
