import fs from "fs"
import path from "path"
import { plugindata } from "../lib/path.js"

const blockListPath = path.join(plugindata, "blocklist.json")

export class BlockUser extends plugin {
  constructor() {
    super({
      name: "黑名单拦截",
      dsc: "拦截黑名单用户消息",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "",
          fnc: "checkBlock",
          log: false,
        },
      ],
    })
  }

  async checkBlock(e) {
    if (!fs.existsSync(blockListPath)) return false

    try {
      const data = JSON.parse(fs.readFileSync(blockListPath, "utf8"))
      const userId = e.user_id?.toString()

      if (userId && data[userId]) {
        const expireTime = data[userId]
        if (expireTime > Date.now()) {
          return true
        }
      }
    } catch (err) {
      logger.error("[BlockUser] 读取黑名单失败", err)
    }
    return false
  }
}
