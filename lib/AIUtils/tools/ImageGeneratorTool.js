import { GoogleGenAI } from "@google/genai";
import { AbstractTool } from "./AbstractTool.js";
import Setting from "../../setting.js";
import { urlToBase64 } from "../../utils.js";

export class ImageGeneratorTool extends AbstractTool {
  name = "ImageGenerator";

  parameters = {
    properties: {
      prompt: {
        type: "string",
        description:
          "用于生成或修改图片的英文描述性文字，请将描述性文字翻译为英文",
      },
      seq: {
        type: "array",
        items: {
          type: "integer",
        },
        description: "图片或动画表情的消息seq",
      },
      aspectRatio: {
        type: "string",
        description:
          "图片的宽高比，可选值: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9",
        enum: [
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
        ],
      },
      imageSize: {
        type: "string",
        description: "图片的分辨率，可选值: 1K, 2K, 4K",
        enum: ["1K", "2K", "4K"],
      },
    },
    required: ["prompt"],
  };

  description =
    "当你需要根据描述生成图片或者在提供一张图片的基础上生成新的内容时使用";

  func = async function (opts, e) {
    let { prompt, seq, aspectRatio, imageSize } = opts;
    imageSize = imageSize || "1K";
    let imageUrls = [];

    if (seq) {
      const seqList = Array.isArray(seq) ? seq : [seq];
      for (const s of seqList) {
        try {
          const targetMsg = await e.getMsg(s);
          if (targetMsg?.message) {
            const images = targetMsg.message
              .filter((m) => m.type === "image")
              .map((m) => m.data?.url);

            if (images.length > 0) {
              imageUrls.push(...images);
              await e.react(128076, s);
            }
          }
        } catch (err) {
          logger.error(`获取消息 seq: ${s} 失败: ${err}`);
        }
      }
    }

    if (!prompt) {
      return "你必须提供一个用于生成图片的描述。";
    }

    try {
      const imageConfig = Setting.getConfig("EditImage");

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

      const isVertex = imageConfig.vertex === true;
      const geminiOptions = { apiKey: API_KEY };

      if (isVertex) {
        geminiOptions.vertexai = true;
      }

      if (imageConfig.baseURL) {
        geminiOptions.httpOptions = {
          baseUrl: imageConfig.baseURL,
        };
      }

      let ai = new GoogleGenAI(geminiOptions);

      const safetySettings = [
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "OFF",
        },
      ];
      const contents = [];
      contents.push({ text: prompt });

      if (imageUrls && imageUrls.length > 0) {
        for (const imageUrl of imageUrls) {
          try {
            const result = await urlToBase64(imageUrl);
            if (result) {
              contents.push({
                inlineData: {
                  mimeType: result.mimeType,
                  data: result.base64,
                },
              });
            } else {
              logger.warn(`无法处理图片: ${imageUrl}`);
            }
          } catch (error) {
            logger.error(`处理图片 ${imageUrl} 时出错:`, error);
          }
        }
      }

      const config = {
        safetySettings: safetySettings,
        tools: [{ googleSearch: {} }],
        responseModalities: ["IMAGE"],
        imageConfig: {
          imageSize: imageSize,
        },
      };

      if (aspectRatio) {
        config.imageConfig.aspectRatio = aspectRatio;
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: contents,
        config: config,
      });

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (part) =>
          part.inlineData && part.inlineData.mimeType.startsWith("image/")
      );

      if (imagePart) {
        const imageData = imagePart.inlineData.data;
        e.reply(segment.image(`base64://${imageData}`));
        return `已成功生成并发送图片，禁止回复[图片]`;
      } else {
        return "未能生成图片，可能被安全策略拦截。";
      }
    } catch (error) {
      logger.error("图片生成失败:", error);
      if (
        imageUrls &&
        imageUrls.length > 0 &&
        error.message &&
        error.message.includes("Could not load image")
      ) {
        return `图片生成失败，可能是由于提供的图片无法访问或格式不受支持。请检查图片URL或尝试其他图片。错误信息: ${error.message}`;
      }
      return `图片生成失败，错误信息: ${error.message}`;
    }
  };
}
