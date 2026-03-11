import { AbstractTool } from "./AbstractTool.js"
import fs from "fs"
import path from "path"

const LOG_DIR = path.resolve(process.cwd(), "logs")
const MAX_LINES = 200

/**
 * 解析日志行，将多行堆栈合并为一条记录
 */
function parseLogLines(content) {
    const rawLines = content.split(/\r?\n/)
    const timeRegex = /^\[\d{2}:\d{2}:\d{2}\]/
    const entries = []
    let current = ""

    for (const line of rawLines) {
        if (!line.trim()) continue
        if (timeRegex.test(line)) {
            if (current) entries.push(current)
            current = line
        } else {
            current = current ? current + "\n" + line : line
        }
    }
    if (current) entries.push(current)
    return entries
}

export class ReadLogTool extends AbstractTool {
    name = "ReadLog"
    description = `读取 Bot 今天的运行日志。可按日志级别过滤或关键词搜索，默认返回最近 50 条。`
    parameters = {
        properties: {
            level: {
                type: "string",
                enum: ["ALL", "ERROR", "WARN", "INFO"],
                description: "日志级别过滤：ALL=全部, ERROR=仅错误, WARN=警告及以上, INFO=信息及以上。默认 ALL",
            },
            keyword: {
                type: "string",
                description: "关键词过滤（可选），只返回包含该关键词的日志行，不区分大小写",
            },
            lines: {
                type: "number",
                description: "返回的最大条数，默认 50，最大 200",
            },
        },
        required: [],
    }

    func = async function (opts = {}) {
        const { level = "ALL", keyword = "", lines = 50 } = opts

        // 按今天日期定位日志文件
        const today = new Date()
        const dateStr = today.toISOString().slice(0, 10) // YYYY-MM-DD
        const logFile = path.join(LOG_DIR, `bot.${dateStr}.log`)

        if (!fs.existsSync(logFile)) {
            return `今日暂无日志（${logFile} 不存在）。`
        }

        let content
        try {
            content = fs.readFileSync(logFile, "utf-8")
        } catch (err) {
            return `读取日志文件失败: ${err.message}`
        }

        let entries = parseLogLines(content)

        // 级别过滤
        if (level === "ERROR") {
            entries = entries.filter((e) => e.includes("[ERROR]"))
        } else if (level === "WARN") {
            entries = entries.filter((e) => e.includes("[ERROR]") || e.includes("[WARN]"))
        } else if (level === "INFO") {
            entries = entries.filter(
                (e) => e.includes("[ERROR]") || e.includes("[WARN]") || e.includes("[INFO]")
            )
        }

        // 关键词过滤
        if (keyword && keyword.trim()) {
            const kw = keyword.trim().toLowerCase()
            entries = entries.filter((e) => e.toLowerCase().includes(kw))
        }

        if (entries.length === 0) {
            return `今日日志（${dateStr}）中未找到匹配的条目。`
        }

        const limit = Math.min(Math.max(1, lines), MAX_LINES)
        const total = entries.length
        const recent = entries.slice(-limit)

        const header = `今日日志 (${dateStr}) | 共 ${total} 条匹配 | 显示最近 ${recent.length} 条\n${"─".repeat(60)}`
        return header + "\n" + recent.join("\n")
    }
}
