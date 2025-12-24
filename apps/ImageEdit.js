import { GoogleGenAI } from "@google/genai";
import { getImg } from "../lib/utils.js";
import Setting from "../lib/setting.js";
import sharp from "sharp";

export class EditImage extends plugin {
  constructor() {
    super({
      name: "AI图像编辑",
      event: "message",
      priority: 1135,
    });
    this.task = Setting.getConfig("EditImage");
  }

  dispatchHandler = OnEvent("message", async (e) => {
    if (!e.msg) return false;

    if (!this.checkPermission(e)) {
      return false;
    }

    if (/^#i/.test(e.msg)) {
      return this.editImageHandler(e);
    }

    const tasks =
      this.task?.tasks || (Array.isArray(this.task) ? this.task : []);
    if (tasks && Array.isArray(tasks)) {
      for (const task of tasks) {
        if (task.trigger) {
          try {
            const reg = new RegExp(task.trigger);
            const match = reg.exec(e.msg);
            if (match && match.index === 0) {
              return this.dynamicImageHandler(e, task, match);
            }
          } catch (error) {
            logger.error(`正则匹配出错: ${task.trigger}`, error);
          }
        }
      }
    }

    return false;
  });

  checkPermission(e) {
    if (!this.task?.requirePermission) {
      return true;
    }

    return e.isWhite;
  }

  parseArgs(msg) {
    let aspectRatio = null;
    let imageSize = null;
    let promptText = msg;

    promptText = promptText.replace(/：/g, ":");

    const validRatios = [
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
    const ratioRegex = new RegExp(`(${validRatios.join("|")})`);

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
    let imageUrls = await getImg(e, true);

    if (!imageUrls || imageUrls.length === 0) {
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
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
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
    }

    let aspectRatio = userRatio || matchedTask.aspectRatio;
    const validRatios = [
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

    if (aspectRatio && !validRatios.includes(aspectRatio)) {
      aspectRatio = null;
    }

    const imageSize = userSize || "1K";

    let finalPrompt = matchedTask.prompt || "";

    if (finalPrompt && match) {
      finalPrompt = finalPrompt.replace(
        /\$(\d+)/g,
        (_, index) => match[index] || ""
      );
    }

    if (userPrompt) {
      finalPrompt = finalPrompt ? `${finalPrompt} ${userPrompt}` : userPrompt;
    }

    return this._processAndCallAPI(e, finalPrompt, imageUrls, {
      aspectRatio,
      imageSize,
    });
  }

  async editImageHandler(e) {
    let msg = e.msg.replace(/^#i/, "").trim();
    let imageUrls = await getImg(e, true);

    const {
      aspectRatio,
      imageSize: parsedSize,
      promptText,
    } = this.parseArgs(msg);

    const imageSize = parsedSize || "1K";

    if (!promptText) {
      await e.reply("请告诉我你想如何修改图片哦~ ", 10, true);
      return true;
    }

    return this._processAndCallAPI(e, promptText, imageUrls, {
      aspectRatio,
      imageSize,
    });
  }

  async _processAndCallAPI(e, promptText, imageUrls, options = {}) {
    await e.react(124);
    const { aspectRatio, imageSize = "1K" } = options;
    const contents = [];
    const hasImage = imageUrls && imageUrls.length > 0;

    if (promptText) {
      contents.push({ text: promptText });
    }

    if (hasImage) {
      for (const imageUrl of imageUrls) {
        try {
          const { base64Data, finalMimeType } = await this._processImage(
            imageUrl
          );
          contents.push({
            inlineData: {
              mimeType: finalMimeType,
              data: base64Data,
            },
          });
        } catch (error) {
          logger.error("处理其中一张图片时出错:", error);
          await e.reply("处理图片时失败，请重试", 10, true);
          return true;
        }
      }
    }

    try {
      const imageConfig = this.task;

      if (!imageConfig || !imageConfig.api || !imageConfig.model) {
        throw new Error(
          "配置错误：未在 'EditImage' 配置中找到有效的 'gemini' 配置或缺少api/model。"
        );
      }

      let API_KEY = imageConfig.api;
      const GEMINI_MODEL = imageConfig.model;

      if (!API_KEY || typeof API_KEY !== "string" || !API_KEY.trim()) {
        throw new Error("渠道配置中的 API Key 无效。");
      }
      API_KEY = API_KEY.trim();

      const callAI = async (apiKey, isVertex) => {
        const geminiOptions = { apiKey: apiKey };

        if (isVertex) {
          geminiOptions.vertexai = true;
        }

        if (imageConfig.baseURL) {
          geminiOptions.httpOptions = {
            baseUrl: imageConfig.baseURL,
          };
        }

        let ai = new GoogleGenAI(geminiOptions);

        const config = {
          tools: [{ googleSearch: {} }],
          responseModalities: ["IMAGE", "TEXT"],
          imageConfig: {
            imageSize: imageSize,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
          ],
        };

        if (isVertex) {
          config.imageConfig.outputMimeType = "image/png";
        }

        if (aspectRatio) {
          config.imageConfig.aspectRatio = aspectRatio;
        }

        return await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: contents,
          config: config,
        });
      };

      const tryCall = async (apiKey, isVertex) => {
        try {
          const res = await callAI(apiKey, isVertex);
          const img = res.candidates?.[0]?.content?.parts?.find(
            (part) =>
              part.inlineData && part.inlineData.mimeType.startsWith("image/")
          );
          return { response: res, imagePart: img, error: null };
        } catch (e) {
          return { response: null, imagePart: null, error: e };
        }
      };

      const isVertexConfigured = imageConfig.vertex === true;
      let result = await tryCall(API_KEY, isVertexConfigured);

      if (
        (result.error || !result.imagePart) &&
        !isVertexConfigured &&
        imageConfig.vertexApi
      ) {
        logger.warn(
          `Gemini 渠道失败(${
            result.error?.message || "被拦截"
          }), 尝试切换到 Vertex 渠道重试...`
        );
        result = await tryCall(imageConfig.vertexApi, true);
      }

      if (result.error) {
        throw result.error;
      }

      const response = result.response;
      const imagePart = result.imagePart;

      if (imagePart) {
        const imageData = imagePart.inlineData.data;
        await e.reply(segment.image(`base64://${imageData}`));
      } else {
        const textPart = response.candidates?.[0]?.content?.parts?.find(
          (part) => part.text
        );
        const textResponse = textPart
          ? textPart.text
          : "请求被拦截，请更换提示词或图片";
        await e.reply(`${textResponse}`, 10, true);
      }
    } catch (error) {
      logger.error(`调用 Gemini API 失败:`, error);
      await e.reply("创作失败，可能是网络问题或请求超额", 10, true);
    }

    return true;
  }

  async _processImage(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`图片下载失败: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    let finalMimeType = contentType;

    if (contentType === "image/gif") {
      buffer = await sharp(buffer).toFormat("png").toBuffer();
      finalMimeType = "image/png";
    }

    const base64Data = buffer.toString("base64");
    return { base64Data, finalMimeType };
  }
}
