export class OneBotUploadTool {
  name = "OneBotUpload"
  description = "上传文件到群文件（通过 OneBotv11 WebSocket，无大小限制）。下载完PDF等大文件后使用。本地路径即可，自动转 base64。"

  parameters = {
    type: "object",
    properties: {
      file: { type: "string", description: "本地文件路径" },
      name: { type: "string", description: "文件名（可选）" },
      group_id: { type: "string", description: "目标群号（默认当前群）" },
    },
    required: ["file"],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts, e) => {
    const { file, name, group_id } = opts
    const fileName = name || file.split(/[/\\]/).pop() || "file"
    const targetGroup = group_id || String(e.group_id)

    let payload = file
    try {
      const fs = await import("node:fs")
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file)
        payload = `base64://${buf.toString("base64")}`
      }
    } catch {}

    try {
      await e.bot.sendApi("upload_group_file", {
        group_id: targetGroup,
        file: payload,
        name: fileName,
      })
      return `已上传 ${fileName} 到群 ${targetGroup}`
    } catch (err) {
      return `上传失败：${err.message}`
    }
  }
}
