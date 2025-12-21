import { getgif} from "../lib/ImageUtils/ImageUtils.js";
import Setting from "../lib/setting.js";
export class gifPlugin extends plugin {
  constructor() {
    super({
      name: "gifPlugin",
      event: "message",
      priority: 1135,
    });
  }

  gif = Command(/^来张(.*)表情包$/, async (e) => {
    const config = Setting.getConfig("tenor");
    if (!config.apiKey) {
      return false;
    }
    const keyword = e.msg.match(/^来张(.*)表情包$/)[1];
    const apiUrl = `https://tenor.googleapis.com/v2/search?key=${
      config.apiKey
    }&q=${encodeURIComponent(keyword)}&searchfilter=sticker&media_filter=gif`;
    const imageUrl = await getgif(apiUrl);
    if (imageUrl) {
      await e.reply(segment.image(imageUrl, 1));
    } else {
      await e.reply("找不到相关的表情包呢~", true);
    }
  });
}
