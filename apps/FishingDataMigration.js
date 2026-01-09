import fs from "node:fs";
import path from "node:path";
import { plugindata } from "../lib/path.js";

const fishingDataPath = path.join(plugindata, "economy", "fishing");

export default class FishingDataMigration extends plugin {
  constructor() {
    super({
      name: "钓鱼数据迁移",
      priority: 100, // 较高优先级，尽早执行
    });
    
    this.migrateTorpedoData();
  }

  async migrateTorpedoData() {
    if (!fs.existsSync(fishingDataPath)) return;
    
    // 稍微延迟一下确保基础环境加载完毕，虽然这里是同步读取文件
    setTimeout(() => {
        try {
            const files = fs.readdirSync(fishingDataPath).filter(file => file.endsWith(".json"));
            let fixedCount = 0;
            let fileCount = 0;

            for (const file of files) {
                try {
                    const filePath = path.join(fishingDataPath, file);
                    const content = fs.readFileSync(filePath, "utf8");
                    if (!content) continue;
                    
                    const data = JSON.parse(content);
                    
                    if (!data._torpedoPool || !Array.isArray(data._torpedoPool)) continue;
                    
                    let changed = false;
                    data._torpedoPool.forEach(t => {
                        // 补全缺失的 deployTime
                        if (!t.deployTime && t.canDetonateTime) {
                            t.deployTime = t.canDetonateTime - 12 * 60 * 60 * 1000;
                            changed = true;
                            fixedCount++;
                        }
                    });
                    
                    if (changed) {
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                        fileCount++;
                    }
                } catch (err) {
                    logger.error(`[钓鱼数据迁移] 处理文件 ${file} 失败: ${err.message}`);
                }
            }
            
            if (fixedCount > 0) {
                logger.info(`[钓鱼数据迁移] 迁移完成，已修复 ${fileCount} 个文件中的 ${fixedCount} 条旧版鱼雷数据`);
            }
        } catch (err) {
            logger.error(`[钓鱼数据迁移] 执行失败: ${err.message}`);
        }
    }, 5000);
  }
}
