import { AbstractTool } from "./AbstractTool.js";
import {
  getMemoryPaths,
  readMemories,
  writeMemories,
} from "../memoryStore.js";

const MEMORY_MAX = 30;

export class MemoryTool extends AbstractTool {
  name = "Memory";
  description = "主动记住关于当前对话用户的重要信息（偏好、习惯、设定、不喜欢的事等）。请只记录真正值得长期保留的信息，避免记录临时或无意义的内容。";
  parameters = {
    properties: {
      content: {
        type: "string",
        description: "要记住的内容，用简洁的陈述句描述，例如：「该用户不喜欢你说废话」「该用户喜欢猫」。不要在内容中出现QQ号等标识。",
      },
    },
    required: ["content"],
  };

  func = async function (opts, e) {
    const { content } = opts;
    if (!content || !content.trim()) return "content 不能为空。";

    const userId = e?.user_id;
    if (!userId) return "无法获取用户信息。";

    const { scopedFile, candidates } = getMemoryPaths({
      groupId: e?.group_id,
      userId,
    });

    let memories = [];
    try {
      memories = readMemories(candidates, { throwOnError: true });
    } catch {
      return "读取记忆文件失败。";
    }

    memories.push(content.trim());

    // 超出上限时丢弃最旧的一条
    let dropped = null;
    if (memories.length > MEMORY_MAX) {
      dropped = memories.shift();
    }

    writeMemories(scopedFile, memories);

    const dropNote = dropped ? `（已自动丢弃最旧记忆：「${dropped}」）` : "";
    return `已记住：「${content.trim()}」（当前共 ${memories.length} 条记忆）${dropNote}`;
  };
}
