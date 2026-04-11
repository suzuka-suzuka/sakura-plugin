import fs from "fs";
import path from "path";
import { plugindata } from "../path.js";

function normalizeScopeValue(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

export function getMemoryPaths({ groupId = null, userId }) {
  const normalizedGroupId = normalizeScopeValue(groupId, "private");
  const normalizedUserId = normalizeScopeValue(userId, "");

  const scopedFile = path.join(
    plugindata,
    "mimic",
    normalizedGroupId,
    `${normalizedUserId}.json`
  );

  return {
    scopedFile,
    candidates: [scopedFile],
  };
}

export function getMemoryPathsFromEvent(e) {
  return getMemoryPaths({
    groupId: e?.group_id,
    userId: e?.user_id,
  });
}

export function findExistingMemoryFile(input) {
  const candidates = Array.isArray(input) ? input : input?.candidates || [];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

export function readMemories(input, options = {}) {
  const { throwOnError = false } = options;
  const memoryFile = findExistingMemoryFile(input);

  if (!memoryFile) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (throwOnError) {
      throw error;
    }
    return [];
  }
}

export function writeMemories(scopedFile, memories) {
  const dir = path.dirname(scopedFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(scopedFile, JSON.stringify(memories, null, 2));
}
