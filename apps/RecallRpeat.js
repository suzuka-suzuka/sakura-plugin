import Setting from "../lib/setting.js"

const msgStore = new Map()

function getStoreKey(selfId, messageId) {
  return `${selfId || "default"}:${messageId}`
}

export class handleRecall extends plugin {
  constructor() {
    super({
      name: "防撤回",
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
    const storeKey = getStoreKey(e.self_id, e.message_id)
    msgStore.set(storeKey, {
      message: e.message,
    })

    setTimeout(() => {
      msgStore.delete(storeKey)
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
    const storeKey = getStoreKey(e.self_id, e.message_id)
    const recalledMsg = msgStore.get(storeKey)
    if (recalledMsg) {
      if (e.user_id === e.operator_id) {
        let nickname = e.user_id
        try {
          const member = await e.group.getMemberInfo(e.user_id)
          nickname = member?.card || member?.nickname || e.user_id
        } catch (err) { }

        const forwardMsg = [
          {
            nickname: nickname,
            user_id: e.user_id,
            content: recalledMsg.message,
          },
        ]
        await e.sendForwardMsg(forwardMsg, { source: "防撤回", news: [{ text: `检测到${nickname}撤回了一条消息` }] })
      }
      msgStore.delete(storeKey)
    }
    return false
  });
}
