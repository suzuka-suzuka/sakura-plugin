import fs from "node:fs";
import path from "node:path";
import FishingManager from "../lib/economy/FishingManager.js";
import { plugindata } from "../lib/path.js";

const fishingDataPath = path.join(plugindata, "economy", "fishing");

export default class TorpedoCleanup extends plugin {
  constructor() {
    super({
      name: "鱼雷清理任务",
      priority: 1000,
    });
  }

  cleanupTask = Cron("0 0 4 * * *", async () => {
    if (!fs.existsSync(fishingDataPath)) {
      return;
    }

    const files = fs.readdirSync(fishingDataPath).filter(file => file.endsWith(".json"));
    let totalRemoved = 0;

    for (const file of files) {
      try {
        const groupId = file.replace(".json", "");
        if (!/^\d+$/.test(groupId)) continue;

        const fishingManager = new FishingManager(groupId);
        const count = fishingManager.cleanupExpiredTorpedos();
        
        if (count > 0) {
          logger.mark(`[鱼雷清理] 群 ${groupId} 清除了 ${count} 个过期鱼雷`);
          totalRemoved += count;
        }
      } catch (err) {
        logger.error(`[鱼雷清理] 处理群数据 ${file} 时出错: ${err}`);
      }
    }

    if (totalRemoved > 0) {
      logger.info(`[鱼雷清理] 任务完成，共清理 ${totalRemoved} 个过期鱼雷`);
    }
  });
}
