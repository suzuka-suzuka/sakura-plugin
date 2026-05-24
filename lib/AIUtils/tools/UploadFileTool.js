export class UploadFileTool {
  name = "UploadFile"
  description = "上传文件到群文件。路径或 URL 均可。"

  parameters = {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "本地文件路径 或 远程URL",
      },
      name: {
        type: "string",
        description: "文件名（可选，默认从路径提取）",
      },
      group_id: {
        type: "string",
        description: "目标群号（默认当前群）",
      },
      folder: {
        type: "string",
        description: "群文件夹路径（默认根目录）",
      },
    },
    required: ["file"],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts, e) => {
    const { file, name, group_id, folder } = opts
    const fileName = name || file.split(/[/\\]/).pop() || "file"
    const targetGroup = group_id || String(e.group_id)
    let target = file
    try {
      const fs = await import("node:fs")
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file)
        target = `base64://${buf.toString("base64")}`
      }
    } catch {}

    try {
      await e.group.sendFile(target, fileName)
      return `已上传 ${fileName} 到群 ${targetGroup}`
    } catch (err) {
      return `上传失败：${err.message}`
    }
  }
}
