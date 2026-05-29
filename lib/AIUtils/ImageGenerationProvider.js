import { GoogleGenAI } from "@google/genai"
import OpenAI, { toFile } from "openai"
import sharp from "sharp"

const OPENAI_PROVIDER_NAMES = new Set(["openai", "openai_format", "openai-format"])
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

function getFirstApiKey(api) {
  if (Array.isArray(api)) {
    return api.find(key => typeof key === "string" && key.trim())?.trim() || ""
  }

  if (typeof api === "string") {
    return api
      .split(/\r?\n/)
      .map(key => key.trim())
      .filter(Boolean)[0] || ""
  }

  return ""
}

export function getImageProvider(imageConfig = {}) {
  const rawProvider = imageConfig.provider || imageConfig.format || imageConfig.type || "gemini"
  const provider = String(rawProvider).trim().toLowerCase()
  return OPENAI_PROVIDER_NAMES.has(provider) ? "openai" : "gemini"
}

function normalizeMimeType(contentType) {
  return String(contentType || "image/jpeg")
    .split(";")[0]
    .trim()
    .toLowerCase()
}

function extensionFromMimeType(mimeType) {
  const normalized = normalizeMimeType(mimeType)
  if (normalized === "image/jpeg") return "jpg"
  if (normalized === "image/png") return "png"
  if (normalized === "image/webp") return "webp"
  if (normalized === "image/gif") return "gif"
  return "png"
}

function mimeTypeFromOutputFormat(format) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg"
  if (format === "webp") return "image/webp"
  return "image/png"
}

function isOpenAIImageSize(size) {
  return typeof size === "string" && (/^\d+x\d+$/.test(size) || size === "auto")
}

function parseAspectRatio(aspectRatio) {
  if (!aspectRatio || typeof aspectRatio !== "string") return null
  const match = aspectRatio.match(/^(\d+):(\d+)$/)
  if (!match) return null

  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function resolveOpenAIImageSize({ aspectRatio, imageSize, imageConfig, model }) {
  const configuredSize = imageConfig.openaiSize || imageConfig.openai_size || imageConfig.size
  if (isOpenAIImageSize(configuredSize)) return configuredSize
  if (isOpenAIImageSize(imageSize)) return imageSize

  if (/^dall-e-2/i.test(model)) return "1024x1024"

  const ratio = parseAspectRatio(aspectRatio)
  if (!ratio || ratio.width === ratio.height) return "1024x1024"

  if (/^dall-e-3/i.test(model)) {
    return ratio.width > ratio.height ? "1792x1024" : "1024x1792"
  }

  return ratio.width > ratio.height ? "1536x1024" : "1024x1536"
}

function addConfigValue(payload, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    payload[key] = value
  }
}

function addConfigInteger(payload, key, value) {
  if (value === undefined || value === null || value === "") return

  const number = Number.parseInt(value, 10)
  if (Number.isFinite(number)) {
    payload[key] = number
  }
}

function supportsResponseFormat(model) {
  return !/^gpt-image-1/i.test(model)
}

function isGptImageModel(model) {
  return /^gpt-image-1/i.test(model)
}

function isDallE2Model(model) {
  return /^dall-e-2/i.test(model)
}

function isDallE3Model(model) {
  return /^dall-e-3/i.test(model)
}

export async function fetchImageForGeneration(imageUrl) {
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error(`无法访问提供的图片URL: ${imageUrl}，状态码: ${imageResponse.status}`)
  }

  const contentType = normalizeMimeType(imageResponse.headers.get("content-type"))
  if (!contentType.startsWith("image/")) {
    throw new Error(`提供的URL内容不是有效的图片格式: ${imageUrl}。Content-Type: ${contentType}`)
  }

  const arrayBuffer = await imageResponse.arrayBuffer()
  let buffer = Buffer.from(arrayBuffer)
  let finalMimeType = contentType

  if (contentType === "image/gif") {
    buffer = await sharp(buffer).toFormat("png").toBuffer()
    finalMimeType = "image/png"
  }

  const extension = extensionFromMimeType(finalMimeType)
  return {
    buffer,
    mimeType: finalMimeType,
    base64: buffer.toString("base64"),
    fileName: `image_${Date.now()}.${extension}`,
  }
}

