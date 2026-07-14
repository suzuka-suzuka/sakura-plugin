const PROVIDER_NAMES = {
  grok: "Grok",
  gemini: "Gemini",
  openai: "OpenAI",
  vertex: "Vertex",
};

function compactMessage(message) {
  return String(message || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function redactMediaErrorMessage(message) {
  return compactMessage(message)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/gis, "[PRIVATE KEY REDACTED]")
    .replace(
      /(authorization\s*:\s*)(?:bearer\s+)?[^\s,;"']+/gi,
      "$1***"
    )
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer ***")
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key)["']?\s*[:=]\s*["']?)[^,"'\s;}]+/gi,
      "$1***"
    )
    .replace(/([?&](?:key|api[_-]?key|token)=)[^&\s]+/gi, "$1***")
    .trim();
}

export function getMediaErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return redactMediaErrorMessage(error);

  const messages = [
    error.message,
    typeof error.body === "string" ? error.body : "",
    error.error?.message,
    error.cause?.message,
    typeof error.cause === "string" ? error.cause : "",
  ].filter(Boolean);

  return redactMediaErrorMessage(messages.join("；"));
}

export function tagMediaError(error, provider, kind) {
  const tagged = error instanceof Error
    ? error
    : Object.assign(
        new Error(
          typeof error === "string"
            ? error
            : error?.message || "媒体生成请求失败"
        ),
        error && typeof error === "object" ? error : {}
      );

  try {
    if (provider && !tagged.mediaProvider) tagged.mediaProvider = provider;
    if (kind && !tagged.mediaKind) tagged.mediaKind = kind;
    return tagged;
  } catch {
    const wrapped = new Error(tagged.message || "媒体生成请求失败", {
      cause: tagged,
    });
    wrapped.mediaProvider = provider;
    wrapped.mediaKind = kind;
    return wrapped;
  }
}

function matches(message, patterns) {
  return patterns.some((pattern) => pattern.test(message));
}

function inferProvider(message) {
  if (/Gemini Omni|gemini|aiplatform\.interactions/i.test(message)) {
    return "gemini";
  }
  if (/Grok|CliProxyMedia|本地 OpenAI 兼容媒体接口/i.test(message)) {
    return "grok";
  }
  if (/Vertex/i.test(message)) return "vertex";
  if (/OpenAI/i.test(message)) return "openai";
  return null;
}

function providerName(provider, kind) {
  if (provider === "gemini" && kind === "video") return "Gemini Omni";
  return PROVIDER_NAMES[provider] || "当前媒体渠道";
}

function isSafeConfigurationMessage(message) {
  return matches(message, [
    /^未配置生图渠道/,
    /^未找到名为/,
    /^生图渠道未配置模型/,
    /^(?:OpenAI|Gemini|Grok|Vertex) 生图渠道未配置/,
    /^Vertex 生图渠道未选择服务账号凭证/,
    /^Gemini Omni 视频渠道未选择 Vertex 服务账号凭证/,
    /^不支持的视频渠道类型/,
    /^请先输入提示词/,
    /^请提供提示词或参考图/,
    /^使用 \/videos 包装接口时需要输入提示词/,
  ]);
}

export function formatMediaUserError(error, options = {}) {
  const message = getMediaErrorMessage(error);
  const kind = options.kind || error?.mediaKind || "request";
  const provider =
    options.provider || error?.mediaProvider || inferProvider(message);
  const name = providerName(provider, kind);

  if (isSafeConfigurationMessage(message)) {
    return message.slice(0, 240);
  }

  if (
    matches(message, [
      /request blocked due to safety/i,
      /safety violations?/i,
      /harmful content/i,
      /content moderation/i,
      /generated .* rejected/i,
      /rejected by .*moderation/i,
      /moderation/i,
      /content filter/i,
      /policy|safety|violat|blocked/i,
      /内容审核|内容安全|违禁|违规|安全策略|不允许|被拒绝|被拦截/i,
    ])
  ) {
    return `提示词或参考内容触发了 ${name} 的安全审核，请修改后重试。`;
  }

  if (
    /aiplatform\.interactions\.create/i.test(message) ||
    ((error?.status === 403 || error?.statusCode === 403) &&
      provider === "gemini")
  ) {
    return "Gemini Omni Vertex 权限不足：服务账号需要 aiplatform.interactions.create 权限，请检查项目 IAM 自定义角色。";
  }

  if (matches(message, [/permission.?denied/i, /forbidden/i, /\b403\b/, /权限不足|无权访问/])) {
    return `${name} 权限不足，请检查当前凭证和项目授权。`;
  }

  if (
    matches(message, [
      /unauthorized/i,
      /invalid.*(?:api[_ -]?key|credential|token)/i,
      /\b401\b/,
      /api key/i,
      /鉴权|认证失败|无效.*key/i,
    ])
  ) {
    return `${name} 鉴权失败，请检查当前渠道的凭证配置。`;
  }

  if (
    matches(message, [
      /rate.?limit/i,
      /too many requests/i,
      /\b429\b/,
      /fixed quota|provisioned throughput|quota/i,
      /额度|频率|限流|次数|配额/i,
    ])
  ) {
    return `${name} 当前额度、配额或请求频率受限，请稍后重试。`;
  }

  if (/not found|unsupported model|model.*access|模型不可用/i.test(message)) {
    return `${name} 模型不可用，请检查模型名称和项目访问权限。`;
  }

  if (
    matches(message, [
      /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i,
      /connection refused/i,
      /OpenAI-compatible media API .* failed/i,
      /本地 OpenAI 兼容媒体接口请求失败/i,
    ])
  ) {
    if (provider === "grok") {
      return "本地 Grok API 网关无法连接或返回异常，请检查渠道 baseURL 和网关进程。";
    }
    return `${name} 暂时无法连接，请稍后重试。`;
  }

  if (/参考图下载失败/i.test(message)) {
    return "参考图下载失败，请重新发送图片后再试。";
  }

  if (/download failed|媒体下载失败|下载失败/i.test(message)) {
    return "生成已经完成，但媒体文件下载失败，请稍后重试。";
  }

  if (/timed out|timeout|超时/i.test(message)) {
    return `${name} 等待超时，任务可能仍在排队，请稍后重试。`;
  }

  if (
    matches(message, [
      /did not return image output/i,
      /did not return video output/i,
      /did not return a video request id/i,
      /video request id is required/i,
      /没有返回图片|没有返回视频|缺少 request id/i,
    ])
  ) {
    return `${name} 没有返回${kind === "image" ? "图片" : "视频"}结果，请稍后重试。`;
  }

  return `${name} 请求失败，详细原因已记录到日志。`;
}
