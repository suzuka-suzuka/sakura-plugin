import cfg from "../../../lib/config/config.js"
if (!global.msgStore) {
  global.msgStore = new Map()
}
const msgStore = global.msgStore

export class handleRecall extends plugin {
  constructor() {
    super({
      name: "撤回复读",
      dsc: "撤回复读",
      event: "notice.group.recall",
      priority: 35,
      rule: [
        {
          reg: "",
          fnc: "handleRecall",
          log: false,
        },
      ],
    })
  }

  async handleRecall(e) {
    if (cfg.masterQQ.includes(e.operator_id)) {
      return false
    }
    if (!e.message_id) {
      return false
    }
    const recalledMsg = msgStore.get(e.message_id)
    if (recalledMsg) {
      if (e.user_id === e.operator_id) {
        await e.group.sendMsg(recalledMsg.message)
      }
      msgStore.delete(e.message_id)
    }
    return false
  }
}
