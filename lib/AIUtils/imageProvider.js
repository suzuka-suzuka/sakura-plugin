import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";

const PORTRAIT_RATIOS = new Set(["2:3", "3:4", "4:5", "9:16"]);
const LANDSCAPE_RATIOS = new Set(["3:2", "4:3", "5:4", "16:9", "21:9"]);
const OPENAI_PROVIDERS = new Set([
  "openai",
  "openai_compat",
  "openai-compatible",
]);

function normalizeProvider(provider) {
  if (!provider || provider === "gemini") {
    return "gemini";
  }

  if (OPENAI_PROVIDERS.has(provider)) {
    return "openai_compat";
  }

  return provider;
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

  const response = await ai.models.generateContent({
    model: imageConfig.model,
    contents: buildGeminiContents(promptText, sourceImages),
    config,
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData && part.inlineData.mimeType?.startsWith("image/")
  );

  if (!imagePart?.inlineData?.data) {
    return [];
  }

  return [Buffer.from(imagePart.inlineData.data, "base64")];
}

function pickOpenAISize(modelName, aspectRatio) {
  if (!aspectRatio || aspectRatio === "1:1") {
    return "1024x1024";
  }

  const normalizedModel = `${modelName || ""}`.toLowerCase();
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

async function callOpenAICompatible(
  imageConfig,
  promptText,
  sourceImages,
  options
) {
  const client = new OpenAI({
    apiKey: imageConfig.api.trim(),
    baseURL: imageConfig.baseURL?.trim() || undefined,
  });

  const request = {
    model: imageConfig.model,
    prompt: promptText,
    size: pickOpenAISize(imageConfig.model, options.aspectRatio),
  };
  const quality = pickOpenAIQuality(imageConfig.model, options.imageSize);

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

export async function generateImagesWithProvider(
  imageConfig,
  promptText,
  sourceInputs = [],
  options = {}
) {
  if (!imageConfig?.api || !imageConfig?.model) {
    throw new Error("Invalid image config: api/model is required.");
  }

  const provider = normalizeProvider(imageConfig.provider);
  const sourceImages = await normalizeImageInputs(sourceInputs);

  if (provider === "openai_compat") {
    return await callOpenAICompatible(
      imageConfig,
      promptText,
      sourceImages,
      options
    );
  }

  let result = [];
  const isVertexConfigured = imageConfig.vertex === true;

  try {
    result = await callGeminiModel(
      imageConfig,
      promptText,
      sourceImages,
      options,
      imageConfig.api.trim(),
      isVertexConfigured
    );
  } catch (error) {
    if (!isVertexConfigured && imageConfig.vertexApi) {
      logger.warn(
        `[imageProvider] primary gemini call failed, retrying with vertex: ${error.message}`
      );
      result = await callGeminiModel(
        imageConfig,
        promptText,
        sourceImages,
        options,
        imageConfig.vertexApi.trim(),
        true
      );
    } else {
      throw error;
    }
  }

  return result;
}
