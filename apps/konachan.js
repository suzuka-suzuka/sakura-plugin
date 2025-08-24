import { connect } from 'puppeteer-real-browser';
import { downloadImage, checkAndFlipImage } from '../lib/ImageUtils/ImageUtils.js';
import _ from 'lodash';

export class konachanPlugin extends plugin {
  constructor() {
    super({
      name: 'konachan-puppeteer-real-browser',
      dsc: '通过 puppeteer-real-browser 获取指定页面的图片数据并发送',
      event: 'message.group',
      priority: 1135,
      rule: [
        {
          reg: '^#?图k$',
          fnc: 'konachan',
          log: false
        }
      ]
    });
  }

  async konachan(e) {
    e.reply('正在获取中，请稍候...');

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
        console.error('[konachanPlugin] JSON 解析失败:', parseError);
        await e.reply('获取失败，请重试');
        return;
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
          const imageUrl = _.sample(imageUrls);
          const imageData = await downloadImage(imageUrl);

          if (imageData) {
            let sendResult = await e.reply(segment.image(imageData));

            const { success: firstSendSuccess, processedBuffer: finalImageBuffer } = await checkAndFlipImage(imageData, sendResult);

            let finalSendSuccess = firstSendSuccess;

            if (!firstSendSuccess) {
              e.reply('图片发送失败，正在尝试翻转后重发...');

              sendResult = await e.reply(segment.image(finalImageBuffer));
              if (sendResult && sendResult.message_id) {
                finalSendSuccess = true;
              } else {
                finalSendSuccess = false;
              }
            }
            if (!finalSendSuccess) {
              await e.reply('图片最终发送失败，请稍后重试。');
            }

          } else {
            console.warn('[konachanPlugin] 图片下载失败:', imageUrl);
          }
        } else {
          console.warn('[konachanPlugin] 没有获取到有效的图片URL。');
          await e.reply('获取失败，没有找到可用的图片。');
        }

      } else {
        await e.reply('获取失败，请重试');
      }

    } catch (error) {
      console.error('[konachanPlugin] 整体处理流程出错:', error);
      await e.reply('获取失败，请重试');
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}