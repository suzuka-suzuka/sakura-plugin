
const requestHashKey = (self_id, group_id) => `sakura:groupRequest:${self_id || "default"}:${group_id}`;
const requestCounterKey = (self_id, group_id) => `sakura:groupRequest:${self_id || "default"}:${group_id}:counter`;
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

    const markerId = await redis.incr(requestCounterKey(e.self_id, e.group_id));
    await redis.expire(requestCounterKey(e.self_id, e.group_id), REQUEST_TTL);
    await redis.hset(requestHashKey(e.self_id, e.group_id), markerId, e.flag);
    await redis.expire(requestHashKey(e.self_id, e.group_id), REQUEST_TTL);

    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=100`;
    // 这里不要拆成多个连续 text 段。部分 QQNT/Milky 组合在“连续文本段 + 图片”混排时，
    // 偶发把中间文本段渲染成乱码/0；把所有文字合成一个 text 段更稳。
    const message = [
      `来人啦\n门牌号: ${markerId}\n敲门人: ${nickname} (${e.user_id})\n敲门口令: ${e.comment || "这个人啥也没说"}`,
      segment.image(avatarUrl),
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
      const flag = await redis.hget(requestHashKey(e.self_id, e.group_id), markerId);

      if (!flag) {
        await e.reply(`门牌号${markerId}不存在`, 10);
        return true;
      }

      await e.reply(`好的，我这就开门`);
      await e.bot.setGroupAddRequest({ flag, approve: true });
      await redis.hdel(requestHashKey(e.self_id, e.group_id), markerId);

      return true;
    }
  );

  handleRejectCommand = Command(
    /^#?关门\s*(\d+)$/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const markerId = Number(e.msg.match(/^#?关门\s*(\d+)$/)[1]);
      const flag = await redis.hget(requestHashKey(e.self_id, e.group_id), markerId);

      if (!flag) {
        await e.reply(`门牌号${markerId}不存在`, 10);
        return true;
      }

      await e.reply(`好的，我这就关门`);
      await e.bot.setGroupAddRequest({ flag, approve: false });
      await redis.hdel(requestHashKey(e.self_id, e.group_id), markerId);

      return true;
    }
  );
}
