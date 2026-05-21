export class FriendRequestTool {
  name = "FriendRequest"
  description = "处理好友请求。action=approve 同意，action=reject 拒绝。flag 来自好友请求事件的标识。"

  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["approve", "reject"],
        description: "操作：approve(同意)、reject(拒绝)",
      },
      flag: { type: "string", description: "请求标识（必填）" },
      remark: { type: "string", description: "好友备注（approve时可选）" },
    },
    required: ["action", "flag"],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts, e) => {
    const { action, flag, remark } = opts
    try {
      const approve = action === "approve"
      await e.bot.sendApi("set_friend_add_request", { flag, approve, ...(remark && { remark }) })
      return approve ? "已同意好友申请" : "已拒绝好友申请"
    } catch (err) {
      return `好友请求处理失败：${err.message}`
    }
  }
}
