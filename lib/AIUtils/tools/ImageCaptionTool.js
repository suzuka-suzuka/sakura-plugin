import { AbstractTool } from './AbstractTool.js';
import { getAI } from '../getAI.js'
import sharp from 'sharp'
import Setting from '../../setting.js'

export class ImageCaptionTool extends AbstractTool {
  name = 'imageCaption';

  parameters = {
    properties: {
      imgUrls: {
        type: 'array',
        description: '需要处理的图片URL列表。',
        items: {
          type: 'string'
        }
      },
      question: {
        type: 'string',
        description: '你希望对图片提出的问题，用中文描述。',
      }
    },
    required: ['imgUrls', 'question']
  };

  description = '当你想要了解一张或多张图片或动画表情内容时使用。';

  func = async function (opts, e) {
    let { imgUrls, question } = opts;

    const missingParams = [];
    if (!imgUrls || imgUrls.length === 0) {
      missingParams.push('图片 URL 列表');
    }
    if (!question) {
      missingParams.push('问题');
    }

    if (missingParams.length > 0) {
      return `你必须提供以下所有信息：${missingParams.join('、')}。`;
    }

    try {
      let queryParts = [
        { text: question }
      ];

      for (const imgUrl of imgUrls) {
        if (typeof imgUrl !== 'string' || imgUrl.trim() === '') {
          continue;
        }

        const imageResponse = await fetch(imgUrl);
        if (!imageResponse.ok) {
          logger.warn(`从URL获取图片失败: ${imgUrl}`);
          continue;
        }

        const contentType = imageResponse.headers.get('content-type');
        
        if (!contentType || !contentType.startsWith('image/')) {
            logger.warn(`因内容类型无效${contentType}，正在跳过此URL${imgUrl}`);
            continue;
        }

        const originalBuffer = Buffer.from(await imageResponse.arrayBuffer());
        
        let finalBuffer;
        let finalMimeType;

        if (contentType === 'image/gif') {
          finalBuffer = await sharp(originalBuffer).toFormat('png').toBuffer();
          finalMimeType = 'image/png'; 
        } else {
          finalBuffer = originalBuffer;
          finalMimeType = contentType;
        }

        const base64Image = finalBuffer.toString('base64');

        queryParts.push({
          inlineData: {
            mimeType: finalMimeType,
            data: base64Image
          }
        });
      }

      if (queryParts.length <= 1) {
        return '未能成功获取任何有效图片，请检查提供的 URL。';
      }
      const Channel = Setting.getConfig("AI").toolschannel
      const result = await getAI(
	    Channel,
        e,
        queryParts,
        '',
        false,
        false
      );
	    if(result === false){
	      return'图片响应被拦截'
	    }else{
        return `${result.text}`;
	    }
    } catch (error) {
      logger.error('ImageCaptionTool Error:', error); 
      return `处理图片时发生意外错误：${error.message}`;
    }
  };
}