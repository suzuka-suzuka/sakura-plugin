import Setting from "../lib/setting.js";
import schedule from "node-schedule";
import { getBots } from "../../../src/api/client.js";

export class News60s extends plugin {
  constructor() {
    super({
      name: "60sNews",
      priority: 1135,
      configWatch: "60sNews",
    });
  }

  get appconfig() {
    return Setting.getConfig("60sNews");
  }

  getScopeIds() {
    return getBots()
      .map((currentBot) => Number(currentBot.self_id))
      .filter((selfId) => Number.isFinite(selfId));
  }

  async init() {
    for (const selfId of this.getScopeIds()) {
      const config = Setting.getConfig("60sNews", { selfId });
      const groups = Array.isArray(config?.Groups) ? config.Groups : [];
      if (!groups.length) {
        continue;
      }

      const cronExpression = String(config?.cron || "0 8 * * *").trim();
      try {
        const job = schedule.scheduleJob(cronExpression, async () => {
          await this.runForSelf(selfId);
        });
        if (job) {
          this.jobs.push(job);
        }
      } catch (error) {
        logger.warn(`[60sNews] 跳过无效 cron 配置: ${selfId} -> ${cronExpression} (${error.message})`);
      }
    }
  }

  async runForSelf(selfId) {
    const currentBot = this.getBot(selfId);
    if (!currentBot) return;

    const config = Setting.getConfig("60sNews", { selfId });

    const groups = Array.isArray(config?.Groups) ? config.Groups : [];
    if (!groups.length) {
      return;
    }

    const imageUrl = "https://60s.viki.moe/v2/60s?encoding=image-proxy";

    for (const groupId of groups) {
      try {
        await currentBot.pickGroup(groupId).sendMsg(segment.image(imageUrl));
      } catch (error) {
        logger.error(`[60sNews] 向群 ${groupId} 发送新闻失败:`, error);
      }
    }
  }
}
