import fs from "fs";
import path from "path";
import { plugindata } from "../path.js";

const memoryRoot = path.join(plugindata, "memory");
export const MEMORY_CHARACTER_LIMIT = 8000;

function normalizeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

export function getMemoryFile({ groupId = null, userId, scope = "user" }) {
  if (scope === "group") {
    const normalizedGroupId = normalizeId(groupId, "群号");
    return path.join(memoryRoot, "groups", `${normalizedGroupId}.json`);
  }

  if (scope !== "user") {
    throw new Error("不支持的记忆作用域");
  }

  const normalizedUserId = normalizeId(userId, "QQ号");
  if (groupId === undefined || groupId === null || groupId === "") {
    return path.join(memoryRoot, "private", `${normalizedUserId}.json`);
  }

  const normalizedGroupId = normalizeId(groupId, "群号");
  return path.join(
    memoryRoot,
    "group-users",
    `${normalizedGroupId}-${normalizedUserId}.json`
  );
}

export function readMemories(memoryFile, options = {}) {
  const { throwOnError = false } = options;
  if (!fs.existsSync(memoryFile)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
    if (!Array.isArray(parsed) || parsed.some((memory) => typeof memory !== "string")) {
      throw new Error("记忆文件必须是字符串数组");
    }
    return parsed;
  } catch (error) {
    if (throwOnError) {
      throw error;
    }
    return [];
  }
}

export function countMemoryCharacters(memories) {
  if (!Array.isArray(memories)) return 0;
  return memories.reduce(
    (total, memory) => total + Array.from(String(memory)).length,
    0
  );
}

export function writeMemories(memoryFile, memories) {
  if (!Array.isArray(memories) || memories.some((memory) => typeof memory !== "string")) {
    throw new Error("记忆必须是字符串数组");
  }

  const characterCount = countMemoryCharacters(memories);
  if (characterCount > MEMORY_CHARACTER_LIMIT) {
    throw new Error(
      `记忆内容超过 ${MEMORY_CHARACTER_LIMIT} 字符上限（当前 ${characterCount} 字符）`
    );
  }

  const dir = path.dirname(memoryFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2));
}
