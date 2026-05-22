import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  baseURL: "http://127.0.0.1:8317/v1",
  apiKey: "",
  imageModel: "grok-imagine-image",
  imageQualityModel: "grok-imagine-image-quality",
  videoModel: "grok-imagine-video",
  pollIntervalMs: 5000,
  timeoutMs: 900000,
  preferNativeVideo: true,
};

const COMPLETE_STATUSES = new Set(["completed", "done", "succeeded", "success"]);
const FAILED_STATUSES = new Set(["failed", "error", "expired", "cancelled", "canceled"]);

function stringValue(value, fallback = "") {
  if (value == null) return fallback;
  const text = `${value}`.trim();
  return text || fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
    imageQualityModel: stringValue(
      raw.imageQualityModel,
      DEFAULT_CONFIG.imageQualityModel
    ),
    videoModel: stringValue(raw.videoModel, DEFAULT_CONFIG.videoModel),
    pollIntervalMs: positiveNumber(
      raw.pollIntervalMs,
      DEFAULT_CONFIG.pollIntervalMs
    ),
    timeoutMs: positiveNumber(raw.timeoutMs, DEFAULT_CONFIG.timeoutMs),
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
      `CLIProxyAPI ${method} ${endpoint} failed: ${response.status} ${message.slice(0, 500)}`
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
    throw new Error(`download failed: ${response.status}`);
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
  if (input.base64) {
    const mimeType = input.mimeType || "image/png";
    return `data:${mimeType};base64,${input.base64}`;
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
    throw new Error("prompt is required");
  }

  const images = (options.images || []).map(imageRef).filter(Boolean);
  const request = {
    model:
      options.model ||
      (options.quality ? config.imageQualityModel : config.imageModel),
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
    throw new Error("CLIProxyAPI did not return image output");
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

export async function createGrokVideo(options = {}, rawConfig = {}) {
  const config = normalizeCliProxyConfig(rawConfig);
  const prompt = stringValue(options.prompt);
  if (!prompt) {
    throw new Error("prompt is required");
  }

  const refs = normalizeVideoImageRefs(
    options.imageUrls || [],
    options.referenceImageUrls || []
  );
  const request = {
    model: options.model || config.videoModel,
    prompt,
  };
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

  const native = options.native ?? config.preferNativeVideo;
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

export async function pollGrokVideo(requestId, rawConfig = {}, options = {}) {
  if (!requestId) {
    throw new Error("video request id is required");
  }

  const config = normalizeCliProxyConfig(rawConfig);
  const startedAt = Date.now();
  const timeoutMs = positiveNumber(options.timeoutMs, config.timeoutMs);
  const pollIntervalMs = positiveNumber(
    options.pollIntervalMs,
    config.pollIntervalMs
  );

  while (Date.now() - startedAt < timeoutMs) {
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
      throw new Error(getPayloadError(payload) || `video generation failed: ${status}`);
    }

    await wait(pollIntervalMs);
  }

  throw new Error(`video generation timed out after ${Math.round(timeoutMs / 1000)}s`);
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
    throw new Error("CLIProxyAPI did not return a video request id");
  }

  const polled = await pollGrokVideo(created.requestId, rawConfig);
  return {
    ...created,
    videoURL: polled.videoURL,
    finalPayload: polled.payload,
    status: polled.status,
  };
}
