import fs from "fs";
import path from "path";
import Setting from "../setting.js";
import { plugindata } from "../path.js";

const HISTORY_DIR = path.join(plugindata, "conversationHistory");

if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function getScopeDir() {
  return HISTORY_DIR;
}

function getFilePath(groupId, userId) {
  const folderName = groupId ? String(groupId) : "private";
  const fileName = `${userId}.json`;
  return path.join(getScopeDir(), folderName, fileName);
}

function getEventFilePath(e) {
  return getFilePath(e?.group_id, e?.user_id);
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fs.promises.access(dir);
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readUserFile(filePath) {
  try {
    await fs.promises.access(filePath);
    const data = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.error(`读取历史记录文件失败: ${err}`);
    }
    return {};
  }
}

async function writeUserFile(filePath, data) {
  try {
    await ensureDir(filePath);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logger.error(`写入历史记录文件失败: ${err}`);
  }
}

async function removeEmptyDirs(dirPath, stopDir = HISTORY_DIR) {
  let currentDir = dirPath;

  while (currentDir && currentDir.startsWith(stopDir) && currentDir !== stopDir) {
    let files = [];
    try {
      files = await fs.promises.readdir(currentDir);
    } catch {
      return;
    }

    if (files.length > 0) {
      return;
    }

    await fs.promises.rmdir(currentDir).catch(() => {});
    currentDir = path.dirname(currentDir);
  }
}

async function deleteHistoryFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
    await removeEmptyDirs(path.dirname(filePath));
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`删除历史记录文件失败: ${err}`);
    }
  }
}

async function getScopedUserData(e) {
  const filePath = getEventFilePath(e);
  const userData = await readUserFile(filePath);
  return { filePath, userData };
}

function getFunctionCallId(part) {
  const id = part?.functionCall?.id;
  return id == null ? null : String(id);
}

function getFunctionResponseId(part) {
  const id = part?.functionResponse?.id;
  return id == null ? null : String(id);
}

function hasFunctionCall(item) {
  return item?.role === "model" && item.parts?.some((part) => part.functionCall);
}

function withoutFunctionCalls(item) {
  const parts = Array.isArray(item?.parts)
    ? item.parts.filter((part) => !part.functionCall)
    : [];

  return parts.length > 0
    ? { ...item, parts }
    : null;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function removeTrailingToolExchange(history) {
  while (history.length > 0) {
    const last = history[history.length - 1];

    if (last?.role === "function") {
      history.pop();

      const previous = history[history.length - 1];
      if (hasFunctionCall(previous)) {
        const textOnlyModel = withoutFunctionCalls(previous);
        if (textOnlyModel) {
          history[history.length - 1] = textOnlyModel;
        } else {
          history.pop();
        }
      }
      continue;
    }

    if (hasFunctionCall(last)) {
      const textOnlyModel = withoutFunctionCalls(last);
      if (textOnlyModel) {
        history[history.length - 1] = textOnlyModel;
      } else {
        history.pop();
      }
      continue;
    }

    break;
  }
}

export function sanitizeConversationHistory(history = []) {
  if (!Array.isArray(history)) return [];

  const sanitized = [];

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (!item || !Array.isArray(item.parts)) continue;

    if (item.role === "function") {
      continue;
    }

    if (item.role !== "model") {
      if (item.parts.length > 0) {
        sanitized.push(item);
      }
      continue;
    }

    const functionCallParts = item.parts.filter((part) => part.functionCall);
    if (functionCallParts.length === 0) {
      if (item.parts.length > 0) {
        sanitized.push(item);
      }
      continue;
    }

    const callIds = functionCallParts
      .map(getFunctionCallId)
      .filter(Boolean);
    const next = history[i + 1];
    const responseParts = next?.role === "function" && Array.isArray(next.parts)
      ? next.parts.filter((part) => {
          const responseId = getFunctionResponseId(part);
          return responseId && callIds.includes(responseId);
        })
      : [];
    const responseIds = new Set(responseParts.map(getFunctionResponseId));
    const hasAllResponses = callIds.length > 0 && callIds.every((id) => responseIds.has(id));

    if (hasAllResponses) {
      sanitized.push({
        ...item,
        parts: item.parts.filter((part) => !part.functionCall || callIds.includes(getFunctionCallId(part))),
      });
      sanitized.push({
        ...next,
        parts: responseParts,
      });
      i++;
      continue;
    }

    const textOnlyModel = withoutFunctionCalls(item);
    if (textOnlyModel) {
      sanitized.push(textOnlyModel);
    }
  }

  removeTrailingToolExchange(sanitized);
  return sanitized;
}

