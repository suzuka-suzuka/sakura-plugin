if (!global.GroupRequests) {
  global.GroupRequests = new Map()
}

export class groupRequestListener extends plugin {
  constructor() {
    super({
      name: "入群申请监听",
      dsc: "监听入群申请，并发送通知",
      event: "request.group.add",
      priority: 50,
      rule: [
        {
          fnc: "handleGroupAddRequest",
          log: false,
        },
      ],
    })
  }

  async handleGroupAddRequest(e) {
    let nickname = e.user_id

    const userObject = e.bot.pickUser(e.user_id)
    const userInfo = await userObject.getInfo()

    if (userInfo && userInfo.nickname) {
      nickname = userInfo.nickname
    }

    if (!global.GroupRequests.has(e.group_id)) {
      global.GroupRequests.set(e.group_id, new Map())
    }
    const groupRequests = global.GroupRequests.get(e.group_id)
    const markerId = groupRequests.size + 1
    groupRequests.set(markerId, e.flag)

    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=100`
    const message = [
      `来人啦\n`,
      `门牌号: ${markerId}\n`,
      `敲门人: ${nickname} (${e.user_id})\n`,
      segment.image(avatarUrl),
      `\n敲门口令: ${e.comment || "这个人啥也没说"}`,
    ]
    await Bot.sendGroupMsg(e.group_id, message)

    return false
  }
}
