import Setting from "../lib/setting.js"

export class EmojiLike extends plugin {
  constructor() {
    super({
      name: "表情回应",
      dsc: "自动表情回应",
      event: "message.group",
      priority: 34,
      rule: [
        {
          reg: "",
          fnc: "autoEmojiLike",
          log: false,
        },
      ],
    })
  }

  get appconfig() {
    return Setting.getConfig("EmojiLike")
  }

  async autoEmojiLike(e) {
    const cfg = this.appconfig
    const cfgList = cfg.configs
    if (!Array.isArray(cfgList)) return false

    const groupCfg = cfgList.find(c => String(c.group) === String(e.group_id))
    if (!groupCfg) return false

    let replyAll = groupCfg.replyAll !== false
    let emojiId = null

    let userMap = {}
    if (groupCfg.users && typeof groupCfg.users === "string") {
      const lines = groupCfg.users.split("\n")
      for (const line of lines) {
        const parts = line.trim().split(":")
        if (parts.length >= 2) {
          const qq = parts[0].trim()
          const id = parts[1].trim()
          if (qq && id) {
            userMap[qq] = id
          }
        }
      }
    }

    let isUserInList = Object.prototype.hasOwnProperty.call(userMap, String(e.user_id))
    let userEmojiId = isUserInList ? userMap[String(e.user_id)] : null
    let targetEmojiIdStr = null

    if (!replyAll) {
      if (!isUserInList) return false
      targetEmojiIdStr = userEmojiId || groupCfg.default
    } else {
      if (isUserInList && userEmojiId) {
        targetEmojiIdStr = userEmojiId
      } else {
        targetEmojiIdStr = groupCfg.default
      }
    }

    if (!targetEmojiIdStr) return false

    if (String(targetEmojiIdStr).includes(",")) {
      const ids = String(targetEmojiIdStr)
        .split(",")
        .map(id => id.trim())
        .filter(id => id)
      if (ids.length > 0) {
        emojiId = ids[Math.floor(Math.random() * ids.length)]
      } else {
        emojiId = targetEmojiIdStr
      }
    } else {
      emojiId = targetEmojiIdStr
    }

    try {
      await e.group?.setMsgEmojiLike?.(e.message_id, emojiId)
    } catch (err) {
      logger.error(`[EmojiLike] 表情回应失败: ${err}`)
    }

    return false
  }
}
