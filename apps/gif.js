import { getgif,buildStickerMsg } from '../lib/ImageUtils/ImageUtils.js';
import Setting from "../lib/setting.js"
import adapter from "../lib/adapter.js"
export class gifPlugin extends plugin {
	constructor() {
		super({
			name: 'gifPlugin',
			dsc: '发送带gif表情包',
			event: 'message.group',
			priority: 1135,
			rule: [
				{
					reg: '^来张(.*)表情包$',
					fnc: 'gif',
					log: false
				}
			]
		});
	}

	async gif(e) {
			const config = Setting.getConfig("tenor");
			if (!config.apiKey) {
				return false
			}
			const keyword = e.msg.match(/^来张(.*)表情包$/)[1]
			const apiUrl = `https://tenor.googleapis.com/v2/search?key=${config.apiKey}&q=${encodeURIComponent(keyword)}&media_filter=gif&random=true&limit=1`;
			const imageUrl = await getgif(apiUrl);
			if (imageUrl) {
				if (adapter === 0) {
					await e.reply(segment.image(imageUrl));
				} else {
					await e.reply(buildStickerMsg(imageUrl));
				}
			} else {
				await e.reply("找不到相关的表情包呢~", true);
			}
	}
}
