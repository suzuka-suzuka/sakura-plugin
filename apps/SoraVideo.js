import EconomyManager from "../lib/economy/EconomyManager.js";
import {
  textToVideo,
  imageToVideo,
  isBusy,
} from "../lib/AIUtils/SoraClient.js";
import { getImg } from "../lib/utils.js";

export class SoraVideo extends plugin {
  constructor() {
    super({
      name: "Sora视频生成",
      event: "message",
      priority: 1135,
    });
  }

  generateVideo = Command(/^([lps])?\s*#v(\+)?(.+)/, async (e) => {
    try {
      if (isBusy()) {
        await e.reply("当前有视频生成任务正在进行中，请稍后再试...", 10);
        return true;
      }

      const match = e.msg.match(/^([lps])?\s*#v(\+)?(.+)/s);
      if (!match) {
        return false;
      }

      const orientationPrefix = match[1];
      const isLongVideo = match[2] === "+";
      const prompt = match[3].trim();
      const nFrames = isLongVideo ? 450 : 300;

      let orientation = "portrait";
      if (orientationPrefix === "l") {
        orientation = "landscape";
      } else if (orientationPrefix === "s") {
        orientation = "square";
      }

      if (!prompt) {
        return false;
      }
      const economyManager = new EconomyManager(e);
      if (!e.isMaster && !economyManager.pay(e, 20)) {
        return false;
      }
      const imgs = await getImg(e, true);
      const hasImage = imgs && imgs.length > 0;

      await e.react(124);

      const videoOptions = { orientation, nFrames };
      let result;

      if (hasImage) {
        result = await imageToVideo(prompt, imgs[0], videoOptions);
      } else {
        result = await textToVideo(prompt, videoOptions);
      }

      await e.reply(segment.video(result.url));
      return true;
    } catch (error) {
      logger.error(`[SoraVideo] 生成视频失败: ${error.message}`);
      await e.reply(`视频生成失败: ${error.message}`, 10, true);
      return true;
    }
  });
}
