function compactErrorMessage(message) {
  return String(message || "")
    .replace(/\s+/g, " ")
    .replace(/(supersso|sso|api[_-]?key|authorization|token)\s*[:=]\s*[^,\s]+/gi, "$1=***")
    .trim();
}

export function getGrokErrorMessage(error) {
  if (!error) return "";

  if (typeof error === "string") {
    return compactErrorMessage(error);
  }

  const messages = [
    error.message,
    error.cause?.message,
    typeof error.cause === "string" ? error.cause : "",
  ].filter(Boolean);

  if (messages.length > 0) {
    return compactErrorMessage(messages.join("；"));
  }

  return compactErrorMessage(error);
}

function matches(message, patterns) {
  return patterns.some((pattern) => pattern.test(message));
}

function shortDetail(message) {
  const detail = compactErrorMessage(message);
  if (!detail || detail === "[object Object]") {
    return "日志里有更完整的原因。";
  }
  return detail.length > 180 ? `${detail.slice(0, 180)}...` : detail;
}

export function formatGrokUserError(error, kind = "request") {
  const message = getGrokErrorMessage(error);

  if (
    matches(message, [
      /No Grok web channel configured/i,
      /还没有配置\s*Grok\s*网页渠道/i,
    ])
  ) {
    return "还没有配置 Grok 网页渠道，请在 Channels.yaml 的 grok 渠道里填好 sso 或 supersso。";
  }

  if (
    matches(message, [
      /未配置认证Token/i,
      /Grok渠道缺少sso或supersso认证配置/i,
      /sso|supersso/i,
    ])
  ) {
    return "Grok 登录凭据没配好或已经失效了，请检查 grok 渠道里的 sso/supersso。";
  }

  if (
    matches(message, [
      /cf_clearance/i,
      /cloudflare/i,
      /anti[- ]?bot/i,
      /challenge/i,
      /captcha/i,
      /request rejected/i,
      /403|forbidden/i,
      /风控|验证|拦截/i,
    ])
  ) {
    return "Grok 网页请求被风控拦住了，稍后重试，或更新 cf_clearance 后再试。";
  }

  if (
    matches(message, [
      /rate.?limit/i,
      /too many requests/i,
      /\b429\b/,
      /quota/i,
      /额度|频率|限流|次数/i,
    ])
  ) {
    return "Grok 当前额度或频率被限制了，等一会儿再试会更稳。";
  }

  if (
    matches(message, [
      /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i,
      /connection refused/i,
      /127\.0\.0\.1/,
      /OpenAI-compatible media API .* failed/i,
      /本地 OpenAI 兼容媒体接口请求失败/i,
    ])
  ) {
    return "本地 Grok API 网关连不上或返回异常，请检查 CliProxyMedia.baseURL 和网关进程。";
  }

  if (
    matches(message, [
      /unauthorized/i,
      /\b401\b/,
      /api key/i,
      /鉴权|认证失败|无效.*key/i,
    ])
  ) {
    return "Grok 凭据或本地 API Key 不对，请检查渠道认证配置。";
  }

  if (
    matches(message, [
      /did not return image output/i,
      /没有返回图片/i,
    ]) ||
    kind === "image" && matches(message, [/did not return/i, /没有返回.*结果/i])
  ) {
    return "Grok 没有返回图片，可能是提示词被拦截、额度不足，或网页状态异常。";
  }

  if (
    matches(message, [
      /did not return video output/i,
      /did not return a video request id/i,
      /video request id is required/i,
      /没有返回视频|没有返回视频任务 ID|缺少 request id/i,
    ]) ||
    kind === "video" && matches(message, [/did not return/i, /没有返回.*结果/i])
  ) {
    return "Grok 没有返回视频结果，可能是提示词被拦截、排队失败，或额度暂时不足。";
  }

  if (
    matches(message, [
      /download failed/i,
      /媒体下载失败/i,
      /下载失败/i,
    ])
  ) {
    return "生成已经完成，但媒体文件下载失败了。可以稍后重试，或查看日志里的原始链接。";
  }

  if (
    matches(message, [
      /timed out|timeout/i,
      /超时/i,
    ])
  ) {
    return "Grok 等太久还没有返回结果，可能还在排队或网络不稳，可以稍后再试。";
  }

  if (
    matches(message, [
      /media post create failed/i,
      /创建 Grok .*媒体帖子失败/i,
    ])
  ) {
    return "Grok 媒体任务创建失败，可能是网页会话过期、提示词被拦截，或账号暂时不可用。";
  }

  if (
    matches(message, [
      /Grok request retry failed/i,
      /重试后仍然失败/i,
    ])
  ) {
    return "这次 Grok 请求重试后仍然失败，可能是网页会话过期或网络不稳定。";
  }

  if (
    matches(message, [
      /Unsupported Grok media route/i,
      /媒体渠道不支持/i,
    ])
  ) {
    return "Grok 媒体渠道配置看起来不对，请使用 web 或 api。";
  }

  if (
    matches(message, [
      /prompt is required/i,
      /请先输入提示词/i,
    ])
  ) {
    return "请先输入提示词，再让我去找 Grok 生成。";
  }

  if (
    matches(message, [
      /policy|safety|violat|blocked/i,
      /安全策略|违规|不允许|被拒绝/i,
    ])
  ) {
    return "提示词可能被 Grok 的安全策略拦截了，换个说法再试。";
  }

  return `请求没有成功：${shortDetail(message)}`;
}
