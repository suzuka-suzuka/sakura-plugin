import { resolve, dirname, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { readdir, readFile, writeFile, rm, mkdir, stat } from "node:fs/promises"
import { mkdirSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = resolve(__dirname, "../../../data/AIworks")

mkdirSync(BASE, { recursive: true })

function safePath(userPath) {
  const resolved = resolve(BASE, userPath)
  if (resolved === BASE) return resolved
  if (!resolved.toLowerCase().startsWith(BASE.toLowerCase() + sep)) return null
  return resolved
}

export class AIworksTool {
  name = "AIworks"
  description = "AI 的工作目录，可在此创建、编写代码文件或其他文件，再配合 UploadFile 等工具上传给用户。支持列出目录、读取、写入/创建、删除文件。所有路径相对于 AIworks 根目录。"

  parameters = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "read", "write", "delete"], description: "操作类型：list 列目录，read 读文件，write 写文件，delete 删除" },
      path: { type: "string", description: "相对路径（如 sub/file.txt），list 时可为空字符串表示根目录" },
      content: { type: "string", description: "写入内容（仅 action=write 时需要）" },
    },
    required: ["action"],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts) => {
    const { action, path: userPath, content } = opts
    const target = safePath(userPath || ".")
    if (!target) return "操作失败：路径不合法（不允许访问 AIworks 目录之外）"

    switch (action) {
      case "list": {
        try {
          const entries = await readdir(target, { withFileTypes: true })
          if (entries.length === 0) return "（空目录）"
          return entries.map(e => `${e.isDirectory() ? "[目录]" : "[文件]"} ${e.name}`).join("\n")
        } catch (err) {
          if (err.code === "ENOENT") return "操作失败：目录不存在"
          return `操作失败：${err.message}`
        }
      }

      case "read": {
        try {
          const data = await readFile(target, "utf-8")
          return data || "（文件为空）"
        } catch (err) {
          if (err.code === "ENOENT") return "操作失败：文件不存在"
          if (err.code === "EISDIR") return "操作失败：这是一个目录，请使用 list"
          return `操作失败：${err.message}`
        }
      }

      case "write": {
        if (content == null) return "操作失败：write 操作需要提供 content 参数"
        try {
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, content, "utf-8")
          return `写入成功：${target}`
        } catch (err) {
          return `操作失败：${err.message}`
        }
      }

      case "delete": {
        try {
          const s = await stat(target)
          if (s.isDirectory()) {
            await rm(target, { recursive: true })
            return `已删除目录：${target}`
          }
          await rm(target)
          return `已删除文件：${target}`
        } catch (err) {
          if (err.code === "ENOENT") return "操作失败：文件或目录不存在"
          return `操作失败：${err.message}`
        }
      }

      default:
        return `操作失败：未知 action "${action}"，支持 list/read/write/delete`
    }
  }
}
