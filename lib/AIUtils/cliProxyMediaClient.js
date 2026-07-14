import fs from "node:fs/promises";
import path from "node:path";
import {
  VIDEO_GENERATION_POLL_INTERVAL_MS,
  VIDEO_GENERATION_TIMEOUT_MS,
} from "./videoGenerationConstants.js";

const DEFAULT_CONFIG = {
  baseURL: "http://127.0.0.1:8317/v1",
  apiKey: "",
  imageModel: "grok-imagine-image-quality",
  videoModel: "grok-imagine-video",
  preferNativeVideo: true,
};

const COMPLETE_STATUSES = new Set(["completed", "done", "succeeded", "success"]);
const FAILED_STATUSES = new Set(["failed", "error", "expired", "cancelled", "canceled"]);
const TEXT_TO_VIDEO_FALLBACK_MODEL = "grok-imagine-video";
const IMAGE_REQUIRED_VIDEO_MODELS = new Set(["grok-imagine-video-1.5-preview"]);
const API_DISPLAY_NAME = "本地 OpenAI 兼容媒体接口";

function stringValue(value, fallback = "") {
  if (value == null) return fallback;
  const text = `${value}`.trim();
  return text || fallback;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function normalizeCliProxyConfig(raw = {}) {
  const baseURL = trimTrailingSlash(
    stringValue(raw.baseURL || raw.baseUrl, DEFAULT_CONFIG.baseURL)
  );

  return {
    baseURL,
    apiKey: stringValue(raw.apiKey || raw.api || raw.key, DEFAULT_CONFIG.apiKey),
    imageModel: stringValue(raw.imageModel, DEFAULT_CONFIG.imageModel),
    videoModel: stringValue(raw.videoModel, DEFAULT_CONFIG.videoModel),
    preferNativeVideo: raw.preferNativeVideo !== false,
  };
}

function buildURL(config, endpoint) {
  const pathPart = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${config.baseURL}${pathPart}`;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function apiFetch(endpoint, { method = "POST", body = null } = {}, rawConfig) {
  const config = normalizeCliProxyConfig(rawConfig);
  const headers = {};

  if (body != null) {
    headers["Content-Type"] = "application/json";
  }

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(buildURL(config, endpoint), {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const payload = await readResponseBody(response);

  if (!response.ok) {
    const message =
      typeof payload === "string" ? payload : JSON.stringify(payload || {});
    throw new Error(
      `${API_DISPLAY_NAME}请求失败：${method} ${endpoint} 返回 ${response.status}，${message.slice(0, 500)}`
    );
  }

  return payload;
}

function dataURLToBuffer(dataURL) {
  const matched = `${dataURL}`.match(/^data:[^;]+;base64,(.+)$/is);
  if (!matched) return null;
  return Buffer.from(matched[1], "base64");
}

async function urlToBuffer(url, headers = {}) {
  const dataBuffer = dataURLToBuffer(url);
  if (dataBuffer) return dataBuffer;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`媒体下载失败：HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function downloadMedia(url, targetPath, headers = {}) {
  const buffer = await urlToBuffer(url, headers);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

function imageRef(input) {
  if (!input) return null;
  if (typeof input === "string") return input.trim() || null;
  if (input.url) return stringValue(input.url, null);
  if (Buffer.isBuffer(input)) {
    return `data:image/png;base64,${input.toString("base64")}`;
  }
  if (input.buffer) {
    const buffer = Buffer.isBuffer(input.buffer)
      ? input.buffer
      : Buffer.from(input.buffer);
    const mimeType = input.mimeType || "image/png";
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }
  if (input.inlineData?.data) {
    const mimeType = input.inlineData.mimeType || "image/png";
    return `data:${mimeType};base64,${input.inlineData.data}`;
  }
  if (input.base64) {
    const mimeType = input.mimeType || "image/png";
    return `${input.base64}`.startsWith("data:")
      ? input.base64
      : `data:${mimeType};base64,${input.base64}`;
  }
  return null;
}

function collectImageOutputItems(payload) {
  const items = [];
  const data = Array.isArray(payload?.data) ? payload.data : [];

  for (const item of data) {
    if (item?.b64_json) {
      items.push({ b64: item.b64_json });
    } else if (item?.url) {
      items.push({ url: item.url });
    }
  }

  if (payload?.b64_json) {
    items.push({ b64: payload.b64_json });
  }
  if (payload?.url) {
    items.push({ url: payload.url });
  }

  return items;
}

export async function generateGrokImage(options = {}, rawConfig = {}) {
  const config = normalizeCliProxyConfig(rawConfig);
  const prompt = stringValue(options.prompt);
  if (!prompt) {
    throw new Error("请先输入提示词。");
  }

  const images = (options.images || []).map(imageRef).filter(Boolean);
  const request = {
    model: options.model || config.imageModel,
    prompt,
    response_format: options.responseFormat || "b64_json",
  };

  if (options.n) request.n = options.n;
  if (options.aspectRatio && options.aspectRatio !== "auto") {
    request.aspect_ratio = options.aspectRatio;
  }
  if (options.resolution) {
    request.resolution = options.resolution;
  }

  let endpoint = "/images/generations";
  if (images.length === 1) {
    endpoint = "/images/edits";
    request.image = { type: "image_url", url: images[0] };
  } else if (images.length > 1) {
    endpoint = "/images/edits";
    request.images = images.map((url) => ({ type: "image_url", url }));
  }

  const payload = await apiFetch(endpoint, { body: request }, config);
  const items = collectImageOutputItems(payload);
  const buffers = [];

  for (const item of items) {
    if (item.b64) {
      buffers.push(Buffer.from(item.b64, "base64"));
      continue;
    }

    if (item.url) {
      buffers.push(await urlToBuffer(item.url));
    }
  }

  if (buffers.length === 0) {
    throw new Error(`${API_DISPLAY_NAME}没有返回图片。`);
  }

  return {
    buffers,
    payload,
  };
}

function normalizeStatus(payload) {
  return stringValue(payload?.status || payload?.state).toLowerCase();
}

function getByPath(value, pathText) {
  return pathText.split(".").reduce((current, key) => {
    if (current == null) return null;
    if (Array.isArray(current)) return current[Number(key)];
    return current[key];
  }, value);
}

function findString(value, predicate, seen = new Set()) {
  if (value == null) return null;
  if (typeof value === "string") {
    return predicate(value) ? value : null;
  }
  if (typeof value !== "object" || seen.has(value)) return null;

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, predicate, seen);
      if (found) return found;
    }
    return null;
  }

  for (const item of Object.values(value)) {
    const found = findString(item, predicate, seen);
    if (found) return found;
  }
  return null;
}