function buildGeminiContents(prompt, imageInputs) {
  const contents = [{ text: prompt }]

  for (const imageInput of imageInputs) {
    contents.push({
      inlineData: {
        mimeType: imageInput.mimeType,
        data: imageInput.base64,
      },
    })
  }

  return contents
}

async function callGeminiImage({ imageConfig, apiKey, isVertex, contents, aspectRatio, imageSize }) {
  const geminiOptions = { apiKey }

  if (isVertex) {
    geminiOptions.vertexai = true
  }

  if (imageConfig.baseURL) {
    geminiOptions.httpOptions = {
      baseUrl: imageConfig.baseURL,
    }
  }

  const ai = new GoogleGenAI(geminiOptions)
  const config = {
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
    ],
    tools: [{ googleSearch: {} }],
    responseModalities: ["IMAGE", "TEXT"],
    imageConfig: {
      imageSize,
    },
  }

  if (isVertex) {
    config.imageConfig.outputMimeType = "image/png"
  }

  if (aspectRatio) {
    config.imageConfig.aspectRatio = aspectRatio
  }

  return ai.models.generateContent({
    model: imageConfig.model,
    contents,
    config,
  })
}

function extractGeminiResult(response) {
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    part => part.inlineData && part.inlineData.mimeType?.startsWith("image/"),
  )

  if (imagePart) {
    return {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
      raw: response,
    }
  }

  const textPart = response.candidates?.[0]?.content?.parts?.find(part => part.text)
  return {
    text: textPart ? textPart.text : "请求被拦截，请更换提示词或图片",
    raw: response,
  }
}

async function generateGeminiImage({
  imageConfig,
  prompt,
  imageInputs,
  aspectRatio,
  imageSize,
  allowVertexFallback,
}) {
  if (!imageConfig || !imageConfig.api || !imageConfig.model) {
    throw new Error("配置错误：未在 'EditImage' 配置中找到有效的 Gemini 配置或缺少 api/model。")
  }

  const apiKey = getFirstApiKey(imageConfig.api)
  if (!apiKey) {
    throw new Error("渠道配置中的 API Key 无效。")
  }

  const contents = buildGeminiContents(prompt, imageInputs)
  const isVertexConfigured = imageConfig.vertex === true

  const tryCall = async (key, isVertex) => {
    try {
      const response = await callGeminiImage({
        imageConfig,
        apiKey: key,
        isVertex,
        contents,
        aspectRatio,
        imageSize,
      })
      const result = extractGeminiResult(response)
      return { result, error: null }
    } catch (error) {
      return { result: null, error }
    }
  }

  let callResult = await tryCall(apiKey, isVertexConfigured)
  if (
    allowVertexFallback &&
    (callResult.error || !callResult.result?.imageBase64) &&
    !isVertexConfigured &&
    getFirstApiKey(imageConfig.vertexApi)
  ) {
    const vertexApiKey = getFirstApiKey(imageConfig.vertexApi)
    logger.warn(
      `Gemini 渠道失败(${callResult.error?.message || "未返回图片"}), 尝试切换到 Vertex 渠道重试...`,
    )
    callResult = await tryCall(vertexApiKey, true)
  }

  if (callResult.error) {
    throw callResult.error
  }

  return { provider: "gemini", ...callResult.result }
}

