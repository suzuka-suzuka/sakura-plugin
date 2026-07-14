import crypto from "node:crypto";
import path from "node:path";
import { LocalIndex } from "vectra";
import { memoryRoot, readMemoryDocument } from "./memoryStore.js";
import { generateTextEmbedding } from "./embeddingProvider.js";

const VECTOR_INDEX_DIR = path.join(memoryRoot, "vector-index");
export const DEFAULT_MEMORY_SEARCH_RESULTS = 8;
export const MAX_MEMORY_SEARCH_RESULTS = 20;
export const DEFAULT_MEMORY_MIN_SCORE = 0.6;

function hashContent(content) {
  return crypto.createHash("sha256").update(String(content)).digest("hex");
}

class MemoryVectorStore {
  constructor() {
    this.index = null;
    this.initPromise = null;
    this.operationQueue = Promise.resolve();
  }

  async ensureInit() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.index = new LocalIndex(VECTOR_INDEX_DIR);
        if (!(await this.index.isIndexCreated())) {
          await this.index.createIndex();
        }
      })();
    }
    await this.initPromise;
  }

  async withIndexLock(action) {
    const previous = this.operationQueue;
    let release;
    this.operationQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      await this.ensureInit();
      return await action();
    } finally {
      release();
    }
  }

  async syncDocument(location, document, options = {}) {
    const selfId = options.selfId ?? null;
    const existingItems = await this.withIndexLock(() =>
      this.index.listItemsByMetadata({ scopeKey: location.scopeKey })
    );
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const memoriesToIndex = document.memories.filter((memory) => {
      const item = existingById.get(memory.id);
      return !item || item.metadata?.contentHash !== hashContent(memory.content);
    });

    const indexedMemories = await Promise.all(
      memoriesToIndex.map(async (memory) => ({
        memory,
        vector: await generateTextEmbedding(memory.content, {
          selfId,
          taskType: "RETRIEVAL_DOCUMENT",
        }),
      }))
    );

    const latest = readMemoryDocument(location.memoryFile, { throwOnError: true });
    const latestById = new Map(latest.memories.map((memory) => [memory.id, memory]));
    await this.withIndexLock(async () => {
      const currentItems = await this.index.listItemsByMetadata({
        scopeKey: location.scopeKey,
      });
      const staleIds = currentItems
        .filter((item) => !latestById.has(item.id))
        .map((item) => item.id);
      for (const id of staleIds) {
        await this.index.deleteItem(id);
      }
      for (const { memory, vector } of indexedMemories) {
        const latestMemory = latestById.get(memory.id);
        if (!latestMemory || hashContent(latestMemory.content) !== hashContent(memory.content)) {
          continue;
        }
        await this.index.upsertItem({
          id: memory.id,
          vector,
          metadata: {
            scopeKey: location.scopeKey,
            contentHash: hashContent(memory.content),
          },
        });
      }
    });
  }

  async search(query, targets, options = {}) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery || !Array.isArray(targets) || targets.length === 0) {
      return [];
    }

    const nonEmptyTargets = targets.filter(
      (target) => target.document?.memories?.length > 0
    );
    if (nonEmptyTargets.length === 0) return [];

    const selfId = options.selfId ?? null;
    const limit = Math.min(
      MAX_MEMORY_SEARCH_RESULTS,
      Math.max(1, Number.isInteger(options.maxResults)
        ? options.maxResults
        : DEFAULT_MEMORY_SEARCH_RESULTS)
    );
    const minScore = Number.isFinite(options.minScore)
      ? options.minScore
      : DEFAULT_MEMORY_MIN_SCORE;

    const [queryVector] = await Promise.all([
      generateTextEmbedding(normalizedQuery, {
        selfId,
        taskType: "RETRIEVAL_QUERY",
      }),
      Promise.all(
        nonEmptyTargets.map((target) =>
          this.syncDocument(target.location, target.document, { selfId })
        )
      ),
    ]);

    let rawResults;
    if (options.resultsPerScope === true) {
      const resultGroups = [];
      for (const target of nonEmptyTargets) {
        resultGroups.push(await this.withIndexLock(() =>
          this.index.queryItems(queryVector, normalizedQuery, limit, {
            scopeKey: target.location.scopeKey,
          })
        ));
      }
      rawResults = resultGroups.flat();
    } else {
      const scopeKeys = nonEmptyTargets.map((target) => target.location.scopeKey);
      const filter = {
        $or: scopeKeys.map((scopeKey) => ({ scopeKey })),
      };
      rawResults = await this.withIndexLock(() =>
        this.index.queryItems(queryVector, normalizedQuery, limit, filter)
      );
    }
    const targetByScope = new Map(
      nonEmptyTargets.map((target) => [target.location.scopeKey, target])
    );

    return rawResults.flatMap((result) => {
      if (!options.includeLowScore && result.score < minScore) return [];
      const scopeKey = result.item.metadata?.scopeKey;
      const target = targetByScope.get(scopeKey);
      const memory = target?.document.memories.find(
        (entry) => entry.id === result.item.id
      );
      if (!target || !memory) return [];
      return [{
        id: memory.id,
        content: memory.content,
        score: result.score,
        scope: target.location.scope,
        scopeKey,
        title: target.location.title,
      }];
    });
  }
}

export const memoryVectorStore = new MemoryVectorStore();
