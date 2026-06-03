import Setting from "../setting.js";

export const GROK_MEDIA_ROUTE_AUTO = "auto";
export const GROK_MEDIA_ROUTE_API = "api";
export const GROK_MEDIA_ROUTE_WEB = "web";

const ROUTE_VALUES = new Set([
  GROK_MEDIA_ROUTE_AUTO,
  GROK_MEDIA_ROUTE_API,
  GROK_MEDIA_ROUTE_WEB,
]);

const API_ROUTE_TOKENS = new Set([
  "api",
  "openai",
  "openai-comp",
  "openai-compatible",
  "compatible",
  "compat",
  "comp",
  "cli",
  "cliproxy",
]);

const WEB_ROUTE_TOKENS = new Set([
  "web",
  "browser",
  "reverse",
  "grok",
  "grok-web",
  "网页",
  "反代",
  "逆向",
  "网页逆向",
]);

export function parseGrokMediaRouteToken(token) {
  const raw = String(token || "").trim().toLowerCase().replace(/^--/, "");
  if (!raw) return null;

  const assignmentMatch = raw.match(/^(?:route|provider|source|via|路由|渠道)=(.+)$/);
  const value = assignmentMatch ? assignmentMatch[1].trim() : raw;

  if (API_ROUTE_TOKENS.has(value)) return GROK_MEDIA_ROUTE_API;
  if (WEB_ROUTE_TOKENS.has(value)) return GROK_MEDIA_ROUTE_WEB;
  return null;
}

export function normalizeGrokMediaRoute(value, fallback = GROK_MEDIA_ROUTE_WEB) {
  const route = String(value || "").trim().toLowerCase();
  return ROUTE_VALUES.has(route) ? route : fallback;
}

export function resolveGrokMediaRoute(commandRoute = GROK_MEDIA_ROUTE_AUTO) {
  const route = normalizeGrokMediaRoute(commandRoute, GROK_MEDIA_ROUTE_AUTO);
  if (route !== GROK_MEDIA_ROUTE_AUTO) {
    return route;
  }

  const config = Setting.getConfig("CliProxyMedia") || {};
  return normalizeGrokMediaRoute(
    config.defaultRoute || config.route || config.defaultMediaRoute,
    GROK_MEDIA_ROUTE_WEB,
  );
}

export function resolveGrokWebConfig() {
  const channelsConfig = Setting.getConfig("Channels") || {};
  const grokChannels = Array.isArray(channelsConfig.grok)
    ? channelsConfig.grok
    : [];

  if (grokChannels.length === 0) {
    throw new Error("No Grok web channel configured.");
  }

  const aiConfig = Setting.getConfig("AI") || {};
  const preferredNames = [
    aiConfig.appschannel,
    aiConfig.defaultchannel,
    "grok",
  ]
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  const preferredChannels = preferredNames
    .map((name) => grokChannels.find((item) => item?.name === name))
    .filter(Boolean);
  const hasAuth = (channel) => Boolean(channel?.sso || channel?.supersso);
  const channel =
    preferredChannels.find(hasAuth) ||
    grokChannels.find(hasAuth) ||
    preferredChannels[0] ||
    grokChannels[0];

  return {
    sso: channel.sso,
    supersso: channel.supersso,
    cf_clearance: channel.cf_clearance,
    x_statsig_id: channel.x_statsig_id,
    temporary: channel.temporary !== false,
    dynamic_statsig: channel.dynamic_statsig !== false,
  };
}

export function imageReferenceToDataURL(image) {
  if (!image) return "";
  if (typeof image === "string") return image.trim();

  if (image.url) return String(image.url).trim();
  if (!image.base64) return "";

  const base64 = String(image.base64).trim();
  if (!base64) return "";
  if (base64.startsWith("data:")) return base64;

  const mimeType = image.mimeType || "image/png";
  return `data:${mimeType};base64,${base64}`;
}

export function buildGrokMediaMessages(prompt, images = []) {
  const content = [];
  const text = String(prompt || "").trim();

  if (text) {
    content.push({ type: "text", text });
  }

  for (const image of images) {
    const url = imageReferenceToDataURL(image);
    if (!url) continue;

    content.push({
      type: "image_url",
      image_url: { url },
    });
  }

  return [{ role: "user", content }];
}
