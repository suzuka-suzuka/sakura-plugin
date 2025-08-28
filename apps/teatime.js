import { connect } from 'puppeteer-real-browser';
import { downloadImage } from '../lib/ImageUtils/ImageUtils.js';
import Setting from '../lib/setting.js';
import _ from 'lodash';

export class teatime extends plugin {
  constructor() {
    super({
      name: 'teatime',
      priority: 1135,
    });
  }

  get appconfig() {
    return Setting.getConfig("teatime");
  }

  task = {
    name: 'teatimeTask',
    fnc: () => this.teatimeTask(),
    cron: this.appconfig?.cron ?? '0 0 15 * * *',
	log: false
  };

  async teatimeTask() {
    const config = this.appconfig;
    if (!config) {
      return;
    }
    const Groups = config.Groups ?? [];

    if (Groups.length === 0) {
      return;
    }

    for (const groupId of Groups) {
      
      await Bot.pickGroup(groupId).sendMsg('下午茶时间，来点萝莉');
      
      let browser;

      try {
        const { page, browser: realBrowser } = await connect({
          headless: false,
          turnstile: true,
        });
        browser = realBrowser;
        await page.goto('https://konachan.com/post.json?tags=loli+-rating:e+-nipples&limit=500', {
          waitUntil: 'networkidle2',
          timeout: 20000
        });
        await new Promise(resolve => setTimeout(resolve, 20000));
        const jsonText = await page.evaluate(() => document.body.innerText);

        let jsonData;
        try {
          jsonData = JSON.parse(jsonText);
        } catch (parseError) {
          logger.error(`[teatime]群 ${groupId} JSON 解析失败:`, parseError);
          if (browser) {
            await browser.close();
          }
          continue;
        }

        if (Array.isArray(jsonData) && jsonData.length > 0) {
          if (browser) {
            await browser.close();
            browser = null;
          }

          const imageUrls = jsonData
            .map(item => item?.file_url)
            .filter(url => url);

          if (imageUrls.length > 0) {
            const selectedUrls = _.sampleSize(imageUrls, 5);
            for (const imageUrl of selectedUrls) {
              const imageData = await downloadImage(imageUrl);
              if (imageData) {
                try {
                  await Bot.pickGroup(groupId).sendMsg(segment.image(imageData));
                } catch (sendError) {
                  logger.error(`[teatime]向群 ${groupId} 发送图片消息失败:`, sendError);
                }
              } else {
                logger.warn(`[teatime]群 ${groupId} 图片下载失败: ${imageUrl}`);
              }
            }
          } else {
            logger.warn(`[teatime]群 ${groupId} 获取到的图片URL列表为空。`);
          }
        } else {
          logger.info(`[teatime]群 ${groupId} 获取到 API 数据，但数据为空或格式不正确。`, jsonData);
          if (browser) {
            await browser.close();
          }
        }
      } catch (error) {
        logger.error(`[teatime]群 ${groupId} 整体处理流程出错:`, error);
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }
  }
}