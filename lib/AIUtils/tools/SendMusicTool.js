import { AbstractTool } from "./AbstractTool.js"
import adapter from "../../adapter.js"

export class SendMusicTool extends AbstractTool {
  name = "sendMusic"

  parameters = {
    properties: {
      id: {
        type: "string",
        description: "音乐的id",
      },
    },
    required: ["id"],
  }
  description = "当你想要分享音乐时使用。你必须先使用searchMusic工具来获取音乐ID。"

  func = async function (opts, e) {
    let { id } = opts
    if (adapter === 0) {
      if (e.group && typeof e.group.shareMusic === "function") {
        await e.group.shareMusic('163', id)
        return `音乐已经发送`
      } else {
        return `当前适配器不支持发送音乐功能`
      }
    } else {
      try {
        const music = {
          type: "music",
          data: {
            type: "163",
            id: id,
          },
        }
        await e.reply(music)

        return `音乐已经发送`
      } catch (err) {
        logger.error("发送音乐失败:", err)
        return `音乐发送失败: ${err}`
      }
    }
  }
}
