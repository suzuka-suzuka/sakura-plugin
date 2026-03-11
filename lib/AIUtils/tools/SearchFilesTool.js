import { AbstractTool } from "./AbstractTool.js"
import fs from "fs/promises"
import path from "path"

const ALLOWED_ROOT = path.resolve(process.cwd())
const MAX_FILE_SIZE = 500 * 1024 // 搜索时跳过大于500KB的文件
const DEFAULT_EXTENSIONS = [".js", ".json", ".yaml", ".yml", ".html", ".css", ".md", ".txt", ".mjs", ".cjs"]

// 始终跳过的目录
const ALWAYS_SKIP = [".git"]
// 默认跳过的目录（可通过参数放开）
const DEFAULT_SKIP = ["node_modules", "temp", "logs", "data"]

function resolveSafePath(inputPath) {
    const resolved = path.resolve(ALLOWED_ROOT, inputPath)
    if (!resolved.startsWith(ALLOWED_ROOT)) {
        return null
    }
    const relative = path.relative(ALLOWED_ROOT, resolved)
    if (relative.startsWith(".git")) {
        return null
    }
    return resolved
}

async function searchInDirectory(dirPath, keyword, extensions, results, caseSensitive, skipDirs) {
    let items
    try {
        items = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
        return
    }

    for (const item of items) {
        const itemPath = path.join(dirPath, item.name)

        // 跳过指定目录
        if (ALWAYS_SKIP.includes(item.name)) continue
        if (skipDirs.includes(item.name)) continue

        if (item.isDirectory()) {
            await searchInDirectory(itemPath, keyword, extensions, results, caseSensitive, skipDirs)
        } else {
            const ext = path.extname(item.name).toLowerCase()
            if (!extensions.includes(ext)) continue

            try {
                const stat = await fs.stat(itemPath)
                if (stat.size > MAX_FILE_SIZE) continue

                const content = await fs.readFile(itemPath, "utf-8")
                const lines = content.split("\n")
                const relativePath = path.relative(ALLOWED_ROOT, itemPath)

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]
                    const match = caseSensitive
                        ? line.includes(keyword)
                        : line.toLowerCase().includes(keyword.toLowerCase())

                    if (match) {
                        results.push({
                            file: relativePath,
                            line: i + 1,
                            content: line.trim().substring(0, 200),
                        })
                    }
                }
            } catch {
                // 跳过无法读取的文件
            }
        }
    }
}

export class SearchFilesTool extends AbstractTool {
    name = "SearchFilesText"
    description = `[全文内容检索专属] 在项目文件内部结构中搜索文本匹配代码。返回所有包含指定文本内容的文件名、行号和代码行。注意：如果只需查找带指定名称的文件而非内部结构内容，请使用 'search_files'。`
    parameters = {
        properties: {
            keyword: {
                type: "string",
                description: "要搜索的关键词或文本",
            },
            path: {
                type: "string",
                description: "搜索的根目录路径，相对于项目根目录，默认为整个项目",
            },
            extensions: {
                type: "string",
                description: "要搜索的文件扩展名，用逗号分隔，如 '.js,.json'。默认搜索常见代码文件",
            },
            caseSensitive: {
                type: "boolean",
                description: "是否区分大小写，默认 false",
            },
            includeNodeModules: {
                type: "boolean",
                description: "是否搜索 node_modules 依赖目录，默认 false。当需要查看依赖库的方法或实现时设为 true",
            },
        },
        required: ["keyword"],
    }

    func = async function (opts) {
        const {
            keyword,
            path: searchPath = ".",
            extensions,
            caseSensitive = false,
            includeNodeModules = false,
        } = opts

        if (!keyword || keyword.trim() === "") {
            return "错误：必须提供搜索关键词。"
        }

        const safePath = resolveSafePath(searchPath || ".")
        if (!safePath) {
            return "错误：路径不允许访问。"
        }

        const extList = extensions
            ? extensions.split(",").map(e => e.trim().toLowerCase()).map(e => e.startsWith(".") ? e : `.${e}`)
            : DEFAULT_EXTENSIONS

        // 根据参数决定要跳过的目录
        const skipDirs = includeNodeModules
            ? DEFAULT_SKIP.filter(d => d !== "node_modules")
            : [...DEFAULT_SKIP]

        const results = []
        await searchInDirectory(safePath, keyword.trim(), extList, results, caseSensitive, skipDirs)

        if (results.length === 0) {
            return `未找到包含 "${keyword}" 的匹配结果。`
        }

        // 按文件分组
        const grouped = {}
        for (const r of results) {
            if (!grouped[r.file]) grouped[r.file] = []
            grouped[r.file].push(r)
        }

        let output = `搜索 "${keyword}" 的结果（共 ${results.length} 条匹配）：\n\n`

        for (const [file, matches] of Object.entries(grouped)) {
            output += `📄 ${file}（${matches.length} 处匹配）\n`
            for (const m of matches) {
                output += `  行${m.line}: ${m.content}\n`
            }
            output += "\n"
        }

        return output.trim()
    }
}
