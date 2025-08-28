import { downloadImage, checkAndFlipImage } from '../lib/ImageUtils/ImageUtils.js';
import fs from 'fs';
import path from 'path';
import common from '../../../lib/common/common.js';
import { plugindata } from '../lib/path.js';

const STORAGE_PATH = path.join(plugindata, 'setu');
const DEFAULT_PROXY = 'pixiv.manbomanbo.asia';

const REGEX_CONFIG = {
    local: '^#?来张本地图(?:\\s+(\\d+))?$',
    lolisuki: '^#?来张萝莉图(?:\\s+(.+))?$',
    lolicon: '^#?来张色图(。)?(?:\\s+(.+))?$',
};

async function saveImage(buffer, url) {
    try {
        if (!fs.existsSync(STORAGE_PATH)) {
            fs.mkdirSync(STORAGE_PATH, { recursive: true });
            logger.info(`存储目录已创建: ${STORAGE_PATH}`);
        }
        let filename = url.split('/').pop().replace(/_p\d+(?=\.)/, '');
        const fullPath = path.join(STORAGE_PATH, filename);
        await fs.promises.writeFile(fullPath, buffer);
        logger.info(`图片已保存到: ${fullPath}`);
    } catch (err) {
        logger.error(`[保存图片] 后台保存失败 ${url}: ${err.message}`);
    }
}

export class setuPlugin extends plugin {
    constructor() {
        super({
            name: 'setu',
            dsc: '获取图片',
            event: 'message.group',
            priority: 1135,
            rule: [
                { reg: REGEX_CONFIG.lolisuki, fnc: 'handleApiRequest' },
                { reg: REGEX_CONFIG.lolicon, fnc: 'handleApiRequest' },
                { reg: REGEX_CONFIG.local, fnc: 'handleLocalImageRequest' },
            ]
        });
    }

    async handleLocalImageRequest(e) {
        try {
            const match = e.msg.match(new RegExp(REGEX_CONFIG.local));
            const imageId = match?.[1] || '';

            const files = fs.readdirSync(STORAGE_PATH).filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
            
            if (files.length === 0) {
                return this.reply('本地图库还没有图片哦', true, { recallMsg: 10 });
            }

            let targetFile;
            if (imageId) {
                targetFile = files.find(f => f.startsWith(`${imageId}.`));
                if (!targetFile) {
                    return this.reply(`本地图库中找不到编号 ${imageId} 的图片`, true, { recallMsg: 10 });
                }
            } else {
                targetFile = files[Math.floor(Math.random() * files.length)];
            }
            
            await this.reply([segment.at(e.user_id), "小叶正在获取图片..."], true, { recallMsg: 10 });

            const imagePath = path.join(STORAGE_PATH, targetFile);
            const imageBuffer = await fs.promises.readFile(imagePath);
            const base64Data = imageBuffer.toString('base64');
            const messageText = `本地图片pid: ${targetFile.replace(/\..+$/, '')}`;

            await this.sendImageWithRetry(e, imageBuffer, base64Data, messageText, true);

        } catch (error) {
            logger.error(`处理本地图片请求时出错: ${error.message}`);
            await this.reply('获取本地图片失败，请重试', true, { recallMsg: 10 });
        }
    }

