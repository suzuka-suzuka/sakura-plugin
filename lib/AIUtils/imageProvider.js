import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import Setting from "../setting.js";

const PORTRAIT_RATIOS = new Set(["2:3", "3:4", "4:5", "9:16"]);
const LANDSCAPE_RATIOS = new Set(["3:2", "4:3", "5:4", "16:9", "21:9"]);
const IMAGE_CHANNEL_TYPES = ["gemini", "openai"];
const GPT_IMAGE_2_MAX_PIXELS = 8294400;
const GPT_IMAGE_2_2K_MAX_PIXELS = 4194304;
const OPENAI_CONVERSATION_IMAGE_MODEL = "gpt-5.5";
const OPENAI_IMAGE_WEB_SEARCH_INSTRUCTION =
  "If the image request needs current, real-world, factual, or visual-reference information, use web search before generating the image. Always finish by generating or editing an image.";
const GEMINI_CONVERSATION_HISTORY_LIMIT = 8;

const channelApiKeyIndex = new Map();

function normalizeProvider(provider) {
  if (!provider || provider === "gemini") {
    return "gemini";
  }

  return provider;
}

function normalizeChannelProvider(channelType) {
  return channelType;
}

function parseChannelRef(channelName) {
  const rawName = `${channelName || ""}`.trim();
  const prefixed = rawName.match(/^(gemini|openai):(.+)$/i);

  if (!prefixed) {
    return { provider: null, name: rawName };
  }

  return {
    provider: prefixed[1].toLowerCase(),
    name: prefixed[2].trim(),
  };
}

function findImageChannel(channelsConfig, channelName) {
  if (!channelsConfig || typeof channelsConfig !== "object") {
    return null;
  }

  const { provider, name } = parseChannelRef(channelName);
  const channelTypes = provider ? [provider] : IMAGE_CHANNEL_TYPES;

  for (const type of channelTypes) {
    const channels = channelsConfig[type];
    if (!Array.isArray(channels)) {
      continue;
    }

    const channel = channels.find((item) => item?.name === name);
    if (channel) {
      return {
        ...channel,
        provider: normalizeChannelProvider(type),
      };
    }
  }

  return null;
}

function resolveImageConfig(imageConfig = {}) {
  const channelName = `${imageConfig.imageChannel || ""}`.trim();

  if (!channelName) {
    throw new Error("未配置生图渠道，请在 EditImage.imageChannel 中选择一个 ImageChannels 渠道。");
  }

  const imageChannelsConfig = Setting.getConfig("ImageChannels");
  const imageChannel = findImageChannel(imageChannelsConfig, channelName);
  if (imageChannel) {
    return imageChannel;
  }

  throw new Error(`未找到名为 "${channelName}" 的生图渠道。`);
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

function trimGeminiConversationHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  const trimmed = history.slice(-GEMINI_CONVERSATION_HISTORY_LIMIT);
  while (trimmed.length > 0 && trimmed[0]?.role !== "user") {
    trimmed.shift();
  }
  return trimmed;
}

