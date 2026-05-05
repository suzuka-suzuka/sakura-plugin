const DEFAULT_BASE_URL = "https://openbmb-voxcpm-demo.hf.space";
const DEFAULT_TIMEOUT_MS = 180000;

function normalizeBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function createTimeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeout = createTimeoutSignal(timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: timeout.signal,
    });
  } finally {
    timeout.clear();
  }
}

function parseServerSentEvents(text) {
  const blocks = String(text || "").split(/\r?\n\r?\n/).filter(Boolean);
  const events = [];

  for (const block of blocks) {
    let event = "message";
    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    events.push({
      event,
      data: dataLines.join("\n"),
    });
  }

  return events;
}

function resolveAudioFile(data, baseUrl) {
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return null;
  }

  if (typeof result === "string") {
    return /^https?:\/\//i.test(result) ? result : `${baseUrl}${result.startsWith("/") ? "" : "/"}${result}`;
  }

  if (result.url) {
    return result.url;
  }

  if (result.path) {
    return `${baseUrl}/gradio_api/file=${result.path}`;
  }

  return null;
}

function formatEventError(data) {
  const text = String(data ?? "").trim();
  if (!text || text === "null" || text === "undefined") {
    return "VoxCPM 生成失败，Space 后端未返回具体原因";
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) return String(parsed.error);
    if (parsed?.message) return String(parsed.message);
  } catch {
  }

  return text;
}

export async function uploadReferenceAudio(baseUrl, audio, options = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  if (!audio?.buffer || audio.buffer.length === 0) {
    return null;
  }

  const fileName = audio.fileName || "reference.wav";
  const mimeType = audio.mimeType || "audio/wav";
  const form = new FormData();
  form.append("files", new Blob([audio.buffer], { type: mimeType }), fileName);

  const response = await fetchWithTimeout(
    `${normalizedBaseUrl}/gradio_api/upload`,
    {
      method: "POST",
      body: form,
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`参考音频上传失败: HTTP ${response.status}`);
  }

  const result = await response.json();
  const uploaded = Array.isArray(result) ? result[0] : result?.files?.[0] || result?.path;
  const uploadedPath = typeof uploaded === "string" ? uploaded : uploaded?.path;

  if (!uploadedPath) {
    throw new Error("参考音频上传失败: 未返回文件路径");
  }

  return {
    path: uploadedPath,
    orig_name: fileName,
    mime_type: mimeType,
    meta: { _type: "gradio.FileData" },
  };
}

export async function generateVoxCPMVoice(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const payload = {
    data: [
      options.text || "",
      options.voicePrompt || "",
      options.referenceAudio || null,
      Boolean(options.ultimateClone),
      options.referenceText || "",
      Number(options.cfg ?? 2),
      Boolean(options.normalize),
      Boolean(options.denoise),
    ],
  };

  const submitResponse = await fetchWithTimeout(
    `${baseUrl}/gradio_api/call/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  if (!submitResponse.ok) {
    throw new Error(`VoxCPM 请求失败: HTTP ${submitResponse.status}`);
  }

  const submitResult = await submitResponse.json();
  const eventId = submitResult?.event_id;
  if (!eventId) {
    throw new Error("VoxCPM 请求失败: 未返回 event_id");
  }

  const eventResponse = await fetchWithTimeout(
    `${baseUrl}/gradio_api/call/generate/${eventId}`,
    {},
    timeoutMs
  );

  if (!eventResponse.ok) {
    throw new Error(`VoxCPM 获取结果失败: HTTP ${eventResponse.status}`);
  }

  const eventText = await eventResponse.text();
  const events = parseServerSentEvents(eventText);
  const errorEvent = events.find((item) => item.event === "error");
  if (errorEvent) {
    throw new Error(formatEventError(errorEvent.data));
  }

  const completeEvent = events.find((item) => item.event === "complete");
  if (!completeEvent?.data) {
    throw new Error("VoxCPM 未返回音频结果");
  }

  let completeData;
  try {
    completeData = JSON.parse(completeEvent.data);
  } catch {
    throw new Error("VoxCPM 音频结果解析失败");
  }

  const audioUrl = resolveAudioFile(completeData, baseUrl);
  if (!audioUrl) {
    throw new Error("VoxCPM 未返回可下载音频");
  }

  return {
    audioUrl,
    raw: completeData,
  };
}

export async function downloadAudio(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`下载生成音频失败: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
