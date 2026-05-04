import { generateImagesWithProvider } from "../lib/AIUtils/imageProvider.js";
import { getImg } from "../lib/utils.js";
import Setting from "../lib/setting.js";

const VALID_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
];

export class EditImage extends plugin {
  constructor() {
    super({
      name: "AI图像编辑",
      event: "message",
      priority: 1135,
    });
  }

  get task() {
    return Setting.getConfig("EditImage");
  }

  dispatchHandler = OnEvent("message", async (e) => {
    if (!e.msg) {
      return false;
    }

    if (/^#i/.test(e.msg)) {
      return this.editImageHandler(e);
    }

    const tasks =
      this.task?.tasks || (Array.isArray(this.task) ? this.task : []);
    if (tasks && Array.isArray(tasks)) {
      for (const task of tasks) {
        if (!task.trigger) {
          continue;
        }

        try {
          const reg = new RegExp(task.trigger);
          const match = reg.exec(e.msg);
          if (match && match.index === 0) {
            return this.dynamicImageHandler(e, task, match);
          }
        } catch (error) {
          logger.error(`[EditImage] invalid trigger regex: ${task.trigger}`, error);
        }
      }
    }

    return false;
  });

  parseArgs(msg) {
    let aspectRatio = null;
    let imageSize = null;
    let promptText = msg;

    promptText = promptText.replace(/：/g, ":");

    const ratioRegex = new RegExp(`(${VALID_ASPECT_RATIOS.join("|")})`);
    const ratioMatch = promptText.match(ratioRegex);
    if (ratioMatch) {
      aspectRatio = ratioMatch[1];
      promptText = promptText.replace(ratioMatch[0], "").trim();
    }

    const sizeRegex = /([124])k/i;
    const sizeMatch = promptText.match(sizeRegex);
    if (sizeMatch) {
      imageSize = sizeMatch[0].toUpperCase();
      promptText = promptText.replace(sizeMatch[0], "").trim();
    }

    return { aspectRatio, imageSize, promptText };
  }

  async dynamicImageHandler(e, matchedTask, match) {
    const inputImages = await getImg(e, true, true);

    if (!inputImages || inputImages.length === 0) {
      return false;
    }

    const matchedStr = match[0];
    const remainingMsg = e.msg.slice(matchedStr.length).trim();
    let {
      aspectRatio: userRatio,
      imageSize: userSize,
      promptText: userPrompt,
    } = this.parseArgs(remainingMsg);

    if ((!userRatio || !userSize) && match.length > 1) {
      for (let i = 1; i < match.length; i += 1) {
        if (!match[i]) {
          continue;
        }

        const { aspectRatio: groupRatio, imageSize: groupSize } =
          this.parseArgs(match[i]);

        if (groupRatio && !userRatio) {
          userRatio = groupRatio;
        }

        if (groupSize && !userSize) {
          userSize = groupSize;
        }
      }
    }

    let aspectRatio = userRatio || matchedTask.aspectRatio;
    if (aspectRatio && !VALID_ASPECT_RATIOS.includes(aspectRatio)) {
      aspectRatio = null;
    }

    const imageSize = userSize || "1K";
    let finalPrompt = matchedTask.prompt || "";

    if (finalPrompt && match) {
      finalPrompt = finalPrompt.replace(/\$(\d+)/g, (_, index) => {
        return match[index] || "";
      });
    }

    if (userPrompt) {
      finalPrompt = finalPrompt ? `${finalPrompt} ${userPrompt}` : userPrompt;
    }

    return this._processAndCallAPI(e, finalPrompt, inputImages, {
      aspectRatio,
      imageSize,
    });
  }

  async editImageHandler(e) {
    const msg = e.msg.replace(/^#i/, "").trim();
    const inputImages = await getImg(e, true, true);
    const { aspectRatio, imageSize: parsedSize, promptText } = this.parseArgs(msg);
    const imageSize = parsedSize || "1K";

    if (!promptText) {
      await e.reply(
        "请告诉我你想如何修改图片。",
        10,
        true
      );
      return true;
    }

    return this._processAndCallAPI(e, promptText, inputImages, {
      aspectRatio,
      imageSize,
    });
  }

  async _processAndCallAPI(e, promptText, inputImages, options = {}) {
    const canProceed = Setting.payForCommand(e, "AI图片编辑");
    if (!canProceed) {
      return false;
    }

    await e.react(124);

    try {
      const imageConfig = this.task;
      const imageBuffers = await generateImagesWithProvider(
        imageConfig,
        promptText,
        inputImages || [],
        {
          aspectRatio: options.aspectRatio,
          imageSize: options.imageSize || "1K",
        }
      );

      if (imageBuffers.length > 0) {
        await e.reply(segment.image(imageBuffers[0]));
      } else {
        await e.reply(
          "未能生成图片，可能被安全策略拦截。",
          10,
          true
        );
      }
    } catch (error) {
      logger.error("[EditImage] image generation failed:", error);
      await e.reply(
        "创作失败，可能是网络问题或请求超限。",
        10,
        true
      );
    }

    return true;
  }
}
