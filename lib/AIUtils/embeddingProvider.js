import Setting from "../setting.js";
import { resolveRouteTarget } from "./providerRouter.js";
import { createGeminiClient } from "./vertexAuth.js";

export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export function resolveEmbeddingConfig(selfId = null) {
  const scope = selfId == null ? {} : { selfId };
  const toolsRoute = Setting.getConfig("AI", scope)?.toolsRoute;
  if (!toolsRoute) throw new Error("未配置 toolsRoute，无法生成记忆向量");

  const resolved = resolveRouteTarget(toolsRoute, scope);
  if (!resolved || resolved.provider.protocol !== "gemini") {
    throw new Error(`工具路由 ${toolsRoute} 必须包含可用的 Gemini 目标才能生成记忆向量`);
  }
  return resolved.requestConfig;
}

export function createEmbeddingClient(selfId = null) {
  return createGeminiClient(resolveEmbeddingConfig(selfId));
}

export async function generateTextEmbedding(text, options = {}) {
  const content = String(text || "").trim();
  if (!content) throw new Error("不能为空文本生成向量");

  const {
    selfId = null,
    taskType = "",
    model = DEFAULT_EMBEDDING_MODEL,
    outputDimensionality = DEFAULT_EMBEDDING_DIMENSIONS,
  } = options;
  const client = createEmbeddingClient(selfId);
  const config = { outputDimensionality };
  if (taskType) config.taskType = taskType;

  const result = await client.models.embedContent({
    model,
    contents: content,
    config,
  });
  const values = result?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("向量模型未返回有效结果");
  }
  return values;
}