function buildOpenAIImagePayload({ imageConfig, prompt, aspectRatio, imageSize }) {
  const model = imageConfig.model
  const isGptImage = isGptImageModel(model)
  const isDallE2 = isDallE2Model(model)
  const isDallE3 = isDallE3Model(model)
  const isUnknownOpenAICompatibleModel = !isGptImage && !isDallE2 && !isDallE3
  const payload = {
    model,
    prompt,
    size: resolveOpenAIImageSize({ aspectRatio, imageSize, imageConfig, model }),
  }

  const n = Number.parseInt(imageConfig.n || 1, 10)
  payload.n = Number.isFinite(n) && n > 0 ? n : 1

  const quality = imageConfig.quality
  if (
    quality &&
    (
      isGptImage ||
      isUnknownOpenAICompatibleModel ||
      (isDallE3 && ["standard", "hd"].includes(quality)) ||
      (isDallE2 && quality === "standard")
    )
  ) {
    payload.quality = quality
  }

  if (isGptImage || isUnknownOpenAICompatibleModel) {
    addConfigValue(payload, "background", imageConfig.background)
    addConfigValue(payload, "moderation", imageConfig.moderation)
    addConfigValue(payload, "input_fidelity", imageConfig.inputFidelity ?? imageConfig.input_fidelity)
    addConfigValue(payload, "output_format", imageConfig.outputFormat ?? imageConfig.output_format)
    addConfigInteger(payload, "output_compression", imageConfig.outputCompression ?? imageConfig.output_compression)
  }

  if (isDallE3 || isUnknownOpenAICompatibleModel) {
    addConfigValue(payload, "style", imageConfig.style)
  }

  addConfigValue(payload, "user", imageConfig.user)

  const responseFormat = imageConfig.responseFormat ?? imageConfig.response_format
  if (responseFormat && supportsResponseFormat(model)) {
    payload.response_format = responseFormat
  } else if (supportsResponseFormat(model)) {
    payload.response_format = "b64_json"
  }

  return payload
}

function extractOpenAIResult(response) {
  const image = Array.isArray(response?.data) ? response.data[0] : null

  if (image?.b64_json || image?.base64) {
    return {
      imageBase64: image.b64_json || image.base64,
      mimeType: mimeTypeFromOutputFormat(response?.output_format),
      revisedPrompt: image.revised_prompt,
      raw: response,
    }
  }

  if (image?.url) {
    return {
      imageUrl: image.url,
      revisedPrompt: image.revised_prompt,
      raw: response,
    }
  }

  return {
    text: image?.revised_prompt || "API 未返回图片。",
    raw: response,
  }
}

async function generateOpenAIImage({ imageConfig, prompt, imageInputs, aspectRatio, imageSize }) {
  if (!imageConfig || !imageConfig.api || !imageConfig.model) {
    throw new Error("配置错误：未在 'EditImage' 配置中找到有效的 OpenAI 配置或缺少 api/model。")
  }

  const apiKey = getFirstApiKey(imageConfig.api)
  if (!apiKey) {
    throw new Error("渠道配置中的 API Key 无效。")
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: imageConfig.baseURL || DEFAULT_OPENAI_BASE_URL,
  })

  const payload = buildOpenAIImagePayload({ imageConfig, prompt, aspectRatio, imageSize })
  let response

  if (imageInputs.length > 0) {
    const uploadImages = await Promise.all(
      imageInputs.map((imageInput, index) =>
        toFile(imageInput.buffer, imageInput.fileName || `image_${index}.png`, {
          type: imageInput.mimeType,
        }),
      ),
    )
    payload.image = /^dall-e-2/i.test(imageConfig.model) ? uploadImages[0] : uploadImages
    response = await openai.images.edit(payload)
  } else {
    response = await openai.images.generate(payload)
  }

  return { provider: "openai", ...extractOpenAIResult(response) }
}

export async function generateImageWithConfig({
  imageConfig,
  prompt,
  imageInputs = [],
  aspectRatio,
  imageSize = "1K",
  allowVertexFallback = false,
}) {
  const provider = getImageProvider(imageConfig)

  if (provider === "openai") {
    return generateOpenAIImage({ imageConfig, prompt, imageInputs, aspectRatio, imageSize })
  }

  return generateGeminiImage({
    imageConfig,
    prompt,
    imageInputs,
    aspectRatio,
    imageSize,
    allowVertexFallback,
  })
}
