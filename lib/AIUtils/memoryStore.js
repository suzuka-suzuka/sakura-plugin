import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../path.js";

export const MEMORY_SCHEMA_VERSION = 2;
export const MEMORY_MAINTENANCE_INTERVAL = 5;
export const memoryRoot = path.join(plugindata, "memory");

const documentLocks = new Map();

function normalizeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function normalizeMemoryId(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error("记忆 ID 不能为空");
  return normalized;
}

export function getMemoryLocation({ groupId = null, userId, scope = "user" }) {
  if (scope === "group") {
    const normalizedGroupId = normalizeId(groupId, "群号");
    return {
      scope,
      scopeKey: `group:${normalizedGroupId}`,
      title: "当前群公共记忆",
      memoryFile: path.join(memoryRoot, "groups", `${normalizedGroupId}.json`),
    };
  }

  if (scope !== "user") {
    throw new Error("不支持的记忆作用域");
  }

  const normalizedUserId = normalizeId(userId, "QQ号");
  if (groupId === undefined || groupId === null || groupId === "") {
    return {
      scope,
      scopeKey: `private:${normalizedUserId}`,
      title: "当前用户记忆",
      memoryFile: path.join(memoryRoot, "private", `${normalizedUserId}.json`),
    };
  }

  const normalizedGroupId = normalizeId(groupId, "群号");
  return {
    scope,
    scopeKey: `group-user:${normalizedGroupId}:${normalizedUserId}`,
    title: "当前用户记忆",
    memoryFile: path.join(
      memoryRoot,
      "group-users",
      `${normalizedGroupId}-${normalizedUserId}.json`
    ),
  };
}

export function getMemoryLocations({ groupId = null, userId, scope = "all" }) {
  if (!["user", "group", "all"].includes(scope)) {
    throw new Error("不支持的记忆作用域");
  }
  if (scope === "group" && !groupId) {
    throw new Error("私聊中不能访问群公共记忆");
  }

  if (scope === "user") {
    return [getMemoryLocation({ groupId, userId, scope: "user" })];
  }
  if (scope === "group") {
    return [getMemoryLocation({ groupId, userId, scope: "group" })];
  }

  const locations = [getMemoryLocation({ groupId, userId, scope: "user" })];
  if (groupId) {
    locations.push(getMemoryLocation({ groupId, userId, scope: "group" }));
  }
  return locations;
}

export function createEmptyMemoryDocument() {
  return {
    version: MEMORY_SCHEMA_VERSION,
    revision: 0,
    summary: {
      text: "",
      updatedAt: 0,
      sourceRevision: 0,
    },
    memories: [],
  };
}

export function validateMemoryDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("记忆文件必须是版本 2 的对象结构");
  }
  if (document.version !== MEMORY_SCHEMA_VERSION) {
    throw new Error(`仅支持版本 ${MEMORY_SCHEMA_VERSION} 的记忆文件`);
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    throw new Error("记忆 revision 无效");
  }
  if (!document.summary || typeof document.summary !== "object") {
    throw new Error("记忆 summary 无效");
  }
  if (typeof document.summary.text !== "string") {
    throw new Error("记忆 summary.text 必须是字符串");
  }
  if (
    !Number.isInteger(document.summary.sourceRevision)
    || document.summary.sourceRevision < 0
    || document.summary.sourceRevision > document.revision
  ) {
    throw new Error("记忆 summary.sourceRevision 无效");
  }
  if (!Number.isFinite(document.summary.updatedAt) || document.summary.updatedAt < 0) {
    throw new Error("记忆 summary.updatedAt 无效");
  }
  if (!Array.isArray(document.memories)) {
    throw new Error("记忆 memories 必须是数组");
  }

  const ids = new Set();
  for (const memory of document.memories) {
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
      throw new Error("记忆条目必须是对象");
    }
    const id = normalizeMemoryId(memory.id);
    if (ids.has(id)) throw new Error(`记忆 ID 重复：${id}`);
    ids.add(id);
    if (typeof memory.content !== "string" || !memory.content.trim()) {
      throw new Error(`记忆 ${id} 的 content 无效`);
    }
    if (!Number.isFinite(memory.createdAt) || memory.createdAt < 0) {
      throw new Error(`记忆 ${id} 的 createdAt 无效`);
    }
    if (!Number.isFinite(memory.updatedAt) || memory.updatedAt < 0) {
      throw new Error(`记忆 ${id} 的 updatedAt 无效`);
    }
  }

  return document;
}

export function readMemoryDocument(memoryFile, options = {}) {
  const { throwOnError = false } = options;
  if (!fs.existsSync(memoryFile)) return createEmptyMemoryDocument();

  try {
    const parsed = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
    return validateMemoryDocument(parsed);
  } catch (error) {
    if (throwOnError) throw error;
    return createEmptyMemoryDocument();
  }
}

export function writeMemoryDocument(memoryFile, document) {
  validateMemoryDocument(document);
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.writeFileSync(memoryFile, JSON.stringify(document, null, 2), "utf8");
}

export async function withMemoryDocumentLock(memoryFile, action) {
  const previous = documentLocks.get(memoryFile) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  documentLocks.set(memoryFile, current);

  await previous.catch(() => {});
  try {
    return await action();
  } finally {
    release();
    if (documentLocks.get(memoryFile) === current) {
      documentLocks.delete(memoryFile);
    }
  }
}

