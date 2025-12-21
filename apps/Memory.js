import fs from "fs"
import path from "path"
import { _path } from "../lib/path.js"

export class Memory extends plugin {
  constructor() {
    super({
      name: "Memory",
      event: "message.group",
      priority: 1135,
    })
  }

  addMemory = Command(/^#添加记忆.*$/, async (e) => {
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
  });

  deleteMemory = Command(/^#删除记忆.*$/, async (e) => {
    const msg = e.msg || ""
    const match = msg.match(/^#删除记忆\s*(\d+)$/)
    if (!match) {
      return false
    }
    const index = parseInt(match[1], 10)

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

    let memories = []
    try {
      memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"))
    } catch (err) {
      logger.error(`读取记忆文件失败: ${err}`)
      await e.reply("读取记忆失败，请稍后再试", false, { recallMsg: 10 })
      return true
    }

    if (index < 1 || index > memories.length) {
      await e.reply(`找不到第 ${index} 条记忆，请检查序号是否正确`, false, { recallMsg: 10 })
      return true
    }

    const deletedMemory = memories.splice(index - 1, 1)
    fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2))
    await e.reply(`已删除第 ${index} 条记忆: ${deletedMemory[0]}`, false, { recallMsg: 10 })
    return true
  });

  exportMemory = Command(/^#导出记忆$/, async (e) => {
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

      const nodes = memories.map((m, index) => ({
        type: "node",
        data: {
          user_id: e.user_id,
          nickname: e.sender.card || e.sender.nickname || "",
          content: `${index + 1}. ${m}`,
        },
      }))

      await e.sendForwardMsg(nodes, { source: "用户的记忆列表" })
    } catch (err) {
      logger.error(`读取记忆文件失败: ${err}`)
      await e.reply("读取记忆失败，请稍后再试", false, { recallMsg: 10 })
    }
    return true
  });
}