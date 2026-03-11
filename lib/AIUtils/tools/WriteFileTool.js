import { AbstractTool } from "./AbstractTool.js"
import fs from "fs/promises"
import path from "path"

const ALLOWED_ROOT = path.resolve(process.cwd())

function resolveSafePath(inputPath) {
    const resolved = path.resolve(ALLOWED_ROOT, inputPath)
    if (!resolved.startsWith(ALLOWED_ROOT)) {
        return null
    }
    const relative = path.relative(ALLOWED_ROOT, resolved)
    if (relative.startsWith("node_modules") || relative.startsWith(".git")) {
        return null
    }
    return resolved
}

export class WriteFileTool extends AbstractTool {
    name = "WriteFile"
    description = `写入或编辑项目中的文件。可以整体写入、按行范围替换、或插入内容。路径相对于项目根目录（${ALLOWED_ROOT}）。禁止修改 node_modules 和 .git 目录。建议先用 ReadFile 读取文件确认内容后再编辑。`
    parameters = {
        properties: {
            path: {
                type: "string",
                description: "要写入的文件路径，相对于项目根目录",
            },
            content: {
                type: "string",
                description: "要写入的完整文件内容（整体覆盖写入时使用）",
            },
            startLine: {
                type: "number",
                description: "替换的起始行号（从1开始），配合 endLine 和 newContent 进行部分替换",
            },
            endLine: {
                type: "number",
                description: "替换的结束行号（包含），配合 startLine 和 newContent 进行部分替换",
            },
            newContent: {
                type: "string",
                description: "用于替换 startLine 到 endLine 之间内容的新代码文本",
            },
            createIfNotExists: {
                type: "boolean",
                description: "如果文件不存在是否创建，默认 true",
            },
        },
        required: ["path"],
    }

    func = async function (opts) {
        const {
            path: filePath,
            content,
            startLine,
            endLine,
            newContent,
            createIfNotExists = true,
        } = opts

        if (!filePath) {
            return "错误：必须提供文件路径。"
        }

        const safePath = resolveSafePath(filePath)
        if (!safePath) {
            return "错误：路径不允许访问，只能修改项目目录内的文件（不含 node_modules 和 .git）。"
        }

        try {
            // 部分替换模式
            if (startLine && endLine && newContent !== undefined) {
                let existingContent
                try {
                    existingContent = await fs.readFile(safePath, "utf-8")
                } catch (error) {
                    if (error.code === "ENOENT") {
                        return `错误：文件不存在 - ${filePath}，部分替换模式需要文件已存在。`
                    }
                    throw error
                }

                const lines = existingContent.split("\n")
                const totalLines = lines.length

                if (startLine < 1 || endLine > totalLines || startLine > endLine) {
                    return `错误：行号范围无效。文件共 ${totalLines} 行，你指定的是 ${startLine}-${endLine}。`
                }

                const newLines = newContent.split("\n")
                lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)

                await fs.writeFile(safePath, lines.join("\n"), "utf-8")
                return `成功：已替换 ${filePath} 的第 ${startLine}-${endLine} 行（${endLine - startLine + 1} 行）为新内容（${newLines.length} 行）。文件现在共 ${lines.length} 行。`
            }

            // 整体写入模式
            if (content !== undefined) {
                const dir = path.dirname(safePath)
                await fs.mkdir(dir, { recursive: true })

                let existed = true
                try {
                    await fs.stat(safePath)
                } catch {
                    existed = false
                    if (!createIfNotExists) {
                        return `错误：文件不存在且 createIfNotExists 为 false - ${filePath}`
                    }
                }

                await fs.writeFile(safePath, content, "utf-8")
                const lineCount = content.split("\n").length
                return `成功：${existed ? "覆盖写入" : "创建并写入"} ${filePath}（${lineCount} 行）。`
            }

            return "错误：必须提供 content（整体写入）或 startLine + endLine + newContent（部分替换）。"
        } catch (error) {
            return `写入文件失败: ${error.message}`
        }
    }
}
