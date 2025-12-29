import Setting from "../lib/setting.js"

const msgStore = new Map()

export class handleRecall extends plugin {
  constructor() {
    super({
      name: "撤回复读",
      event: "",
      priority: 35,
    })
  }

  get appconfig() {
    return Setting.getConfig("recall")
  }

  recordMessage = OnEvent("message.group", async (e) => {
    if (!Array.isArray(this.appconfig.Groups) || !this.appconfig.Groups.includes(e.group_id)) {
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
  });

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
        let nickname = e.user_id
        try {
          const member = await e.group.getMemberInfo(e.user_id)
          nickname = member?.card || member?.nickname || e.user_id
        } catch (err) {}

        const forwardMsg = [
          {
            nickname: nickname,
            user_id: e.user_id,
            content: recalledMsg.message,
          },
        ]
        await e.sendForwardMsg(forwardMsg)
      }
      msgStore.delete(e.message_id)
    }
    return false
  });
}
