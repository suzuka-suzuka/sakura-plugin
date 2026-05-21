export class EmojiReactionTool {
  name = "EmojiReaction"
  description = "给群里的某条消息贴表情（添加emoji回应）。当你想对发言表示赞、笑哭、比心、拍桌等情绪时使用。常用emoji_id：66(笑哭)、181(点赞)、297(比心)、10024(委屈)、424(拍桌)、221(白眼)、243(捂脸)"

  parameters = {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description: "要贴表情的消息ID（从聊天记录的seq或message_id获取）",
      },
      emoji_id: {
        type: "string",
        description: "表情ID，数字字符串，如'66'(笑哭)、'181'(点赞)、'297'(比心)、'424'(拍桌)",
      },
    },
    required: ["message_id", "emoji_id"],
  }

  function() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    }
  }

  func = async (opts, e) => {
    const { message_id, emoji_id } = opts

    if (!message_id) return "贴表情失败：缺少消息ID"
    if (!emoji_id || !/^\d+$/.test(emoji_id)) return "贴表情失败：emoji_id 必须是纯数字"

    try {
      await e.bot.sendApi("set_msg_emoji_like", { message_id, emoji_id })
      return `已在消息 ${message_id} 上贴了表情 ${emoji_id}`
    } catch (err) {
      return `贴表情失败：${err.message || "未知错误"}`
    }
  }
}
