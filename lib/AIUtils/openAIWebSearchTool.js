export function isGrokModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  return /(^|[/:])grok(?:$|[-_.:/])/.test(normalized);
}

export function buildOpenAICompatibleWebSearchTool(channel = {}) {
  if (isGrokModel(channel.model)) {
    return { type: "web_search" };
  }

  return {
    type: "web_search",
    search_context_size: "high",
    external_web_access: true,
    user_location: {
      type: "approximate",
      country: "CN",
    },
  };
}