export function needsMemoryMaintenance(document) {
  validateMemoryDocument(document);
  return document.revision - document.summary.sourceRevision >= MEMORY_MAINTENANCE_INTERVAL;
}

export function appendMemory(document, options = {}) {
  validateMemoryDocument(document);
  const {
    content = "",
    now = Date.now(),
    createId = () => crypto.randomUUID(),
  } = options;

  const normalizedContent = String(content || "").trim();
  if (!normalizedContent) {
    return { error: "store 时 content 不能为空。" };
  }
  if (document.memories.some((memory) => memory.content === normalizedContent)) {
    return { error: `该记忆已存在，未重复添加：「${normalizedContent}」` };
  }

  const memory = {
    id: normalizeMemoryId(createId()),
    content: normalizedContent,
    createdAt: now,
    updatedAt: now,
  };

  return {
    memory,
    content: normalizedContent,
    document: {
      ...document,
      revision: document.revision + 1,
      memories: [...document.memories, memory],
    },
  };
}

function isNewerMemory(candidate, existing, indexById) {
  if (candidate.updatedAt !== existing.updatedAt) {
    return candidate.updatedAt > existing.updatedAt;
  }
  if (candidate.createdAt !== existing.createdAt) {
    return candidate.createdAt > existing.createdAt;
  }
  return indexById.get(candidate.id) > indexById.get(existing.id);
}

export function applyMemoryOrganization(document, organization) {
  validateMemoryDocument(document);
  if (!organization || typeof organization !== "object" || Array.isArray(organization)) {
    throw new Error("记忆整理结果必须是对象");
  }
  if (!Array.isArray(organization.memories)) {
    throw new Error("记忆整理结果 memories 必须是数组");
  }
  if (!Array.isArray(organization.discarded)) {
    throw new Error("记忆整理结果 discarded 必须是数组");
  }

  const summaryText = String(organization.summary || "").trim();
  if (document.memories.length > 0 && !summaryText) {
    throw new Error("记忆整理结果 summary 不能为空");
  }

  const memoryById = new Map(document.memories.map((memory) => [memory.id, memory]));
  const indexById = new Map(document.memories.map((memory, index) => [memory.id, index]));
  const handledIds = new Set();
  const nextMemories = [];
  const contents = new Set();

  for (const item of organization.memories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("整理后的记忆条目必须是对象");
    }
    if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
      throw new Error("整理后的记忆必须包含 sourceIds");
    }
    const sourceIds = item.sourceIds.map(normalizeMemoryId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new Error("同一条整理记忆中不能重复使用 sourceId");
    }
    const sources = sourceIds.map((id) => {
      const source = memoryById.get(id);
      if (!source) throw new Error(`整理结果引用了未知记忆 ID：${id}`);
      if (handledIds.has(id)) throw new Error(`记忆 ID 被重复处理：${id}`);
      handledIds.add(id);
      return source;
    });
    const content = String(item.content || "").trim();
    if (!content) throw new Error("整理后的记忆 content 不能为空");
    if (contents.has(content)) throw new Error(`整理后仍存在重复记忆：「${content}」`);
    contents.add(content);

    const retained = sources.reduce((newest, source) =>
      isNewerMemory(source, newest, indexById) ? source : newest
    );
    nextMemories.push({
      id: retained.id,
      content,
      createdAt: Math.min(...sources.map((source) => source.createdAt)),
      updatedAt: retained.updatedAt,
    });
  }

  const discarded = [];
  for (const item of organization.discarded) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("discarded 条目必须是对象");
    }
    const id = normalizeMemoryId(item.id);
    const supersededBy = normalizeMemoryId(item.supersededBy);
    const obsolete = memoryById.get(id);
    const replacement = memoryById.get(supersededBy);
    if (!obsolete || !replacement) {
      throw new Error("discarded 引用了未知记忆 ID");
    }
    if (handledIds.has(id)) throw new Error(`记忆 ID 被重复处理：${id}`);
    if (!isNewerMemory(replacement, obsolete, indexById)) {
      throw new Error(`不能用更旧的记忆 ${supersededBy} 覆盖 ${id}`);
    }
    handledIds.add(id);
    discarded.push({ id, supersededBy });
  }

  const keptSourceIds = new Set(
    organization.memories.flatMap((item) => item.sourceIds.map(normalizeMemoryId))
  );
  for (const item of discarded) {
    if (!keptSourceIds.has(item.supersededBy)) {
      throw new Error(`取代记忆 ${item.supersededBy} 必须保留在整理结果中`);
    }
  }
  if (handledIds.size !== document.memories.length) {
    const missingIds = document.memories
      .filter((memory) => !handledIds.has(memory.id))
      .map((memory) => memory.id);
    throw new Error(`整理结果遗漏了记忆 ID：${missingIds.join("、")}`);
  }
  if (document.memories.length > 0 && nextMemories.length === 0) {
    throw new Error("整理不能删除全部记忆");
  }

  return {
    memories: nextMemories,
    summaryText,
    removedIds: document.memories
      .filter((memory) => !nextMemories.some((item) => item.id === memory.id))
      .map((memory) => memory.id),
  };
}
