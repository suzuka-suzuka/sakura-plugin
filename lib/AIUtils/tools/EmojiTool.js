import { AbstractTool } from "./AbstractTool.js";
import { imageEmbeddingManager } from "../ImageEmbedding.js";
import fs from "fs";

export class EmojiTool extends AbstractTool {
  name = "SendEmoji";

  parameters = {
    properties: {
      query: {
        type: "string",
        description: "表情包的描述或情感关键词",
      },
    },
    required: ["query"],
  };

  description = "当你想发送表情包（动画表情）来表达情绪或反应时使用此工具";

  func = async function (opts, e) {
    const { query } = opts;

    if (!query) {
      return "请提供表情包描述";
    }

    try {
      if (imageEmbeddingManager.getCount() === 0) {
        return "表情库为空，暂时无法发送表情";
      }

      const results = await imageEmbeddingManager.searchImage(query, 3);

      if (!results || (Array.isArray(results) && results.length === 0)) {
        return `没有找到"${query}"相关的表情`;
      }

      const candidates = Array.isArray(results) ? results : [results];
      const result = candidates[Math.floor(Math.random() * candidates.length)];

      if (!result.localPath || !fs.existsSync(result.localPath)) {
        return "表情文件丢失";
      }

      await e.reply(segment.image(result.localPath,1));

      return {
        success: true,
        message: "表情发送成功",
        description: result.description,
        similarity: (result.similarity * 100).toFixed(1) + "%",
      };
    } catch (error) {
      logger.error(`[EmojiTool] 发送表情失败: ${error.message}`);
      return `发送表情失败: ${error.message}`;
    }
  };
}
