import {
  getMemoryPathsFromEvent,
  readMemories,
  writeMemories,
} from "../lib/AIUtils/memoryStore.js";

const MEMORY_MAX = 30;

export class Memory extends plugin {
  constructor() {
    super({
      name: "Memory",
      event: "message.group",
      priority: 1135,
    });
  }

  addMemory = Command(/^#添加记忆.*$/, async (e) => {
    let fullText = "";
    if (e.message && Array.isArray(e.message)) {
      fullText = e.message
        .map((m) => {
          if (m.type === "text") return m.data?.text || "";
          if (m.type === "at") return `@${m.data?.qq || ""}`;
          return "";
        })
        .join("");
    } else {
      fullText = e.msg || "";
    }

    const memoryContent = fullText.replace(/^#添加记忆/, "").trim();
    if (!memoryContent) return false;

    const { scopedFile, candidates } = getMemoryPathsFromEvent(e);
    const memories = readMemories(candidates);

    memories.push(memoryContent);
    let dropped = null;
    if (memories.length > MEMORY_MAX) {
      dropped = memories.shift();
    }
    writeMemories(scopedFile, memories);

    const dropNote = dropped ? `\n（已自动丢弃最旧记忆：${dropped}）` : "";
    await e.reply(`已添加记忆${dropNote}`, 10);
    return true;
  });

  deleteMemory = Command(/^#删除记忆.*$/, async (e) => {
    const msg = e.msg || "";
    const match = msg.match(/^#删除记忆\s*(\d+)$/);
    if (!match) return false;
    const index = parseInt(match[1], 10);

    const { scopedFile, candidates } = getMemoryPathsFromEvent(e);
    const memories = readMemories(candidates);
    if (memories.length === 0) return false;

    if (index < 1 || index > memories.length) {
      await e.reply(`找不到第 ${index} 条记忆，请检查序号是否正确`, 10);
      return true;
    }

    const deletedMemory = memories.splice(index - 1, 1);
    writeMemories(scopedFile, memories);
    await e.reply(`已删除第 ${index} 条记忆: ${deletedMemory[0]}`, 10);
    return true;
  });

  exportMemory = Command(/^#导出记忆$/, async (e) => {
    const { candidates } = getMemoryPathsFromEvent(e);
    const memories = readMemories(candidates);
    if (!memories || memories.length === 0) return false;

    try {
      const nodes = memories.map((m, index) => ({
        user_id: e.user_id,
        nickname: e.sender.card || e.sender.nickname || "",
        content: `${index + 1}. ${m}`,
      }));

      await e.sendForwardMsg(nodes, {
        source: "用户的记忆列表",
        prompt: "我记得你的一切...",
      });
    } catch (err) {
      logger.error(`读取记忆文件失败: ${err}`);
      await e.reply("读取记忆失败，请稍后再试", 10);
    }
    return true;
  });
}
