import fs from "fs";
import path from "path";
import Setting from "../setting.js";

const HISTORY_DIR = path.join(process.cwd(), "plugins", "sakura-plugin", "data", "conversationHistory");

// 确保存储目录存在
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function getFilePath(group_id, user_id) {
  const folderName = group_id ? String(group_id) : "private";
  const fileName = `${user_id}.json`;
  return path.join(HISTORY_DIR, folderName, fileName);
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fs.promises.access(dir);
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

async function readUserFile(filePath) {
  try {
    await fs.promises.access(filePath);
    const data = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code !== 'ENOENT') {
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

export async function loadConversationHistory(e, profilePrefix) {
  const filePath = getFilePath(e.group_id, e.user_id);
  const userData = await readUserFile(filePath);

  if (userData && userData[profilePrefix] && Array.isArray(userData[profilePrefix].history)) {
    return userData[profilePrefix].history;
  }
  return [];
}

export async function saveConversationHistory(e, currentFullHistory, profilePrefix) {
  const filePath = getFilePath(e.group_id, e.user_id);
  const userData = await readUserFile(filePath);

  const config = Setting.getConfig("AI");
  const maxHistoryItems = (config?.chatHistoryLength || 20) * 2;

  while (currentFullHistory.length > maxHistoryItems) {
    currentFullHistory.shift();
  }

  // 初始化或更新该 profile 的数据
  if (!userData[profilePrefix]) {
    userData[profilePrefix] = {};
  }

  userData[profilePrefix].history = currentFullHistory;

  // 更新最后互动时间
  userData[profilePrefix].lastInteraction = Date.now();

  await writeUserFile(filePath, userData);
}

export async function clearConversationHistory(e, profilePrefix) {
  const filePath = getFilePath(e.group_id, e.user_id);
  const userData = await readUserFile(filePath);

  if (userData[profilePrefix]) {
    delete userData[profilePrefix];

    // 如果该用户没有任何 profile 数据了，删除文件
    if (Object.keys(userData).length === 0) {
      try {
        await fs.promises.unlink(filePath);
        // 尝试删除空文件夹
        const dir = path.dirname(filePath);
        const files = await fs.promises.readdir(dir);
        if (files.length === 0) {
          await fs.promises.rmdir(dir);
        }
      } catch (err) {
        logger.warn(`删除空历史文件/文件夹失败: ${err}`);
      }
    } else {
      await writeUserFile(filePath, userData);
    }
  }
}

export async function clearAllPrefixesForUser(e) {
  const filePath = getFilePath(e.group_id, e.user_id);
  try {
    await fs.promises.unlink(filePath);
    // 尝试删除空文件夹
    const dir = path.dirname(filePath);
    const files = await fs.promises.readdir(dir);
    if (files.length === 0) {
      await fs.promises.rmdir(dir);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.error(`清除用户文件失败: ${err}`);
    }
  }
}

export async function clearAllConversationHistories() {
  try {
    await fs.promises.rm(HISTORY_DIR, { recursive: true, force: true });
    await fs.promises.mkdir(HISTORY_DIR, { recursive: true });
  } catch (err) {
    logger.error(`清除全部历史记录失败: ${err}`);
  }
}

/**
 * 遍历并清理超过 7 天未互动的对话
 */
export async function cleanOldConversations() {
  try {
    const folders = await fs.promises.readdir(HISTORY_DIR);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;

    for (const folder of folders) {
      const folderPath = path.join(HISTORY_DIR, folder);
      const stat = await fs.promises.stat(folderPath);
      if (!stat.isDirectory()) continue;

      const files = await fs.promises.readdir(folderPath);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(folderPath, file);
        const userData = await readUserFile(filePath);
        let changed = false;

        const prefixes = Object.keys(userData);
        for (const userPrefix of prefixes) {
          const profileData = userData[userPrefix];
          // 如果有上次互动时间且超过7天
          if (profileData.lastInteraction && (now - profileData.lastInteraction > sevenDaysMs)) {
            delete userData[userPrefix];
            changed = true;
            cleanedCount++;
          }
        }

        if (changed) {
          if (Object.keys(userData).length === 0) {
            await fs.promises.unlink(filePath);
            logger.info(`[ConversationManager] 清理过期对话文件: ${file}`);
          } else {
            await writeUserFile(filePath, userData);
            logger.info(`[ConversationManager] 清理文件 ${file} 中的过期对话`);
          }
        }
      }

      // 这里的文件夹如果空了可以删除，但不是非必须
      const remainingFiles = await fs.promises.readdir(folderPath);
      if (remainingFiles.length === 0) {
        await fs.promises.rmdir(folderPath);
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
  readUserFile,
  writeUserFile,
  cleanOldConversations
};
