import { sleepData } from "../lib/sleep/SleepData.js";
import { drawSleepChart } from "../lib/sleep/SleepChart.js";

export class Sleep extends plugin {
  constructor() {
    super({
      name: "睡眠记录",
      dsc: "记录群友睡眠时间",
      event: "message.group",
      priority: 1135,
    });
  }

  sleepInfo = Command(/^(睡眠信息|睡眠分析)$/, async (e) => {
    const groupId = e.group_id;
    const history = sleepData.getHistory(groupId, e.user_id);

    if (!history || history.length === 0) {
      await e.reply("你还没有睡眠记录哦~", 10, true);
      return false;
    }

    const senderName = e.sender.card || e.sender.nickname || e.user_id;
    const buffer = await drawSleepChart(history, senderName);

    await e.reply(segment.image(buffer));
    return true;
  });

  goodNight = Command(
    /^晚安$/,
    async (e) => {
      const groupId = e.group_id;

      const order = sleepData.setSleep(groupId, e.user_id);

      if (order === false) {
        return false;
      }

      await e.reply(`晚安！你是本群第 ${order} 个睡觉的`, 0, true);
      return true;
    }
  );

  goodMorning = Command(/^早安$/, async (e) => {
    const groupId = e.group_id;

    const result = sleepData.wakeUp(groupId, e.user_id);

    if (!result) {
      return false;
    }

    const { duration, order, status } = result;

    let msg = order
      ? `早安！你是本群第 ${order} 个起床的`
      : "早安！本次睡眠已记录";

    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    msg += `\n你的睡眠时间为 ${hours} 小时 ${minutes} 分钟`;

    if (status === "short") {
      msg += "\n本次不足 4 小时，已按短睡眠记录";
    } else if (status === "long") {
      msg += "\n本次超过 24 小时，已标记为偏长记录";
    }

    await e.reply(msg, 0, true);
    return true;
  });
}
