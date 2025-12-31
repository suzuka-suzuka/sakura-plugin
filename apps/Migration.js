import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../lib/path.js";

const fishingDataPath = path.join(plugindata, "economy", "fishing");
const inventoryPath = path.join(plugindata, "economy", "inventory");

if (!fs.existsSync(inventoryPath)) {
  fs.mkdirSync(inventoryPath, { recursive: true });
}

export default class Migration extends plugin {
  constructor() {
    super({
      name: "数据迁移",
      event: "message",
      priority: 9999,
    });

    // 启动时执行迁移
    this.migrateFishingData();
  }

  async migrateFishingData() {
    if (!fs.existsSync(fishingDataPath)) {
      logger.info("[迁移] 没有找到旧的钓鱼数据目录，跳过迁移");
      return;
    }

    const files = fs.readdirSync(fishingDataPath).filter(f => f.endsWith(".json"));
    let totalMigrated = 0;

    for (const file of files) {
      const groupId = file.replace(".json", "");
      const fishingFile = path.join(fishingDataPath, file);
      const inventoryFile = path.join(inventoryPath, file);

      try {
        const fishingData = JSON.parse(fs.readFileSync(fishingFile, "utf8"));
        
        // 加载现有背包数据
        let inventoryData = {};
        if (fs.existsSync(inventoryFile)) {
          inventoryData = JSON.parse(fs.readFileSync(inventoryFile, "utf8"));
        }

        let groupMigrated = 0;

        for (const userId in fishingData) {
          // 跳过特殊键
          if (userId.startsWith("_")) continue;
          
          const userData = fishingData[userId];
          
          // 检查是否有需要迁移的数据
          const hasRods = userData.rods && userData.rods.length > 0;
          const hasBaits = userData.baits && Object.keys(userData.baits).length > 0;
          
          if (!hasRods && !hasBaits) continue;

          // 初始化用户背包
          if (!inventoryData[userId]) {
            inventoryData[userId] = {};
          }

          // 迁移鱼竿
          if (hasRods) {
            for (const rodId of userData.rods) {
              if (!inventoryData[userId][rodId]) {
                inventoryData[userId][rodId] = 0;
              }
              inventoryData[userId][rodId] += 1;
            }
            delete userData.rods;
          }

          // 迁移鱼饵
          if (hasBaits) {
            for (const [baitId, count] of Object.entries(userData.baits)) {
              if (!inventoryData[userId][baitId]) {
                inventoryData[userId][baitId] = 0;
              }
              inventoryData[userId][baitId] += count;
            }
            delete userData.baits;
            if (userData.baitCount !== undefined) {
              delete userData.baitCount;
            }
          }

          groupMigrated++;
        }

        if (groupMigrated > 0) {
          // 保存更新后的背包数据
          fs.writeFileSync(inventoryFile, JSON.stringify(inventoryData, null, 2));
          // 保存更新后的钓鱼数据（已移除 rods 和 baits）
          fs.writeFileSync(fishingFile, JSON.stringify(fishingData, null, 2));
          
          totalMigrated += groupMigrated;
          logger.info(`[迁移] 群 ${groupId}: 迁移了 ${groupMigrated} 个用户的渔具数据`);
        }
      } catch (err) {
        logger.error(`[迁移] 群 ${groupId} 数据迁移失败: ${err.message}`);
      }
    }

    if (totalMigrated > 0) {
      logger.info(`[迁移] 渔具数据迁移完成，共迁移 ${totalMigrated} 个用户`);
    } else {
      logger.info("[迁移] 没有需要迁移的渔具数据");
    }
  }
}
