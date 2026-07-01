import setting from "../../setting.js"

export class JMComicTool {
  name = "JMComic"
  description = "下载禁漫天堂漫画为PDF。传入车牌号（漫画ID）即可，下载完成后会返回PDF路径。拿到路径后请调用 sendForwardMessage 工具，以合并转发消息发送该文件，禁止携带group_id等任何包含QQ信息的数据。"
  parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "漫画ID（车牌号），如'205395'",
      },
    },
    required: ["id"],
  }

  get r18Config() {
    return setting.getConfig("r18")
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts, e) => {
    const id = (opts.id || "").trim()
    if (!id || !/^\d+$/.test(id)) return "下载失败：漫画ID格式无效"

    if (!this.r18Config.enable.includes(e.group_id)) {
      return "本群未开启r18功能哦~"
    }

    const { exec } = await import("node:child_process")
    const pathModule = await import("node:path")
    const fs = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const pluginDir = pathModule.dirname(fileURLToPath(import.meta.url))
    const configPath = pathModule.resolve(pluginDir, "../../../config/jm.yml")

    const cmd = `jmcomic ${id} --option=${configPath}`

    let pdfDir = ""
    try {
      const yml = fs.readFileSync(configPath, "utf8")
      const m = yml.match(/pdf_dir:\s*(.+)/)
      if (m) pdfDir = m[1].trim()
    } catch {}

    return new Promise((resolve) => {
      exec(cmd, { timeout: 600000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) {
          resolve(`下载失败：${err.message}`)
          return
        }

        let pdfPath = ""
        if (pdfDir) {
          const candidate = pathModule.join(pdfDir, `${id}.pdf`)
          if (fs.existsSync(candidate)) pdfPath = candidate
        }
        if (!pdfPath) {
          const match = stdout?.match(/pdf[^:]*:\s*(.+\.pdf)/i)
          if (match) pdfPath = match[1].trim()
        }

        if (pdfPath) {
          resolve(`PDF已生成：${pdfPath}。请调用 sendForwardMessage 工具，传入 file 为该路径，以合并转发消息发送，禁止携带group_id等任何包含QQ信息的数据。`)
        } else {
          const tail = stdout?.trim().split("\n").slice(-3).join("\n") || ""
          resolve(`下载完成但未找到PDF。输出：${tail}`)
        }
      })
    })
  }
}
