import { AbstractTool } from "./AbstractTool.js";
import {
  appendMemory,
  getMemoryLocation,
  readMemoryDocument,
  withMemoryDocumentLock,
  writeMemoryDocument,
} from "../memoryStore.js";
import { scheduleMemoryMaintenance } from "../memoryMaintenance.js";

function formatStoreResult(scope, result, maintenanceScheduled) {
  const scopeName = scope === "group" ? "群公共记忆" : "用户记忆";
  let message = `已写入${scopeName}：「${result.content}」`;
  if (maintenanceScheduled) message += "；已在后台整理记忆并更新摘要";
  return message;
}

export class MemoryTool extends AbstractTool {
  name = "Memory";
  description = "记录值得跨对话长期记住的信息。只要出现以下情况就应主动调用：用户的自我介绍、称呼、身份、喜好与厌恶、习惯、目标、约定、承诺、重要经历，或本群共同确立的规则、梗、称呼和设定等。宁可多记也不要遗漏，遇到稳定、可复用的信息就随手存下，不必等用户明确要求“记住”。每条只存一件独立、清晰的事实。";
  parameters = {
    properties: {
      scope: {
        type: "string",
        enum: ["user", "group"],
        description: "user=当前用户的长期信息；group=当前群需要共同记住的信息。",
      },
      content: {
        type: "string",
        description: "需要长期记住的一条简洁、明确且可独立理解的事实。",
      },
    },
    required: ["scope", "content"],
  };

  func = async function (opts, e) {
    const { scope, content } = opts || {};
    if (!e?.user_id) return "无法获取用户信息。";
    if (!["user", "group"].includes(scope)) return "不支持的记忆作用域。";
    if (scope === "group" && !e.group_id) return "私聊中不能访问群公共记忆。";
    if (!String(content || "").trim()) {
      return "记忆内容不能为空。";
    }

    try {
      const location = getMemoryLocation({
        groupId: e.group_id,
        userId: e.user_id,
        scope,
      });
      const storeResult = await withMemoryDocumentLock(location.memoryFile, () => {
        const document = readMemoryDocument(location.memoryFile, { throwOnError: true });
        const result = appendMemory(document, { content });
        if (result.error) return result;
        writeMemoryDocument(location.memoryFile, result.document);
        return result;
      });
      if (storeResult.error) return storeResult.error;

      const maintenanceScheduled = scheduleMemoryMaintenance({ location, e });
      return formatStoreResult(scope, storeResult, maintenanceScheduled);
    } catch (error) {
      return `记忆操作失败：${error.message}`;
    }
  };
}
