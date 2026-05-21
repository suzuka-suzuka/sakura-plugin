export class GroupSignTool {
  name = "GroupSign"
  description = "在指定群聊中打卡签到。"

  parameters = {
    type: "object",
    properties: {
      group_id: { type: "string", description: "要打卡的群号（默认当前群）" },
    },
    required: [],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts, e) => {
    const group_id = opts.group_id || String(e.group_id)
    try {
      await e.group.sign()
      return `群 ${group_id} 打卡成功`
    } catch (err) {
      return `打卡失败：${err.message}`
    }
  }
}
