import plugin from "../../../lib/plugins/plugin.js"
import { sleepData } from "../lib/sleep/SleepData.js"
import { drawSleepChart } from "../lib/sleep/SleepChart.js"

export class Sleep extends plugin {
  constructor() {
    super({
      name: "睡眠记录",
      dsc: "记录群友睡眠时间",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^(晚安|睡了|睡觉|去睡了|我睡了|我要睡了)$",
          fnc: "goodNight",
          log: false,
        },
        {
          reg: "^(早安|早|起床|醒了|我醒了|早上好)$",
          fnc: "goodMorning",
          log: false,
        },
        {
          reg: "^(睡眠信息|睡眠分析)$",
          fnc: "sleepInfo",
          log: false,
        },
      ],
    })
  }

  async sleepInfo(e) {
    const groupId = e.group_id
    const history = sleepData.getHistory(groupId, e.user_id)

    if (!history || history.length === 0) {
      await this.reply("你还没有睡眠记录哦~", true, { recallMsg: 10 })
      return false
    }

    const senderName = e.sender.card || e.sender.nickname || e.user_id
    const buffer = await drawSleepChart(history, senderName)

    await e.reply(segment.image(buffer))
    return true
  }

  async goodNight(e) {
    const groupId = e.group_id

    const order = sleepData.setSleep(groupId, e.user_id)

    if (order === false) {
      return false
    }

    await e.reply(`晚安！你是本群第 ${order} 个睡觉的`, true)
    return false
  }

  async goodMorning(e) {
    const groupId = e.group_id

    const result = sleepData.wakeUp(groupId, e.user_id)

    if (!result) {
      return false
    }

    const { duration, order } = result

    let msg = `早安！你是本群第 ${order} 个起床的`

    if (duration) {
      const hours = Math.floor(duration / (1000 * 60 * 60))
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
      msg += `\n你的睡眠时间为 ${hours} 小时 ${minutes} 分钟`
    }

    await e.reply(msg, true)
    return false
  }
}
