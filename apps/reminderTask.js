import schedule from 'node-schedule'
import { CronExpressionParser } from 'cron-parser'
import Setting from '../lib/setting.js'
import { renderReminderContentWithAI } from '../lib/AIUtils/reminder.js'

export class reminderTask extends plugin {
  constructor() {
    super({
      name: '重复提醒任务',
      priority: 1136,
      configWatch: 'reminderTask',
    })
  }

  get appconfig() {
    return Setting.getConfig('reminderTask')
  }

  async init() {
    const tasks = Array.isArray(this.appconfig?.tasks) ? this.appconfig.tasks : []

    if (!tasks.length) return

    for (const task of tasks) {
      if (!task?.enable) continue

      const cronExpression = String(task.cron || '').trim()
      if (!this.isValidCron(cronExpression)) {
        logger.warn(`[reminderTask] 跳过无效 cron 任务: ${task.id || 'unknown'} -> ${cronExpression}`)
        continue
      }

      const content = String(task.content || '').trim()
      if (!content) {
        logger.warn(`[reminderTask] 跳过空内容任务: ${task.id || 'unknown'}`)
        continue
      }

      const job = schedule.scheduleJob(cronExpression, async () => {
        try {
          await this.sendTaskMessage(task)
        } catch (error) {
          logger.error(`[reminderTask] 任务执行失败 ${task.id || 'unknown'}: ${error}`)
        }
      })

      this.jobs.push(job)
    }

    logger.info(`[reminderTask] 已加载 ${this.jobs.length} 个重复提醒任务`)
  }

  isValidCron(expression) {
    if (!expression) return false
    const parts = expression.split(/\s+/)
    if (parts.length !== 5) return false

    try {
      CronExpressionParser.parse(expression)
      return true
    } catch {
      return false
    }
  }

  async sendTaskMessage(task) {
    if (!bot) {
      logger.warn('[reminderTask] bot 不可用，跳过本次发送')
      return
    }

    const rawContent = String(task.content || '').trim()
    const groupId = Number(task.groupId || 0)
    const qq = String(task.qq || '').trim()
    const content = await renderReminderContentWithAI(rawContent, {
      groupId,
      qq,
      taskId: task.id,
    })

    if (groupId > 0) {
      const message = qq ? [segment.at(qq), segment.text(` ${content}`)] : content
      await bot.pickGroup(groupId).sendMsg(message)
      return
    }

    if (qq && /^\d{5,11}$/.test(qq)) {
      await bot.pickFriend(Number(qq)).sendMsg(content)
      return
    }

    logger.warn(`[reminderTask] 任务目标无效: ${task.id || 'unknown'}`)
  }
}
