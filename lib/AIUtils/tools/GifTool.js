import { AbstractTool } from "./AbstractTool.js";
import { getgif, buildStickerMsg } from '../../ImageUtils/ImageUtils.js';
import Setting from "../../setting.js";
import adapter from "../../adapter.js";

export class GifTool extends AbstractTool {
    name = 'GifTool';

    parameters = {
        properties: {
            keyword: {
                type: 'string',
                description: '表情包的关键词',
            }
        },
        required: ['keyword']
    };

    description = '当你需要发送表情包[动画表情]时使用';

    func = async function (opts, e) {
        const { keyword } = opts;
        const config = Setting.getConfig("tenor");
        if (!config.apiKey) {
            return "未配置Tenor API Key，无法获取表情包。";
        }

        try {
            const apiUrl = `https://tenor.googleapis.com/v2/search?key=${config.apiKey}&q=${encodeURIComponent(keyword)}&searchfilter=sticker&media_filter=gif&limit=50`;
            const imageUrl = await getgif(apiUrl);

            if (imageUrl) {
                if (adapter === 0) {
                    await e.reply(segment.image(imageUrl));
                } else {
                    await e.reply(buildStickerMsg(imageUrl));
                }
                return `已发送关于 "${keyword}" 的表情包，禁止回复[动画表情]`;
            } else {
                return "找不到相关的表情包";
            }
        } catch (error) {
            logger.error("GifTool error:", error);
            return `获取表情包失败: ${error.message}`;
        }
    }
}
