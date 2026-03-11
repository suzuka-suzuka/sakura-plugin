
const requestHashKey = (group_id) => `sakura:groupRequest:${group_id}`;
const requestCounterKey = (group_id) => `sakura:groupRequest:${group_id}:counter`;
const REQUEST_TTL = 7 * 24 * 60 * 60;

export class groupRequestListener extends plugin {
  constructor() {
    super({
      name: "入群申请监听",
    });
  }

  handleGroupAddRequest = OnEvent("request.group.add", async (e) => {
    const info = await e.getStrangerInfo(e.user_id);
    const nickname = info?.nickname || e.user_id;

    const markerId = await redis.incr(requestCounterKey(e.group_id));
    await redis.expire(requestCounterKey(e.group_id), REQUEST_TTL);
    await redis.hset(requestHashKey(e.group_id), markerId, e.flag);
    await redis.expire(requestHashKey(e.group_id), REQUEST_TTL);

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

      const markerId = Number(e.msg.match(/^#?开门\s*(\d+)$/)[1]);
      const flag = await redis.hget(requestHashKey(e.group_id), markerId);

      if (!flag) {
        await e.reply(`门牌号${markerId}不存在`, 10);
        return true;
      }

      await e.reply(`好的，我这就开门`);
      await e.bot.setGroupAddRequest({ flag, approve: true });
      await redis.hdel(requestHashKey(e.group_id), markerId);

      return true;
    }
  );
}