async function callGeminiModel(
  imageConfig,
  promptText,
  sourceImages,
  options,
  apiKey,
  isVertex = false
) {
  const geminiOptions = { apiKey };

  if (isVertex) {
    geminiOptions.vertexai = true;
  }

  if (imageConfig.baseURL) {
    geminiOptions.httpOptions = {
      baseUrl: imageConfig.baseURL,
    };
  }

  const ai = new GoogleGenAI(geminiOptions);
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

  if (!aspectRatio && !imageSize) {
    return null;
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
      return "1024x1792";
    }

    if (isLandscape) {
      return "1792x1024";
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

function pickOpenAIConversationModel(imageConfig) {
  return (
    imageConfig.conversationModel ||
    imageConfig.responsesModel ||
    imageConfig.responseModel ||
    OPENAI_CONVERSATION_IMAGE_MODEL
  );
}

function pickOpenAIResponsesSize(aspectRatio) {
  if (!aspectRatio) {
    return "auto";
  }

  if (aspectRatio === "1:1") {
    return "1024x1024";
  }

  if (PORTRAIT_RATIOS.has(aspectRatio)) {
    return "1024x1536";
  }

  if (LANDSCAPE_RATIOS.has(aspectRatio)) {
    return "1536x1024";
  }

  return "auto";
}

function pickOpenAIResponsesQuality(imageSize) {
  const normalizedSize = `${imageSize || ""}`.toUpperCase();

  if (normalizedSize === "4K") {
    return "high";
  }

  if (normalizedSize === "2K") {
    return "medium";
  }

  if (normalizedSize === "1K") {
    return "low";
  }

  return "auto";
}

function buildOpenAIResponsesInput(promptText, sourceImages) {
  const content = [
    {
      type: "input_text",
      text: OPENAI_IMAGE_WEB_SEARCH_INSTRUCTION,
    },
  ];

  if (promptText) {
    content.push({
      type: "input_text",
      text: promptText,
    });
  }

  for (const image of sourceImages) {
    content.push({
      type: "input_image",
      image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
    });
  }

  return [
    {
      role: "user",
      content,
    },
  ];
}

function collectOpenAIImageResults(value, results = []) {
  if (!value) {
    return results;
  }

  if (typeof value === "string") {
    results.push(value);
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectOpenAIImageResults(item, results);
    }
    return results;
  }

  if (typeof value !== "object") {
    return results;
  }

  if (typeof value.result === "string") {
    results.push(value.result);
  }

  if (typeof value.b64_json === "string") {
    results.push(value.b64_json);
  }

  if (Array.isArray(value.content)) {
    collectOpenAIImageResults(value.content, results);
  }

  if (Array.isArray(value.output)) {
    collectOpenAIImageResults(value.output, results);
  }

  return results;
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

async function callOpenAIResponsesImage(
  imageConfig,
  promptText,
  sourceImages,
  options,
  session
) {
  const client = new OpenAI({
    apiKey: pickApiKey(imageConfig),
    baseURL: imageConfig.baseURL?.trim() || undefined,
    maxRetries: 0,
  });

  const model = pickOpenAIConversationModel(imageConfig);
  const tool = {
    type: "image_generation",
    size: pickOpenAIResponsesSize(options.aspectRatio),
    quality: pickOpenAIResponsesQuality(options.imageSize),
  };
  const webSearchTool = {
    type: "web_search",
    search_context_size: "low",
  };

  const request = {
    model,
    input: buildOpenAIResponsesInput(promptText, sourceImages),
    tools: [webSearchTool, tool],
    tool_choice: "required",
    include: ["output[*].image_generation_call.result"],
    max_output_tokens: 200,
    reasoning: {
      effort: "high",
    },
  };

  const channelName = imageConfig.name || imageConfig.imageChannel || "";
  const previousResponseId =
    session?.provider === "openai" &&
    session?.channelName === channelName &&
    session?.model === model
      ? session.previousResponseId
      : null;

  if (previousResponseId) {
    request.previous_response_id = previousResponseId;
  }

  const response = await client.responses.create(request);
  const imageResults = collectOpenAIImageResults(response.output);
  const imageBuffers = imageResults.map((data) =>
    Buffer.from(normalizeBase64Data(data), "base64")
  );

  return {
    imageBuffers,
    session: {
      provider: "openai",
      channelName,
      model,
      previousResponseId: response.id,
    },
  };
}

async function callGeminiConversation(
  imageConfig,
  promptText,
  sourceImages,
  options,
  session,
  apiKey,
  isVertex = false
) {
  const geminiOptions = { apiKey };

  if (isVertex) {
    geminiOptions.vertexai = true;
  }

  if (imageConfig.baseURL) {
    geminiOptions.httpOptions = {
      baseUrl: imageConfig.baseURL,
    };
  }

  const channelName = imageConfig.name || imageConfig.imageChannel || "";
  const history =
    session?.provider === "gemini" &&
    session?.channelName === channelName &&
    session?.model === imageConfig.model &&
    session?.isVertex === isVertex &&
    Array.isArray(session.history)
      ? session.history
      : [];

  const ai = new GoogleGenAI(geminiOptions);
  const config = buildGeminiImageConfig(options, isVertex);
  const chat = ai.chats.create({
    model: imageConfig.model,
    config,
    history,
  });

  const response = await chat.sendMessage({
    message: buildGeminiContents(promptText, sourceImages),
  });
  const imageBuffers = extractGeminiImageBuffers(response);

  return {
    imageBuffers,
    session: {
      provider: "gemini",
      channelName,
      model: imageConfig.model,
      isVertex,
      history: trimGeminiConversationHistory(chat.getHistory(true)),
    },
  };
}

export async function generateImagesWithProvider(
  imageConfig,
  promptText,
  sourceInputs = [],
  options = {}
) {
  const resolvedConfig = resolveImageConfig(imageConfig);

  if (!resolvedConfig?.api || !resolvedConfig?.model) {
    throw new Error("Invalid image config: api/model is required.");
  }

  const provider = normalizeProvider(resolvedConfig.provider);
  const sourceImages = await normalizeImageInputs(sourceInputs);

  if (provider === "openai") {
    return await callOpenAIImage(
      resolvedConfig,
      promptText,
      sourceImages,
      options
    );
  }

  let result = [];
  const isVertexConfigured = resolvedConfig.vertex === true;

  try {
    result = await callGeminiModel(
      resolvedConfig,
      promptText,
      sourceImages,
      options,
      pickApiKey(resolvedConfig),
      isVertexConfigured
    );
  } catch (error) {
    if (!isVertexConfigured && resolvedConfig.vertexApi) {
      logger.warn(
        `[imageProvider] primary gemini call failed, retrying with vertex: ${error.message}`
      );
      result = await callGeminiModel(
        resolvedConfig,
        promptText,
        sourceImages,
        options,
        resolvedConfig.vertexApi.trim(),
        true
      );
    } else {
      throw error;
    }
  }

  return result;
}

export async function continueImageConversationWithProvider(
  imageConfig,
  promptText,
  sourceInputs = [],
  options = {},
  session = null
) {
  const resolvedConfig = resolveImageConfig(imageConfig);
  const provider = normalizeProvider(resolvedConfig.provider);

  if (!resolvedConfig?.api || (provider !== "openai" && !resolvedConfig?.model)) {
    throw new Error("Invalid image config: api/model is required.");
  }

  const sourceImages = await normalizeImageInputs(sourceInputs);

  if (provider === "openai") {
    return await callOpenAIResponsesImage(
      resolvedConfig,
      promptText,
      sourceImages,
      options,
      session
    );
  }

  const isVertexConfigured = resolvedConfig.vertex === true;

  try {
    return await callGeminiConversation(
      resolvedConfig,
      promptText,
      sourceImages,
      options,
      session,
      pickApiKey(resolvedConfig),
      isVertexConfigured
    );
  } catch (error) {
    if (!isVertexConfigured && resolvedConfig.vertexApi) {
      logger.warn(
        `[imageProvider] primary gemini conversation failed, retrying with vertex: ${error.message}`
      );
      return await callGeminiConversation(
        resolvedConfig,
        promptText,
        sourceImages,
        options,
        session,
        resolvedConfig.vertexApi.trim(),
        true
      );
    }

    throw error;
  }
}
