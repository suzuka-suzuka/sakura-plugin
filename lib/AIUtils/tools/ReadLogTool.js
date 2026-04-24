import fs from "fs"
import { AbstractTool } from "./AbstractTool.js"
import {
  getBotLogPathForDate,
  getLocalDateString,
} from "../../../../../src/utils/logPaths.js"
import {
  filterLogEntriesByLevel,
  filterLogEntriesByScope,
  parseLogEntries,
} from "../../../../../src/utils/logReader.js"

const MAX_LINES = 200

function normalizeNumericId(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export class ReadLogTool extends AbstractTool {
  name = "ReadLog"
  description = "读取 Bot 今日日志。群聊默认返回当前群日志和通用日志，私聊默认返回当前账号全部群日志和通用日志。"
  parameters = {
    properties: {
      level: {
        type: "string",
        enum: ["ALL", "ERROR", "WARN", "INFO"],
        description: "日志级别过滤：ALL=全部，ERROR=仅错误，WARN=警告及以上，INFO=信息及以上。默认 ALL",
      },
      keyword: {
        type: "string",
        description: "关键词过滤（可选），只返回包含该关键词的日志内容，不区分大小写",
      },
      lines: {
        type: "number",
        description: "最多返回多少条日志，默认 50，最大 200",
      },
    },
    required: [],
  }

  func = async function (opts = {}, e = null) {
    const {
      level = "ALL",
      keyword = "",
      lines = 50,
    } = opts

    if (!e) {
      return "读取日志需要当前会话上下文。"
    }

    const today = new Date()
    const dateStr = getLocalDateString(today)
    const logFile = getBotLogPathForDate(today)

    if (!fs.existsSync(logFile)) {
      return `今日暂无日志（${logFile} 不存在）。`
    }

    let content
    try {
      content = fs.readFileSync(logFile, "utf-8")
    } catch (err) {
      return `读取日志文件失败: ${err.message}`
    }

    let entries = parseLogEntries(content)
    entries = filterLogEntriesByLevel(entries, level)

    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase()
      entries = entries.filter((entry) => entry.toLowerCase().includes(kw))
    }

    if (entries.length === 0) {
      return `今日日志（${dateStr}）中未找到匹配的条目。`
    }

    const limit = Math.min(Math.max(1, lines), MAX_LINES)
    const targetSelfId = normalizeNumericId(e.self_id)
    const currentGroupId = normalizeNumericId(e.group_id)
    const usesAllLogs = currentGroupId == null

    entries = usesAllLogs
      ? filterLogEntriesByScope(entries, {
          targetSelfId,
          allGroups: true,
          includeCommon: true,
        })
      : filterLogEntriesByScope(entries, {
          targetSelfId,
          groupId: currentGroupId,
          includeCommon: true,
        })

    if (entries.length === 0) {
      return `今日日志（${dateStr}）中未找到匹配的条目。`
    }

    const displayEntries = entries.slice(-limit)
    const scopeLabel = usesAllLogs
      ? "当前账号全部群 + 通用日志"
      : `当前群 ${currentGroupId} + 通用日志`
    const header = `今日日志 (${dateStr}) | ${scopeLabel} | 共 ${entries.length} 条匹配`

    return `${header}\n${"─".repeat(60)}\n${displayEntries.join("\n\n")}`
  }
}
