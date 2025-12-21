if (!global.msgStore) {
  global.msgStore = new Map()
}
const msgStore = global.msgStore

export class handleRecall extends plugin {
  constructor() {
    super({
      name: "撤回复读",
      event: "notice.group_recall",
      priority: 35,
    })
  }

  handleRecall = OnEvent("notice.group_recall", async (e) => {
    if (e.isMaster) {
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
  });
}
