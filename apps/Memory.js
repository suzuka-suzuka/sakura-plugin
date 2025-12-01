import fs from "fs"
import path from "path"
import { _path } from "../lib/path.js"
import { makeForwardMsg } from "../lib/utils.js"

export class Memory extends plugin {
  constructor() {
    super({
      name: "Memory",
      dsc: "记忆管理",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^#添加记忆.*$",
          fnc: "addMemory",
          log: false,
        },
        {
          reg: "^#导出记忆$",
          fnc: "exportMemory",
          log: false,
        },
      ],
    })
  }

  async addMemory(e) {
    let fullText = ""
    if (e.message && Array.isArray(e.message)) {
      fullText = e.message
        .map(m => {
          if (m.type === "text") return m.text
          if (m.type === "at") return `@${m.qq}`
          return ""
        })
        .join("")
    } else {
      fullText = e.msg || ""
    }

    const memoryContent = fullText.replace(/^#添加记忆/, "").trim()
    if (!memoryContent) {
      return false
    }

    const groupId = e.isGroup ? e.group_id : "private"
    const userId = e.user_id

    const memoryDir = path.join(_path, "plugins", "sakura-plugin", "data", "mimic", String(groupId))
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true })
    }
    const memoryFile = path.join(memoryDir, `${userId}.json`)

    let memories = []
    if (fs.existsSync(memoryFile)) {
      try {
        memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"))
      } catch (err) {
        logger.error(`读取记忆文件失败: ${err}`)
      }
    }

    memories.push(memoryContent)
    fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2))
    await this.reply(`已添加记忆`, false, { recallMsg: 10 })
    return true
  }

  async exportMemory(e) {
    const groupId = e.isGroup ? e.group_id : "private"
    const userId = e.user_id
    const memoryFile = path.join(
      _path,
      "plugins",
      "sakura-plugin",
      "data",
      "mimic",
      String(groupId),
      `${userId}.json`,
    )

    if (!fs.existsSync(memoryFile)) {
      return false
    }

    try {
      const memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"))
      if (!memories || memories.length === 0) {
        return false
      }

      const messages = memories.map(m => ({
        text: m,
        senderId: e.user_id,
        senderName: e.sender.card || e.sender.nickname || "",
      }))

      await makeForwardMsg(e, messages, "用户的记忆列表")
    } catch (err) {
      logger.error(`读取记忆文件失败: ${err}`)
      await this.reply("读取记忆失败，请稍后再试", false, { recallMsg: 10 })
    }
    return true
  }
}
