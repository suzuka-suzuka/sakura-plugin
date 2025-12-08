import { AbstractTool } from "./AbstractTool.js";
import { FlipImage } from '../../ImageUtils/ImageUtils.js';
import { Recall } from "../../utils.js";
import setting from "../../setting.js";

export class IllustrationTool extends AbstractTool {
    name = 'Illustration';

    parameters = {
        properties: {
            tag: {
                type: 'array',
                items: {
                    type: 'string'
                },
                description: '图片的日文标签列表。请将标签翻译为日文，但 ‘可爱’ 是特殊标签，无需翻译直接使用',
            },
            isR18: {
                type: 'boolean',
                description: '是否获取R18内容的图片，默认为 false',
            }
        },
        required: []
    };

    description = '当你需要获取一张动漫图片或插画时使用';

    get r18Config() {
        return setting.getConfig("r18");
    }

    get pixivConfig() {
        return setting.getConfig("pixiv");
    }

    func = async function (opts, e) {
        const { tag: originalTags = [], isR18 = false } = opts;

        if (isR18 && !this.r18Config.enable.includes(e.group_id)) {
            return "本群未开启r18功能哦~";
        }

        const processedTags = originalTags.map(t => t === '可爱' ? 'ロリ' : t);

        try {
            const params = new URLSearchParams({
                size: "original",
                r18: isR18 ? '1' : '0',
                proxy: this.pixivConfig.proxy,
				excludeAI: 'true'
            });
            if (processedTags.length > 0) {
                processedTags.forEach(individualTag => {
                    params.append('tag', individualTag);
                });
            }

            const apiUrl = `https://api.lolicon.app/setu/v2?${params}`;

            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorText = await response.text().catch(() => `HTTP status ${response.status}`);
                throw new Error(`Lolicon API 请求失败: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            if (!data?.data?.length) {
                const message = processedTags.length > 0 
                    ? `找不到包含标签「${processedTags.join(', ')}」的图片。` 
                    : "图库中暂时没有找到合适的图片。";
                return message;
            }

            const imageInfo = data.data[0];
            const imageUrl = imageInfo.urls.original;

            if (!imageUrl) {
                return "API返回的数据中没有有效的图片URL。";
            }

            let sendResult = await e.reply(segment.image(imageUrl));

            if (!sendResult?.message_id) {
                await e.reply('图片发送失败，正在尝试翻转后重发...');
                const flippedBuffer = await FlipImage(imageUrl);
                if (!flippedBuffer) {
                    throw new Error("图片下载失败，链接可能已失效或无法访问");
                }
                sendResult = await e.reply(segment.image(flippedBuffer));
            }

            if (!sendResult?.message_id) {
                throw new Error("图片因被拦截而发送失败");
            }
			
			if (isR18) {
                Recall(e, sendResult.message_id);
            }
            
            const tagsToFilter = ['萝莉', 'loli','ロリ'];
            const filteredTags = imageInfo.tags.filter(tag => !tagsToFilter.includes(tag));
            const infoText = `PID: ${imageInfo.pid}\nTags: ${filteredTags.join(', ')}`;
            
            return `图片已成功发送，禁止回复[图片]。图片信息：\n${infoText}`;

        } catch (error) {
            logger.error("IllustrationTool 运行时出错:", error);
            const errorMessage = `获取图片时遇到问题: ${error.message}`;
            return errorMessage;
        }
    };
}
