import {
  continueImageConversationWithProvider,
  generateImagesWithProvider,
} from "../lib/AIUtils/imageProvider.js";
import { getImg } from "../lib/utils.js";
import Setting from "../lib/setting.js";
import { getRedis } from "../../../src/utils/redis.js";

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
const MULTI_TURN_SESSION_TTL_SECONDS = 120;
const MULTI_TURN_LOCK_TTL_MS = 5 * 60 * 1000;

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

  getMultiTurnScope(e) {
    const selfId = e?.self_id || "default";
    const chatScope = e?.group_id ? `group:${e.group_id}` : "private";
    return `${selfId}:${chatScope}:${e?.user_id || "unknown"}`;
  }

  getMultiTurnSessionKey(e) {
    return `sakura:image-edit:session:${this.getMultiTurnScope(e)}`;
  }

  getMultiTurnLockKey(e) {
    return `sakura:image-edit:lock:${this.getMultiTurnScope(e)}`;
  }

  async loadMultiTurnSession(e) {
    const raw = await getRedis().get(this.getMultiTurnSessionKey(e));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      logger.warn(`[EditImage] invalid multi-turn session: ${error.message}`);
      await getRedis().del(this.getMultiTurnSessionKey(e));
      return null;
    }
  }

  async saveMultiTurnSession(e, session) {
    await getRedis().set(
      this.getMultiTurnSessionKey(e),
      JSON.stringify(session),
      "EX",
      MULTI_TURN_SESSION_TTL_SECONDS
    );
  }

  async acquireMultiTurnLock(e) {
    const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const result = await getRedis().set(
      this.getMultiTurnLockKey(e),
      token,
      "PX",
      MULTI_TURN_LOCK_TTL_MS,
      "NX"
    );

    return result === "OK" ? token : null;
  }

  async releaseMultiTurnLock(e, token) {
    if (!token) {
      return;
    }

    const redis = getRedis();
    const key = this.getMultiTurnLockKey(e);
    const currentToken = await redis.get(key);
    if (currentToken === token) {
      await redis.del(key);
    }
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

    if (/^#ii/.test(e.msg)) {
      const msg = e.msg.replace(/^#ii/, "").trim();
      const { promptText } = this.parseArgs(msg);
      return {
        accepted: true,
        command: "AI图片编辑",
        charge: Boolean(promptText),
        refundOnFalse: true,
      };
    }

    if (/^#i/.test(e.msg)) {
      const msg = e.msg.replace(/^#i/, "").trim();
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

    if (/^#ii/.test(e.msg)) {
      return this.multiTurnEditImageHandler(e);
    }

    if (/^#i/.test(e.msg)) {
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
    });
  }

  async multiTurnEditImageHandler(e) {
    const msg = e.msg.replace(/^#ii/, "").trim();
    const inputImages = await getImg(e, true, true);
    const { aspectRatio, imageSize: parsedSize, promptText } = this.parseArgs(msg);
    const imageSize = parsedSize || null;

    if (!promptText) {
      return false;
    }

    return this._processMultiTurnAPI(e, promptText, inputImages, {
      aspectRatio,
      imageSize,
    });
  }

  async editImageHandler(e) {
    const msg = e.msg.replace(/^#i/, "").trim();
    const inputImages = await getImg(e, true, true);
    const { aspectRatio, imageSize: parsedSize, promptText } = this.parseArgs(msg);
    const imageSize = parsedSize || null;

    if (!promptText) {
      return false;
    }

    return this._processAndCallAPI(e, promptText, inputImages, {
      aspectRatio,
      imageSize,
    });
  }

  async _processMultiTurnAPI(e, promptText, inputImages, options = {}) {
    const lockToken = await this.acquireMultiTurnLock(e);
    if (!lockToken) {
      await e.reply("上一条多轮图片编辑还在处理中，请稍后再试。", 10, true);
      return false;
    }

    await e.react(124);

    try {
      const imageConfig = this.task;
      const previousSession = await this.loadMultiTurnSession(e);
      const result = await continueImageConversationWithProvider(
        imageConfig,
        promptText,
        inputImages || [],
        {
          aspectRatio: options.aspectRatio,
          imageSize: options.imageSize,
        },
        previousSession
      );

      const imageBuffers = result?.imageBuffers || [];
      if (imageBuffers.length > 0) {
        await e.reply(segment.image(imageBuffers[0]));
        await this.saveMultiTurnSession(e, result.session);
      } else {
        await e.reply(
          "未能生成图片，可能被安全策略拦截。",
          10,
          true
        );
      }
    } catch (error) {
      logger.error("[EditImage] multi-turn image generation failed:", error);
      await e.reply(
        "多轮图片编辑失败，可能是网络问题或请求超限。",
        10,
        true
      );
    } finally {
      await this.releaseMultiTurnLock(e, lockToken);
    }

    return true;
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
