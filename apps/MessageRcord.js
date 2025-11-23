import Setting from "../lib/setting.js"
if (!global.msgStore) {
  global.msgStore = new Map()
}
const msgStore = global.msgStore

export class recordMessage extends plugin {
  constructor() {
    super({
      name: "消息记录",
      dsc: "防撤回支持",
      event: "message.group",
      priority: 35,
      rule: [
        {
          reg: "",
          fnc: "recordMessage",
          log: false,
        },
      ],
    })
  }
  get appconfig() {
    return Setting.getConfig("recall")
  }

  async recordMessage(e) {
    if (!this.appconfig.enable) {
      return false
    }
    if (this.appconfig.Groups?.length > 0 && !this.appconfig.Groups.includes(e.group_id)) {
      return false
    }
    const hasContentToRecord =
      Array.isArray(e.message) &&
      e.message.some(item => item.type === "text" || item.type === "image")
    if (!hasContentToRecord) {
      return false
    }
    msgStore.set(e.message_id, {
      message: e.message,
    })

    setTimeout(() => {
      msgStore.delete(e.message_id)
    }, 120 * 1000)
    return false
  }
}
