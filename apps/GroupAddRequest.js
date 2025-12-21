
export class groupRequestListener extends plugin {
  groupRequests = new Map();

  constructor() {
    super({
      name: "入群申请监听",
    });
  }

  handleGroupAddRequest = OnEvent("request.group.add", async (e) => {
    const info = await e.bot.getStrangerInfo(e.user_id);
    const nickname = info?.nickname || e.user_id;

    if (!this.groupRequests.has(e.group_id)) {
      this.groupRequests.set(e.group_id, new Map());
    }
    const requests = this.groupRequests.get(e.group_id);
    const markerId = requests.size + 1;
    requests.set(markerId, { flag: e.flag, event: e });

    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=100`;
    const message = [
      `来人啦\n`,
      `门牌号: ${markerId}\n`,
      `敲门人: ${nickname} (${e.user_id})\n`,
      segment.image(avatarUrl),
      `\n敲门口令: ${e.comment || "这个人啥也没说"}`,
    ];
    await e.reply(message);

    return false;
  });

  handleApprovalCommand = Command(
    /^#?开门\s*(\d+)$/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const requests = this.groupRequests.get(e.group_id);
      if (!requests) {
        return false;
      }

      const markerId = Number(e.msg.match(/^#?开门\s*(\d+)$/)[1]);

      if (!requests.has(markerId)) {
        await e.reply(`门牌号${markerId}不存在`, 10);
        return true;
      }

      await e.reply(`好的，我这就开门`);
      const { event } = requests.get(markerId);

      await event.approve();
      requests.delete(markerId);

      return true;
    }
  );
}
