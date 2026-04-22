import { generateImagesWithProvider } from "../imageProvider.js";
import { AbstractTool } from "./AbstractTool.js";
import Setting from "../../setting.js";

export class ImageGeneratorTool extends AbstractTool {
  name = "ImageGenerator";

  parameters = {
    properties: {
      prompt: {
        type: "string",
        description: "Prompt used to generate or edit an image.",
      },
      seq: {
        type: "array",
        items: {
          type: "integer",
        },
        description: "Referenced message seq values that contain source images.",
      },
      aspectRatio: {
        type: "string",
        description: "Target aspect ratio.",
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
        description: "Target image quality level.",
        enum: ["1K", "2K", "4K"],
      },
    },
    required: ["prompt"],
  };

  description = "Generate or edit images, including redraw, style transfer, and P-editing.";

  func = async function (opts, e) {
    let { prompt, seq, aspectRatio, imageSize } = opts;
    imageSize = imageSize || "1K";
    const imageUrls = [];

    if (seq) {
      const seqList = Array.isArray(seq) ? seq : [seq];
      for (const currentSeq of seqList) {
        try {
          const targetMsg = await e.getMsg(currentSeq);
          if (!targetMsg?.message) {
            continue;
          }

          const images = targetMsg.message
            .filter((messageItem) => messageItem.type === "image")
            .map((messageItem) => messageItem.data?.url)
            .filter(Boolean);

          if (images.length > 0) {
            imageUrls.push(...images);
            await e.react(128076, currentSeq);
          }
        } catch (error) {
          logger.error(
            `[ImageGeneratorTool] failed to load seq ${currentSeq}:`,
            error
          );
        }
      }
    }

    if (!prompt) {
      return "\u4f60\u5fc5\u987b\u63d0\u4f9b\u4e00\u6bb5\u7528\u4e8e\u751f\u6210\u56fe\u7247\u7684\u63cf\u8ff0\u3002";
    }

    try {
      const imageConfig = Setting.getConfig("EditImage");
      const imageBuffers = await generateImagesWithProvider(
        imageConfig,
        prompt,
        imageUrls,
        {
          aspectRatio,
          imageSize,
        }
      );

      if (imageBuffers.length > 0) {
        await e.reply(segment.image(imageBuffers[0]));
        return "\u5df2\u6210\u529f\u751f\u6210\u5e76\u53d1\u9001\u56fe\u7247\uff0c\u7981\u6b62\u56de\u590d[\u56fe\u7247]";
      }

      return "\u672a\u80fd\u751f\u6210\u56fe\u7247\uff0c\u53ef\u80fd\u88ab\u5b89\u5168\u7b56\u7565\u62e6\u622a\u3002";
    } catch (error) {
      logger.error("[ImageGeneratorTool] image generation failed:", error);

      if (
        imageUrls.length > 0 &&
        error.message &&
        error.message.includes("Could not load image")
      ) {
        return `\u56fe\u7247\u751f\u6210\u5931\u8d25\uff0c\u63d0\u4f9b\u7684\u56fe\u7247\u53ef\u80fd\u65e0\u6cd5\u8bbf\u95ee\u6216\u683c\u5f0f\u4e0d\u53d7\u652f\u6301\u3002${error.message}`;
      }

      return `\u56fe\u7247\u751f\u6210\u5931\u8d25\uff1a${error.message}`;
    }
  };
}
