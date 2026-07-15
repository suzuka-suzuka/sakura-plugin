import Setting from "../lib/setting.js";
import { getCurrentBotSelfId } from "../../../src/api/client.js";

const DEFAULT_CRON_EXPRESSION = "0 8 * * *";

export class News60s extends plugin {
  constructor() {
    super({
      name: "60sNews",
      priority: 1135,
    });
  }

  newsTask = Cron(DEFAULT_CRON_EXPRESSION, async () => {
    const selfId = getCurrentBotSelfId();
    if (selfId == null) {
      logger.warn("[60sNews] 触发定时任务时没有在线账号，已跳过本次推送");
      return;
    }

    await this.runForSelf(selfId);
  });

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
