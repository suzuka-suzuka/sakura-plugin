export function buildGeminiToolConfig({
  functionDeclarations = [],
  nativeWebSearch = false,
  vertex = false,
} = {}) {
  const declarations = Array.isArray(functionDeclarations)
    ? functionDeclarations
    : [];
  const hasFunctions = declarations.length > 0;
  const hasNativeWebSearch = nativeWebSearch === true;
  const tools = [];

  if (hasNativeWebSearch) {
    tools.push({ googleSearch: {} });
  }
  if (hasFunctions) {
    tools.push({ functionDeclarations: declarations });
  }

  if (tools.length === 0) {
    return {};
  }

  const result = { tools };
  if (!hasFunctions) {
    return result;
  }

  const toolConfig = {
    functionCallingConfig: {
      mode: hasNativeWebSearch ? "VALIDATED" : "AUTO",
    },
  };

  // Gemini Developer API needs this flag to return server-side search context
  // for the next custom-tool turn. The SDK rejects it in Vertex AI mode.
  if (hasNativeWebSearch && vertex !== true) {
    toolConfig.includeServerSideToolInvocations = true;
  }

  result.toolConfig = toolConfig;
  return result;
}
