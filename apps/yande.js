import { yandeimage, checkAndFlipImage } from '../lib/ImageUtils/ImageUtils.js';

export class yandePlugin extends plugin {
  constructor() {
    super({
      name: 'yande-axios',
      priority: 1135,
      dsc: '通过 axios + 代理请求 API 获取随机一张图片并发送',
      event: 'message.group',
      rule: [
        {
          reg: '^#?图y$',
          fnc: 'yande',
          log: false
        }
      ]
    });
  }

  async yande(e) {
    e.reply('正在获取中，请稍候...');

    const apiUrl = 'https://yande.re/post.json?tags=loli+-rating:e+-nipples&limit=500';
    let imageBuffer = await yandeimage(apiUrl);

    if (!imageBuffer) {
      await e.reply('获取失败，请重试');
      return;
    }

    let sendResult = await e.reply(segment.image(imageBuffer));

    const { success: firstSendSuccess, processedBuffer: finalImageBuffer } = await checkAndFlipImage(imageBuffer, sendResult);

    let finalSendSuccess = firstSendSuccess;

    if (!firstSendSuccess) {
      e.reply('图片发送失败，正在尝试翻转后重发...');
      logger.info('首次发送请求失败，尝试第二次发送。');

      sendResult = await e.reply(segment.image(finalImageBuffer));
      if (sendResult && sendResult.message_id) {
        finalSendSuccess = true;
      } else {
        logger.error('第二次发送尝试（可能翻转后）仍然失败。');
        finalSendSuccess = false;
      }
    }

    if (!finalSendSuccess) {
      await e.reply('图片最终发送失败，请稍后重试。');
    }
  }
}