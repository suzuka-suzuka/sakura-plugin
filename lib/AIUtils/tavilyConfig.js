export const DEFAULT_TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/";
export const DEFAULT_TAVILY_MAX_RESULTS = 8;
export const MAX_TAVILY_SEARCH_RESULTS = 20;
export const DEFAULT_TAVILY_SEARCH_DEPTH = "advanced";
export const TAVILY_SEARCH_DEPTH_OPTIONS = ["basic", "advanced", "fast", "ultra-fast"];
export const TAVILY_RAW_CONTENT_OPTIONS = ["false", "markdown", "text"];

export function normalizeTavilyMaxResults(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TAVILY_MAX_RESULTS;
  }

  return Math.min(Math.max(parsed, 1), MAX_TAVILY_SEARCH_RESULTS);
}

export function normalizeTavilySearchDepth(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TAVILY_SEARCH_DEPTH_OPTIONS.includes(normalized)
    ? normalized
    : DEFAULT_TAVILY_SEARCH_DEPTH;
}

export function normalizeTavilyRawContent(value) {
  if (value === true) {
    return "markdown";
  }
  if (value === false || value == null || value === "") {
    return "false";
  }

  const normalized = String(value).trim().toLowerCase();
  return TAVILY_RAW_CONTENT_OPTIONS.includes(normalized) ? normalized : "false";
}

export function buildTavilyRawContentParameter(value) {
  const normalized = normalizeTavilyRawContent(value);
  if (normalized === "markdown" || normalized === "text") {
    return normalized;
  }
  return false;
}
