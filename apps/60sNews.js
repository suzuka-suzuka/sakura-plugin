import Setting from '../lib/setting.js';

export class News60s extends plugin {
  constructor() {
    super({
      name: '60sNews',
      priority: 35,
    });
  }

  task = {
    name: '60sNews定时发送',
    cron: '0 0 8 * * *',
    fnc: () => this.dailyNewsTask(),
    log: false
  };

  get appconfig() {
    return Setting.getConfig("60sNews");
  }

  async dailyNewsTask() {
    const config = this.appconfig;
    if (!config) {
      return;
    }

    const groups = config.Groups ?? [];
    if (groups.length === 0) {
      return;
    }

    const imgBuffer = await this.getNewsImageBuffer();
    if (!imgBuffer) {
        logger.error('[60sNews] 定时任务失败：无法获取新闻图片。');
        return;
    }

    for (const groupId of groups) {
      try {
        await Bot.pickGroup(groupId).sendMsg(segment.image(imgBuffer));
      } catch (error) {
        logger.error(`[60sNews] 向群 ${groupId} 发送新闻失败:`, error);
      }
    }
  }

  async getNewsImageBuffer() {
    const url = 'https://60s.viki.moe/v2/60s?encoding=image-proxy';
    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.error(`[60sNews] API请求失败，状态码: ${response.status}`);
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (error) {
      logger.error('[60sNews] 获取新闻图片时出错:', error);
      return null;
    }
  }
}