import { AbstractTool } from "./AbstractTool.js"
import fs from "fs"
import {
  getBotLogPathForDate,
  getLocalDateString,
} from "../../../../../src/utils/logPaths.js"
import {
  buildLogSections,
  filterLogEntriesByLevel,
  formatLogSections,
  groupLogEntriesBySelfId,
  parseLogEntries,
} from "../../../../../src/utils/logReader.js"

const MAX_LINES = 200

export class ReadLogTool extends AbstractTool {
    name = "ReadLog"
    description = `读取 Bot 今日运行日志。多账号场景下默认返回当前账号日志并保留公共系统日志，也可按账号分组查看全部日志。`
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
                description: "每个分组最多返回多少条，默认 50，最大 200",
            },
            selfId: {
                type: "number",
                description: "按指定机器人账号过滤；不填时默认使用当前会话账号",
            },
            allAccounts: {
                type: "boolean",
                description: "是否按账号分组返回全部账号日志，默认 false",
            },
        },
        required: [],
    }

    func = async function (opts = {}, e = null) {
        const {
            level = "ALL",
            keyword = "",
            lines = 50,
            selfId = null,
            allAccounts = false,
        } = opts

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
        const grouped = groupLogEntriesBySelfId(entries)
        const hasMultipleAccounts = grouped.bySelfId.size > 1
        const targetSelfId = selfId ?? e?.self_id ?? null

        const sections = hasMultipleAccounts
            ? (
                allAccounts || targetSelfId == null
                    ? buildLogSections(entries, {
                        groupBySelfId: true,
                        includeCommon: true,
                        limit,
                    })
                    : buildLogSections(entries, {
                        targetSelfId,
                        includeCommon: true,
                        limit,
                    })
            )
            : buildLogSections(entries, {
                includeCommon: true,
                limit,
            })

        const validSections = sections.filter((section) => section.entries.length > 0)
        if (validSections.length === 0) {
            return `今日日志（${dateStr}）中未找到匹配的条目。`
        }

        const header = hasMultipleAccounts
            ? `今日日志 (${dateStr}) | 多账号模式 | 共 ${entries.length} 条匹配`
            : `今日日志 (${dateStr}) | 共 ${entries.length} 条匹配`

        return `${header}\n${"─".repeat(60)}\n${formatLogSections(validSections)}`
    }
}