function sanitizeHistoryInPlace(history) {
  const sanitized = sanitizeConversationHistory(history);
  history.splice(0, history.length, ...sanitized);
  return history;
}

export function groupConversationRounds(history = []) {
  if (!Array.isArray(history)) return [];

  const rounds = [];
  let currentRound = [];

  for (const item of history) {
    if (!item) continue;

    if (item.role === "user") {
      if (currentRound.length > 0) {
        rounds.push(currentRound);
      }
      currentRound = [item];
      continue;
    }

    if (currentRound.length === 0) {
      currentRound = [item];
    } else {
      currentRound.push(item);
    }
  }

  if (currentRound.length > 0) {
    rounds.push(currentRound);
  }

  return rounds;
}

export function getConversationRoundCount(history = []) {
  return groupConversationRounds(history).length;
}

export function trimConversationHistoryByRounds(history = [], maxRounds = 20) {
  const rounds = groupConversationRounds(history);
  const limit = Math.max(0, Math.floor(Number(maxRounds) || 0));
  const keptRounds = limit > 0 ? rounds.slice(-limit) : [];
  return keptRounds.flat();
}

async function listHistoryFiles(dirPath) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listHistoryFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function loadConversationHistory(e, profilePrefix) {
  const { filePath, userData } = await getScopedUserData(e);

  if (userData?.[profilePrefix] && Array.isArray(userData[profilePrefix].history)) {
    const history = userData[profilePrefix].history;
    const sanitized = sanitizeConversationHistory(history);

    if (!sameJson(history, sanitized)) {
      userData[profilePrefix].history = sanitized;
      await writeUserFile(filePath, userData);
      logger.warn(`[ConversationHistory] 已清理不完整的工具调用历史: ${profilePrefix}`);
    }

    return sanitized;
  }
  return [];
}

export async function saveConversationHistory(e, currentFullHistory, profilePrefix) {
  const { filePath, userData } = await getScopedUserData(e);

  const config = Setting.getConfig("AI");
  const maxHistoryRounds = config?.chatHistoryLength || 20;

  sanitizeHistoryInPlace(currentFullHistory);

  const trimmedHistory = trimConversationHistoryByRounds(currentFullHistory, maxHistoryRounds);
  currentFullHistory.splice(0, currentFullHistory.length, ...trimmedHistory);

  sanitizeHistoryInPlace(currentFullHistory);

  if (!userData[profilePrefix]) {
    userData[profilePrefix] = {};
  }

  userData[profilePrefix].history = currentFullHistory;
  userData[profilePrefix].lastInteraction = Date.now();

  await writeUserFile(filePath, userData);
}

export async function clearConversationHistory(e, profilePrefix) {
  const filePath = getEventFilePath(e);
  const userData = await readUserFile(filePath);
  if (!userData[profilePrefix]) {
    return;
  }

  delete userData[profilePrefix];

  if (Object.keys(userData).length === 0) {
    await deleteHistoryFile(filePath);
  } else {
    await writeUserFile(filePath, userData);
  }
}

export async function clearAllPrefixesForUser(e) {
  await deleteHistoryFile(getEventFilePath(e));
}

export async function clearAllConversationHistories() {
  try {
    await fs.promises.rm(HISTORY_DIR, { recursive: true, force: true });
    await fs.promises.mkdir(HISTORY_DIR, { recursive: true });
  } catch (err) {
    logger.error(`清除全部历史记录失败: ${err}`);
  }
}

export async function cleanOldConversations() {
  try {
    const files = await listHistoryFiles(HISTORY_DIR);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;

    for (const filePath of files) {
      const userData = await readUserFile(filePath);
      let changed = false;

      for (const userPrefix of Object.keys(userData)) {
        const profileData = userData[userPrefix];
        if (profileData?.lastInteraction && now - profileData.lastInteraction > sevenDaysMs) {
          delete userData[userPrefix];
          changed = true;
          cleanedCount++;
        }
      }

      if (!changed) {
        continue;
      }

      if (Object.keys(userData).length === 0) {
        await deleteHistoryFile(filePath);
        logger.info(`[ConversationManager] 清理过期对话文件: ${path.basename(filePath)}`);
      } else {
        await writeUserFile(filePath, userData);
        logger.info(`[ConversationManager] 清理文件 ${path.basename(filePath)} 中的过期对话`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[ConversationManager] 定时清理任务完成，共清理了 ${cleanedCount} 个过期对话`);
    }
  } catch (err) {
    logger.error(`清理过期对话失败: ${err}`);
  }
}

export const ConversationHistoryUtils = {
  HISTORY_DIR,
  getScopeDir,
  getFilePath,
  readUserFile,
  writeUserFile,
  cleanOldConversations,
  pathExists,
};
