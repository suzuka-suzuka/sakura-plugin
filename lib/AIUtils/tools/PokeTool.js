export class PokeTool {
  name = "Poke"
  description = "戳一戳群里的某个成员。当你想引起某人注意、打招呼、表示亲昵或调侃时使用。"

  parameters = {
    type: "object",
    properties: {
      qq: {
        type: "string",
        description: "要戳的成员QQ号",
      },
    },
    required: ["qq"],
  }

  function() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    }
  }

  func = async (opts, e) => {
    const { qq: qqStr } = opts
    const qq = Number(qqStr)

    if (isNaN(qq) || !/^\d{5,11}$/.test(qqStr)) {
      return "戳一戳失败：QQ号格式不正确"
    }

    try {
      await e.bot.sendApi("group_poke", { user_id: qqStr, group_id: String(e.group_id) })
      return `已戳了戳 ${qq}`
    } catch (err) {
      return `戳一戳失败：${err.message || "未知错误"}`
    }
  }
}
