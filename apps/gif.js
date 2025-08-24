import { getgif,buildStickerMsg } from '../lib/ImageUtils/ImageUtils.js';

export class gifPlugin extends plugin {
	constructor() {
		super({
			name: 'gifPlugin',
			dsc: '发送带sub_type的gif表情包',
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
			const keyword = e.msg.match(/^来张(.*)表情包$/)[1]
			const apiKey = "AIzaSyB48anIc9rAPLKYkv-asoF_GtNsZ5_ricg";
			const apiUrl = `https://tenor.googleapis.com/v2/search?key=${apiKey}&q=${encodeURIComponent(keyword)}&media_filter=gif&random=true&limit=1`;
			const imageBuffer = await getgif(apiUrl);
		    await e.reply(buildStickerMsg(imageBuffer));
	}
}
