import { generateImagesWithProvider } from "../lib/AIUtils/imageProvider.js";
import { formatMediaUserError } from "../lib/AIUtils/mediaErrorMessages.js";
import {
  parseImageCommandArgs,
  VALID_IMAGE_ASPECT_RATIOS,
} from "../lib/AIUtils/imageCommandParser.js";
import { getImg } from "../lib/utils.js";
import Setting from "../lib/setting.js";

const IMAGE_COMMAND_PATTERN = /^#i(?![a-z])/i;

async function replyParameterWarnings(e, warnings) {
  await e.reply(
    `参数提示：${warnings.join("；")}。已按兼容参数继续生成。`,10
  );
}

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

  findDynamicTask(msg) {
    const tasks =
      this.task?.tasks || (Array.isArray(this.task) ? this.task : []);
    if (!tasks || !Array.isArray(tasks)) {
      return null;
    }

    for (const task of tasks) {
      if (!task.trigger) {
        continue;
      }

      try {
        const reg = new RegExp(task.trigger);
        const match = reg.exec(msg);
        if (match && match.index === 0) {
          return { task, match };
        }
      } catch (error) {
        logger.error(`[EditImage] invalid trigger regex: ${task.trigger}`, error);
      }
    }

    return null;
  }

  async preflightImageEdit(e) {
    if (!e.msg) {
      return false;
    }

    if (IMAGE_COMMAND_PATTERN.test(e.msg)) {
      const msg = e.msg.replace(IMAGE_COMMAND_PATTERN, "").trim();
      const { promptText } = this.parseArgs(msg);
      return {
        accepted: true,
        command: "AI图片编辑",
        charge: Boolean(promptText),
        refundOnFalse: true,
      };
    }

    const dynamicMatch = this.findDynamicTask(e.msg);
    if (!dynamicMatch) {
      return false;
    }

    const inputImages = await getImg(e, true, true);
    if (!inputImages || inputImages.length === 0) {
      return false;
    }

    e._editImagePreflight = {
      ...dynamicMatch,
      inputImages,
    };

    return {
      accepted: true,
      command: "AI图片编辑",
      refundOnFalse: true,
    };
  }

  dispatchHandler = OnEvent("message", {
    economy: {
      command: "AI图片编辑",
      preflight: "preflightImageEdit",
      refundOnFalse: true,
    },
  }, async (e) => {
    if (!e.msg) {
      return false;
    }

    if (IMAGE_COMMAND_PATTERN.test(e.msg)) {
      return this.editImageHandler(e);
    }

    const cachedMatch = e._editImagePreflight;
    if (cachedMatch?.task && cachedMatch?.match) {
      return this.dynamicImageHandler(e, cachedMatch.task, cachedMatch.match, cachedMatch.inputImages);
    }

    const dynamicMatch = this.findDynamicTask(e.msg);
    if (dynamicMatch) {
      return this.dynamicImageHandler(e, dynamicMatch.task, dynamicMatch.match);
    }

    return false;
  });

  parseArgs(msg) {
    return parseImageCommandArgs(msg);
  }

  async dynamicImageHandler(e, matchedTask, match, cachedInputImages = null) {
    const inputImages = cachedInputImages || await getImg(e, true, true);

    if (!inputImages || inputImages.length === 0) {
      return false;
    }

    const matchedStr = match[0];
    const remainingMsg = e.msg.slice(matchedStr.length).trim();
    let {
      aspectRatio: userRatio,
      imageSize: userSize,
      count: userCount,
      channel: userChannel,
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
    if (aspectRatio && !VALID_IMAGE_ASPECT_RATIOS.includes(aspectRatio)) {
      aspectRatio = null;
    }

    const imageSize = userSize || matchedTask.imageSize || null;
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
      count: userCount,
      channel: userChannel,
    });
  }

  async editImageHandler(e) {
    const msg = e.msg.replace(IMAGE_COMMAND_PATTERN, "").trim();
    const inputImages = await getImg(e, true, true);
    const {
      aspectRatio,
      imageSize: parsedSize,
      count,
      channel,
      promptText,
    } = this.parseArgs(msg);
    const imageSize = parsedSize || null;

    if (!promptText) {
      return false;
    }

    return this._processAndCallAPI(e, promptText, inputImages, {
      aspectRatio,
      imageSize,
      count,
      channel,
    });
  }

  async _processAndCallAPI(e, promptText, inputImages, options = {}) {
    await e.react(124);

    try {
      const imageConfig = this.task;
      const imageBuffers = await generateImagesWithProvider(
        imageConfig,
        promptText,
        inputImages || [],
        {
          aspectRatio: options.aspectRatio,
          imageSize: options.imageSize,
          count: options.count,
          channel: options.channel,
        },
        {
          onParameterWarnings: (warnings) =>
            replyParameterWarnings(e, warnings),
        }
      );

      if (imageBuffers.length > 0) {
        await e.reply(imageBuffers.map((buffer) => segment.image(buffer)));
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
        `创作失败：${formatMediaUserError(error, { kind: "image" })}`,
        10,
        true
      );
    }

    return true;
  }
}