    async handleApiRequest(e) {
        let apiType, tag, isR18 = false;

        if (new RegExp(REGEX_CONFIG.lolicon).test(e.msg)) {
            const match = e.msg.match(new RegExp(REGEX_CONFIG.lolicon));
            apiType = 'lolicon';
            isR18 = !!match?.[1];
            tag = match?.[2]?.trim() || '';
        } else {
            const match = e.msg.match(new RegExp(REGEX_CONFIG.lolisuki));
            apiType = 'lolisuki';
            tag = match?.[1]?.trim() || '';
        }
        
        await this.reply([segment.at(e.user_id), "小叶正在获取图片..."], true, { recallMsg: 10 });

        try {
            const apiFunction = apiType === 'lolicon' ? this.fetchLolicon.bind(this) : this.fetchLolisuki.bind(this);
            const imageInfo = await apiFunction(tag, isR18);

            if (!imageInfo?.url) {
                return this.reply(tag ? `标签「${tag}」找不到对应的图片。` : "未能找到图片。", true, { recallMsg: 10 });
            }

            const imageBuffer = await downloadImage(imageInfo.url);
            if (!imageBuffer) {
                throw new Error(`从 ${imageInfo.url} 下载图片失败`);
            }
            
            const base64 = imageBuffer.toString('base64');
            const messageText = `${imageInfo.id ? 'pid:' + imageInfo.id : ''}${imageInfo.tags?.length ? '\n标签: ' + imageInfo.tags.join(', ') : ''}`;
            
            const sentSuccessfully = await this.sendImageWithRetry(e, imageBuffer, base64, messageText, apiType === 'lolicon' ? isR18 : true);

            if (sentSuccessfully) {
                saveImage(imageBuffer, imageInfo.url);
            }

        } catch (err) {
            logger.error(`处理API请求时出错 (${apiType}): ${err.message}`);
            await this.reply(`获取图片时出错: ${err.message}`, true, { recallMsg: 10 });
        }
    }

    async sendImageWithRetry(e, imageBuffer, base64, messageText, shouldRecall) {
        const sendOptions = shouldRecall ? { recallMsg: 10 } : {};

        let sendResult = await this.reply(segment.image(`base64://${base64}`), false, sendOptions).catch(err => {
            logger.error(`初次发送图片失败: ${err.message}`);
            return null;
        });

        const { success, processedBuffer } = await checkAndFlipImage(imageBuffer, sendResult);

        let finalSuccess = success;
        if (!success) {
            await this.reply('图片发送失败，正在尝试翻转后重发...', false, { recallMsg: 10 });
            sendResult = await this.reply(segment.image(processedBuffer), false, sendOptions).catch(err => {
                logger.error(`第二次尝试发送图片失败: ${err.message}`);
                return null;
            });
            finalSuccess = !!sendResult?.message_id;
        }

        if (finalSuccess) {
            if (messageText) {
                await this.reply(messageText, false, { recallMsg: 60 });
            }
            await common.sleep(500);
            await this.reply('图片已发送，若图片未显示则可能被拦截', true, { at: true, recallMsg: 10 });
        } else {
            await this.reply('图片最终发送失败，请稍后重试。', true, { recallMsg: 10 });
        }
        
        return finalSuccess;
    }
    
    async fetchApi(url, apiName) {
        const response = await fetch(url).catch(err => {
            throw new Error(`${apiName} 网络错误: ${err.message}`);
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => `HTTP status ${response.status}`);
            throw new Error(`${apiName} API 错误: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (data.error || !data.data?.length) {
            throw new Error(`${apiName} API 返回错误或无数据: ${data.error || '空数据数组'}`);
        }
        return data.data[0];
    }

    async fetchLolisuki(tag = '') {
        const params = new URLSearchParams({
            num: '1',
            size: 'original',
            taste: '1',
            proxy: DEFAULT_PROXY,
            ...(tag && { tag }),
        });
        const apiUrl = `https://lolisuki.cn/api/setu/v1?${params}`;
        const imageInfo = await this.fetchApi(apiUrl, 'Lolisuki');
        
        return {
            url: imageInfo.urls?.original,
            id: imageInfo.pid,
            tags: imageInfo.tags?.slice(0, 5) || [],
        };
    }

    async fetchLolicon(tag = '', isR18 = false) {
        const params = new URLSearchParams({
            size: "original",
            r18: isR18 ? '1' : '0',
            proxy: DEFAULT_PROXY,
            ...(tag && { tag }),
        });
        const apiUrl = `https://api.lolicon.app/setu/v2?${params}`;
        const imageInfo = await this.fetchApi(apiUrl, 'Lolicon');

        return {
            url: imageInfo.urls?.original,
            id: imageInfo.pid,
            tags: imageInfo.tags?.slice(0, 5) || [],
        };
    }
}
