/**
 * 迁移脚本：将1.5倍金币卡替换为双倍金币卡
 * 遍历所有背包和钓鱼历史数据，将item_card_1_5_coin替换为item_card_double_coin
 */
import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../path.js";

const MIGRATION_KEY = "migration_gold_card_completed";
const OLD_ITEM_ID = "item_card_1_5_coin";
const NEW_ITEM_ID = "item_card_double_coin";

async function migrateInventory() {
  const inventoryPath = path.join(plugindata, "economy", "inventory");
  
  if (!fs.existsSync(inventoryPath)) {
    logger.info("[迁移] 背包目录不存在，跳过背包迁移");
    return { files: 0, items: 0 };
  }
  
  const files = fs.readdirSync(inventoryPath).filter(f => f.endsWith(".json"));
  let totalMigrated = 0;
  
  for (const file of files) {
    const filePath = path.join(inventoryPath, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      let modified = false;
      
      for (const userId in data) {
        const inventory = data[userId];
        if (inventory[OLD_ITEM_ID]) {
          const count = inventory[OLD_ITEM_ID];
          // 将1.5倍金币卡数量加到双倍金币卡上
          if (!inventory[NEW_ITEM_ID]) {
            inventory[NEW_ITEM_ID] = 0;
          }
          inventory[NEW_ITEM_ID] += count;
          delete inventory[OLD_ITEM_ID];
          modified = true;
          totalMigrated += count;
          logger.info(`[迁移] 群${file.replace(".json", "")} 用户${userId}: 将${count}个1.5倍金币卡替换为双倍金币卡`);
        }
      }
      
      if (modified) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      }
    } catch (err) {
      logger.error(`[迁移] 处理背包文件 ${file} 失败: ${err.message}`);
    }
  }
  
  return { files: files.length, items: totalMigrated };
}

async function migrateFishingHistory() {
  const fishingPath = path.join(plugindata, "economy", "fishing");
  
  if (!fs.existsSync(fishingPath)) {
    logger.info("[迁移] 钓鱼数据目录不存在，跳过钓鱼历史迁移");
    return { files: 0, records: 0 };
  }
  
  const files = fs.readdirSync(fishingPath).filter(f => f.endsWith(".json"));
  let totalMigrated = 0;
  
  for (const file of files) {
    const filePath = path.join(fishingPath, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      let modified = false;
      
      for (const userId in data) {
        const userData = data[userId];
        // 检查fishCounts中是否有1.5倍金币卡的记录
        if (userData.fishCounts && userData.fishCounts[OLD_ITEM_ID]) {
          const count = userData.fishCounts[OLD_ITEM_ID];
          // 将记录迁移到双倍金币卡
          if (!userData.fishCounts[NEW_ITEM_ID]) {
            userData.fishCounts[NEW_ITEM_ID] = 0;
          }
          userData.fishCounts[NEW_ITEM_ID] += count;
          delete userData.fishCounts[OLD_ITEM_ID];
          modified = true;
          totalMigrated += count;
          logger.info(`[迁移] 群${file.replace(".json", "")} 用户${userId}: 钓鱼历史中${count}条1.5倍金币卡记录迁移为双倍金币卡`);
        }
      }
      
      if (modified) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      }
    } catch (err) {
      logger.error(`[迁移] 处理钓鱼数据文件 ${file} 失败: ${err.message}`);
    }
  }
  
  return { files: files.length, records: totalMigrated };
}

export async function runMigration() {
  // 检查是否已经执行过迁移
  const migrationFlagPath = path.join(plugindata, ".migrations");
  const migrationFlagFile = path.join(migrationFlagPath, `${MIGRATION_KEY}.flag`);
  
  if (fs.existsSync(migrationFlagFile)) {
    logger.debug("[迁移] 1.5倍金币卡迁移已完成，跳过");
    return;
  }
  
  logger.info("[迁移] 开始执行1.5倍金币卡迁移...");
  
  try {
    const inventoryResult = await migrateInventory();
    const fishingResult = await migrateFishingHistory();
    
    // 创建迁移完成标记
    if (!fs.existsSync(migrationFlagPath)) {
      fs.mkdirSync(migrationFlagPath, { recursive: true });
    }
    fs.writeFileSync(migrationFlagFile, JSON.stringify({
      completedAt: new Date().toISOString(),
      inventoryFiles: inventoryResult.files,
      inventoryItemsMigrated: inventoryResult.items,
      fishingFiles: fishingResult.files,
      fishingRecordsMigrated: fishingResult.records
    }, null, 2));
    
    logger.info(`[迁移] 1.5倍金币卡迁移完成！`);
    logger.info(`[迁移] 背包迁移: ${inventoryResult.files}个文件, ${inventoryResult.items}个物品`);
    logger.info(`[迁移] 钓鱼历史迁移: ${fishingResult.files}个文件, ${fishingResult.records}条记录`);
  } catch (err) {
    logger.error(`[迁移] 迁移过程中出错: ${err.message}`);
  }
}

export default { runMigration };
