import plugin from '../../../lib/plugins/plugin.js';
import lodash from 'lodash';
import moment from 'moment';
import { yandeimage, downloadImage } from '../lib/ImageUtils/ImageUtils.js';
import Setting from '../lib/setting.js';

const _lastMsgTime = {};
const _pluginGlobalStartTime = moment().unix();

export class cool extends plugin {
    constructor() {
        super({
            name: 'cool',
            event: 'message.group',
            priority: 35,
            rule: [
                {
                    reg: '',
                    fnc: 'updateLastTime',
                    log: false
                }
            ],
        });
    }

    get appconfig() {
        return Setting.getConfig("cool");
    }

    task = {
        name: 'coolTask',
        fnc: () => this.coolTask(),
        cron: '0 */20 * * * *',
        log: false
    };

    async updateLastTime(e) {
        const groupId = e.group_id;
        const config = this.appconfig;

        if ((config?.Groups ?? []).includes(groupId)) {
            _lastMsgTime[groupId] = moment().unix();
        } else {
            return false;
        }
        return false;
    }

    async coolTask() {
        const currentTime = moment().unix();
        const config = this.appconfig;

        if (!config) {
            return;
        }

        const Groups = config.Groups ?? [];

        if (Groups.length === 0) {
            return;
        }

        for (const groupId of Groups) {
            const lastTime = _lastMsgTime[groupId] || _pluginGlobalStartTime;

            const minInterval = (config.randomIntervalMin || 30) * 60;
            const maxInterval = (config.randomIntervalMax || 60) * 60;
            const effectiveMinInterval = Math.min(minInterval, maxInterval);
            const effectiveMaxInterval = Math.max(minInterval, maxInterval);
            const randomInterval = lodash.random(effectiveMinInterval, effectiveMaxInterval);

            const coldThreshold = lastTime + randomInterval;

            if (currentTime >= coldThreshold) {
                logger.info(`检测到群 ${groupId} 已变冷，准备获取并发送图片...`);

                const apiUrl = 'https://yande.re/post.json?tags=loli+-rating:e+-nipples&limit=500';
                const imageBuffer = await yandeimage(apiUrl);

                if (imageBuffer) {
                    try {
                        let sendResult = await Bot.pickGroup(groupId).sendMsg(segment.image(imageBuffer));
                        _lastMsgTime[groupId] = moment().unix();
                    } catch (error) {
                        logger.error(`发送图片到群 ${groupId} 失败: ${error}`);
                        try {
                            const response = await fetch('https://international.v1.hitokoto.cn/');
                            const data = await response.json();
                            const hitokotoText = data.hitokoto;
                            await Bot.pickGroup(groupId).sendMsg(hitokotoText);
                        } catch (fallbackError) {
                            logger.error(`获取一言也失败了: ${fallbackError}`);
                            await Bot.pickGroup(groupId).sendMsg('喵');
                        } finally {
                            _lastMsgTime[groupId] = moment().unix();
                        }
                    }
                } else {
                    logger.warn(`未能获取群 ${groupId} 的图片数据，详细请查看 imageUtils 日志。`);
                    _lastMsgTime[groupId] = moment().unix();
                }
            }
        }
    }
}