function looksLikeVideoURL(value) {
  const text = value.trim();
  return (
    /^data:video\//i.test(text) ||
    /^https?:\/\//i.test(text) &&
      (/\.(mp4|webm|mov)([?#].*)?$/i.test(text) || /\/video/i.test(text))
  );
}

export function extractVideoURL(payload) {
  const directPaths = [
    "video.url",
    "video.download_url",
    "output.video.url",
    "data.0.url",
    "url",
    "video_url",
    "download_url",
  ];

  for (const pathText of directPaths) {
    const value = getByPath(payload, pathText);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return findString(payload, looksLikeVideoURL);
}

export function extractVideoRequestId(payload) {
  const directPaths = [
    "request_id",
    "id",
    "video_id",
    "data.0.request_id",
    "data.0.id",
  ];

  for (const pathText of directPaths) {
    const value = getByPath(payload, pathText);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function normalizeVideoImageRefs(imageUrls = [], referenceImageUrls = []) {
  const combined = [...imageUrls, ...referenceImageUrls]
    .map(imageRef)
    .filter(Boolean);
  return combined.slice(0, 7);
}

function normalizedDuration(duration) {
  const value = Number.parseInt(duration, 10);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(15, value));
}

export function resolveGrokVideoModel(model, refs = []) {
  const selectedModel = stringValue(model, DEFAULT_CONFIG.videoModel);
  if (
    refs.length === 0 &&
    IMAGE_REQUIRED_VIDEO_MODELS.has(selectedModel.toLowerCase())
  ) {
    return TEXT_TO_VIDEO_FALLBACK_MODEL;
  }

  return selectedModel;
}

export async function createGrokVideo(options = {}, rawConfig = {}) {
  const config = normalizeCliProxyConfig(rawConfig);
  const prompt = stringValue(options.prompt);
  const refs = normalizeVideoImageRefs(
    options.imageUrls || [],
    options.referenceImageUrls || []
  );
  const native = options.native ?? config.preferNativeVideo;

  if (!prompt && refs.length === 0) {
    throw new Error("请提供提示词或参考图。");
  }

  if (!prompt && !native) {
    throw new Error("使用 /videos 包装接口时需要输入提示词。");
  }

  const request = {
    model: resolveGrokVideoModel(options.model || config.videoModel, refs),
  };
  if (prompt) request.prompt = prompt;
  const duration = normalizedDuration(options.duration);

  if (duration) request.duration = refs.length > 1 ? Math.min(duration, 10) : duration;
  if (options.aspectRatio && options.aspectRatio !== "auto") {
    request.aspect_ratio = options.aspectRatio;
  }
  if (options.resolution) {
    request.resolution = options.resolution;
  }

  if (refs.length === 1) {
    request.image = { url: refs[0] };
  } else if (refs.length > 1) {
    request.reference_images = refs.map((url) => ({ url }));
  }

  const endpoint = native ? "/videos/generations" : "/videos";
  const payload = await apiFetch(endpoint, { body: request }, config);
  const requestId = extractVideoRequestId(payload);

  return {
    payload,
    requestId,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPayloadError(payload) {
  if (!payload?.error) return "";
  if (typeof payload.error === "string") return payload.error;
  if (payload.error.message) return payload.error.message;
  return JSON.stringify(payload.error);
}

export async function pollGrokVideo(requestId, rawConfig = {}) {
  if (!requestId) {
    throw new Error("视频任务缺少 request id。");
  }

  const config = normalizeCliProxyConfig(rawConfig);
  const startedAt = Date.now();

  while (Date.now() - startedAt < VIDEO_GENERATION_TIMEOUT_MS) {
    const payload = await apiFetch(
      `/videos/${encodeURIComponent(requestId)}`,
      { method: "GET" },
      config
    );
    const status = normalizeStatus(payload);
    const videoURL = extractVideoURL(payload);

    if (videoURL && (!status || COMPLETE_STATUSES.has(status))) {
      return { payload, status: status || "completed", videoURL };
    }

    if (FAILED_STATUSES.has(status)) {
      throw new Error(getPayloadError(payload) || `视频生成失败：${status}`);
    }

    await wait(VIDEO_GENERATION_POLL_INTERVAL_MS);
  }

  throw new Error(
    `视频生成超时：等待 ${Math.round(VIDEO_GENERATION_TIMEOUT_MS / 1000)} 秒后仍未完成。`
  );
}

export async function generateGrokVideoAndWait(options = {}, rawConfig = {}) {
  const created = await createGrokVideo(options, rawConfig);
  const immediateURL = extractVideoURL(created.payload);

  if (immediateURL) {
    return {
      ...created,
      videoURL: immediateURL,
      finalPayload: created.payload,
      status: "completed",
    };
  }

  if (!created.requestId) {
    throw new Error(`${API_DISPLAY_NAME}没有返回视频任务 ID。`);
  }

  const polled = await pollGrokVideo(created.requestId, rawConfig);
  return {
    ...created,
    videoURL: polled.videoURL,
    finalPayload: polled.payload,
    status: polled.status,
  };
}
