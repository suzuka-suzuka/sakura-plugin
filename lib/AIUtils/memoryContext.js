import {
  getMemoryLocations,
  readMemoryDocument,
} from "./memoryStore.js";
import { scheduleMemoryMaintenance } from "./memoryMaintenance.js";
import { memoryVectorStore } from "./memoryVectorStore.js";

export const DIRECT_MEMORY_INJECTION_LIMIT = 10;
export const VECTOR_MEMORY_RESULTS_PER_SCOPE = 10;

function toContextMemory(target, memory) {
  return {
    id: memory.id,
    content: memory.content,
    scope: target.location.scope,
    scopeKey: target.location.scopeKey,
    title: target.location.title,
  };
}

export function getDirectMemoryMatches(targets = []) {
  return targets.flatMap((target) => {
    const memories = target.document?.memories || [];
    if (memories.length === 0 || memories.length > DIRECT_MEMORY_INJECTION_LIMIT) {
      return [];
    }
    return memories.map((memory) => toContextMemory(target, memory));
  });
}

export function getVectorMemoryTargets(targets = []) {
  return targets.filter(
    (target) => target.document?.memories?.length > DIRECT_MEMORY_INJECTION_LIMIT
  );
}

export async function resolveAutomaticMemoryMatches(query, targets, options = {}) {
  const directMatches = getDirectMemoryMatches(targets);
  const vectorTargets = getVectorMemoryTargets(targets);
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery || vectorTargets.length === 0) return directMatches;

  const vectorSearch = options.vectorSearch
    || ((...args) => memoryVectorStore.search(...args));
  const vectorMatches = await vectorSearch(normalizedQuery, vectorTargets, {
    selfId: options.selfId ?? null,
    maxResults: VECTOR_MEMORY_RESULTS_PER_SCOPE,
    resultsPerScope: true,
    includeLowScore: true,
  });
  return [...directMatches, ...vectorMatches];
}

function extractText(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => typeof part?.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join("\n");
}

function getRetrievalQuery(queryParts) {
  return extractText(queryParts);
}

export function formatMemoryContext(targets, matches) {
  const parts = [
    "【长期记忆背景】\n以下内容是保存的背景记忆",
  ];
  for (const target of targets) {
    if (target.document.memories.length === 0) continue;
    if (!target.document.summary.text.trim()) continue;
    parts.push(`【${target.location.title}摘要】\n${target.document.summary.text.trim()}`);
  }
  if (matches.length > 0) {
    const lines = matches.map((match) => `- [${match.title}] ${match.content}`);
    parts.push(`【相关的长期记忆】\n${lines.join("\n")}`);
  }
  return parts.length > 1 ? parts.join("\n\n") : "";
}

export async function buildMemoryContext(e, queryParts) {
  if (!e?.user_id) return "";
  const locations = getMemoryLocations({
    groupId: e.group_id,
    userId: e.user_id,
    scope: "all",
  });
  const targets = [];
  for (const location of locations) {
    try {
      const document = readMemoryDocument(location.memoryFile, { throwOnError: true });
      targets.push({ location, document });
      scheduleMemoryMaintenance({ location, e });
    } catch (error) {
      logger.warn(`[Memory] 跳过无效记忆文件 ${location.memoryFile}: ${error.message}`);
    }
  }

  const query = getRetrievalQuery(queryParts);
  let matches = getDirectMemoryMatches(targets);
  if (query && getVectorMemoryTargets(targets).length > 0) {
    try {
      matches = await resolveAutomaticMemoryMatches(query, targets, {
        selfId: e.self_id,
      });
    } catch (error) {
      logger.warn(`[Memory] 自动向量召回失败，继续生成回复: ${error.message}`);
    }
  }
  return formatMemoryContext(targets, matches);
}
