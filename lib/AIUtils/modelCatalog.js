import { createHash } from "node:crypto";
import OpenAI from "openai";
import {
  CREDENTIAL_SCHEDULING_STRATEGY,
  orderScheduledItems,
} from "./providerRouter.js";
import { createGeminiClient } from "./vertexAuth.js";

const modelCache = new Map();
const inflightRequests = new Map();
const MODEL_REQUEST_TIMEOUT_MS = 15000;
const MODEL_LIST_LIMIT = 500;

function getCacheKey(provider, scopeKey) {
  return `${scopeKey || "default"}:${provider.id}`;
}

export function getProviderModelDiscoveryFingerprint(providers) {
  const discoveryConfig = (Array.isArray(providers) ? providers : []).map((provider) => ({
    id: provider.id,
    protocol: provider.protocol,
    baseURL: provider.baseURL,
    vertex: provider.vertex === true,
    credentials: (provider.credentials || []).map((credential) => ({
      auth: provider.vertex === true
        ? credential.serviceAccountRef
        : credential.apiKey,
      enabled: credential.enabled !== false,
    })),
  }));
  return createHash("sha256").update(JSON.stringify(discoveryConfig)).digest("hex");
}

function normalizeModels(models, limit) {
  const values = [];
  const seen = new Set();
  for (const model of models) {
    const raw = typeof model === "string" ? model : model?.id || model?.name;
    if (typeof raw !== "string" || !raw.trim()) continue;
    const normalized = raw.trim();
    const vertexMarkerIndex = normalized.lastIndexOf("/models/");
    const id = vertexMarkerIndex >= 0
      ? normalized.slice(vertexMarkerIndex + "/models/".length)
      : normalized.replace(/^models\//, "");
    if (seen.has(id)) continue;
    seen.add(id);
    values.push(id);
    if (values.length >= limit) break;
  }
  return values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function fetchOpenAIModels(provider, credential, limit) {
  const client = new OpenAI({
    apiKey: credential.apiKey,
    ...(provider.baseURL?.trim() && { baseURL: provider.baseURL.trim() }),
    maxRetries: 0,
    timeout: MODEL_REQUEST_TIMEOUT_MS,
  });
  const page = await client.models.list();
  const models = [];
  for await (const model of page) {
    models.push(model);
    if (models.length >= limit) break;
  }
  return models;
}

async function fetchGeminiModels(provider, credential, limit) {
  const client = createGeminiClient({
    ...provider,
    apiKey: credential.apiKey,
    serviceAccountRef: credential.serviceAccountRef,
  });
  const pager = await client.models.list({
    config: {
      pageSize: Math.min(limit, 100),
      abortSignal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    },
  });
  const models = [];
  for await (const model of pager) {
    const actions = model?.supportedActions;
    if (!Array.isArray(actions) || actions.length === 0 || actions.includes("generateContent")) {
      models.push(model);
    }
    if (models.length >= limit) break;
  }
  return models;
}

const protocolFetchers = {
  openai: fetchOpenAIModels,
  gemini: fetchGeminiModels,
};

export async function listProviderModels(provider, options = {}) {
  if (!provider?.id) throw new Error("供应商配置无效");

  const scopeKey = options.scopeKey || "default";
  const cacheKey = getCacheKey(provider, scopeKey);
  const cached = modelCache.get(cacheKey);
  if (!options.force && cached) {
    return { ...cached, cached: true };
  }
  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const request = (async () => {
    const limit = MODEL_LIST_LIMIT;
    const credentials = orderScheduledItems(
      provider.credentials || [],
      CREDENTIAL_SCHEDULING_STRATEGY,
      `model-catalog:${scopeKey}:${provider.id}`
    );
    if (credentials.length === 0) {
      throw new Error(`供应商 ${provider.id} 没有可用凭据`);
    }

    const fetcher = options.fetcher || protocolFetchers[provider.protocol];
    if (!fetcher) throw new Error(`不支持的供应商协议：${provider.protocol}`);

    let lastError = null;
    for (const credential of credentials) {
      try {
        const remoteModels = await fetcher(provider, credential, limit);
        const models = normalizeModels(remoteModels, limit);
        if (models.length === 0) {
          throw new Error("远程端点没有返回可用模型");
        }

        const fetchedAt = Date.now();
        const result = {
          providerId: provider.id,
          models,
          fetchedAt,
          cached: false,
        };
        modelCache.set(cacheKey, result);
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`拉取供应商 ${provider.id} 的模型失败：${lastError?.message || "未知错误"}`);
  })();

  inflightRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

export function clearModelCatalogCache(scopeKey = null) {
  if (scopeKey == null) {
    modelCache.clear();
    inflightRequests.clear();
    return;
  }

  const prefix = `${scopeKey}:`;
  for (const key of modelCache.keys()) {
    if (key.startsWith(prefix)) modelCache.delete(key);
  }
  for (const key of inflightRequests.keys()) {
    if (key.startsWith(prefix)) inflightRequests.delete(key);
  }
}

export async function refreshProviderModelCatalog(providers, options = {}) {
  const scopeKey = options.scopeKey || "default";
  clearModelCatalogCache(scopeKey);
  return Promise.allSettled(
    (Array.isArray(providers) ? providers : []).map((provider) =>
      listProviderModels(provider, {
        scopeKey,
        force: true,
        ...(options.fetcher && { fetcher: options.fetcher }),
      })
    )
  );
}
