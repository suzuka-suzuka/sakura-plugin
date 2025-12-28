import { grokRequest } from "../lib/AIUtils/GrokClient.js";
import { getImg } from "../lib/utils.js";
import Setting from "../lib/setting.js";
import EconomyManager from "../lib/economy/EconomyManager.js";
export class GrokVideo extends plugin {
  constructor() {
    super({
      name: "Grok视频生成",
      event: "message",
      priority: 1000,
    });
  }

  generateVideo = Command(/^#?gv(.*)/, async (e) => {
    const match = e.msg.match(/^#?gv(.*)/);
    if (!match) return false;

    const prompt = match[1].trim();
    const imgBase64List = await getImg(e, true, true);

    if (!prompt && (!imgBase64List || imgBase64List.length === 0)) {
      return false;
    }
    const economyManager = new EconomyManager(e);
    if (!e.isMaster && !economyManager.pay(e, 20)) {
      return false;
    }
    const channelsConfig = Setting.getConfig("Channels");
    const grokList = channelsConfig?.grok || [];
    const grokChannel = grokList[Math.floor(Math.random() * grokList.length)];

    if (!grokChannel || !grokChannel.sso) {
      return false;
    }
    await e.react(124);

    try {
      const content = [];
      if (imgBase64List && imgBase64List.length > 0) {
        const img = imgBase64List[0];
        content.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        });
      }
      if (prompt) {
        content.push({ type: "text", text: prompt });
      }

      const messages = [
        {
          role: "user",
          content: content,
        },
      ];

      const grokConfig = {
        sso: grokChannel.sso,
        supersso: grokChannel.supersso,
        cf_clearance: grokChannel.cf_clearance,
        x_statsig_id: grokChannel.x_statsig_id,
        temporary: grokChannel.temporary !== false,
        dynamic_statsig: grokChannel.dynamic_statsig !== false,
      };

      const model = "grok-imagine-0.9";

      const request = {
        model: model,
        messages: messages,
      };

      const result = await grokRequest(request, grokConfig, e);

      if (!result || typeof result === "string") {
        await e.reply(`视频生成失败: ${result || "未知错误"}`, true, {
          recallMsg: 10,
        });
        return true;
      }

      if (result.videos && result.videos.length > 0) {
        const video = result.videos[0];
        if (video.localPath) {
          await e.reply(segment.video(video.localPath));
        } else {
          await e.reply("视频下载失败", true, { recallMsg: 10 });
        }
      } else {
        await e.reply("未返回视频", true, { recallMsg: 10 });
      }
    } catch (error) {
      logger.error("[GrokVideo] 生成视频时出错:", error);
      await e.reply(`视频生成出错: ${error.message}`, true, {
        recallMsg: 10,
      });
    }

    return true;
  });
}
