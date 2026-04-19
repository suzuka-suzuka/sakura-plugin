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
  const { userData } = await getScopedUserData(e);

  if (userData?.[profilePrefix] && Array.isArray(userData[profilePrefix].history)) {
    return userData[profilePrefix].history;
  }
  return [];
}

export async function saveConversationHistory(e, currentFullHistory, profilePrefix) {
  const { filePath, userData } = await getScopedUserData(e);

  const config = Setting.getConfig("AI");
  const maxHistoryItems = (config?.chatHistoryLength || 20) * 2;

  while (currentFullHistory.length > maxHistoryItems) {
    currentFullHistory.shift();
  }

  while (currentFullHistory.length > 0) {
    const first = currentFullHistory[0];
    if (first.role === "function") {
      currentFullHistory.shift();
    } else if (
      first.role === "model" &&
      first.parts?.some((part) => part.functionCall)
    ) {
      currentFullHistory.shift();
    } else {
      break;
    }
  }

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
