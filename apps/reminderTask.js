import schedule from 'node-schedule'
import { CronExpressionParser } from 'cron-parser'
import Setting from '../lib/setting.js'
import { renderReminderContentWithAI } from '../lib/AIUtils/reminder.js'

export class reminderTask extends plugin {
  constructor() {
    super({
      name: '重复提醒任务',
      event: 'message',
      priority: 1135,
      configWatch: 'reminderTask',
    })

    this.jobMap = new Map()
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

      this.scheduleTaskJob(task)
    }

    logger.info(`[reminderTask] 已加载 ${this.jobs.length} 个重复提醒任务`)
  }

  查询提醒 = Command(/^#?(?:提醒列表|查询提醒)(?:\s*(\d+))?$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }

    const serial = String(e.msg.match(/^#?(?:提醒列表|查询提醒)(?:\s*(\d+))?$/)?.[1] || '').trim()
    const allTasks = Array.isArray(this.appconfig?.tasks) ? this.appconfig.tasks : []
    const tasks = this.filterVisibleTasks(e, allTasks)

    if (!tasks.length) {
      return e.reply('当前范围内暂无重复提醒任务。', 10)
    }

    if (serial) {
      const target = tasks.find((task) => String(task.id || '') === serial)
      if (!target) {
        return e.reply(`未找到序号为 ${serial} 的提醒任务。`, 10)
      }

      await e.sendForwardMsg([this.formatTaskNode(target, 1)], {
        prompt: `提醒任务 #${serial}`,
        source: '重复提醒查询',
        news: [{ text: '已返回 1 条提醒任务' }],
      })
      return true
    }

    const nodes = tasks.map((task, index) => this.formatTaskNode(task, index + 1))
    await e.sendForwardMsg(nodes, {
      prompt: '提醒任务列表',
      source: '重复提醒查询',
      news: [{ text: `共 ${tasks.length} 条提醒任务` }],
    })

    return true
  })

  删除提醒 = Command(/^#?(?:删除提醒|移除提醒)\s*(\d+)$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }

    const serial = String(e.msg.match(/^#?(?:删除提醒|移除提醒)\s*(\d+)$/)?.[1] || '').trim()
    if (!serial) {
      return false
    }

    const reminderConfig = this.appconfig || {}
    const tasks = Array.isArray(reminderConfig.tasks) ? [...reminderConfig.tasks] : []
    const taskIndex = tasks.findIndex((task) => String(task.id || '') === serial)

    if (taskIndex < 0) {
      return e.reply(`未找到序号为 ${serial} 的提醒任务。`,10)
    }

    const task = tasks[taskIndex]
    if (Number(e.group_id || 0) > 0 && Number(task.groupId || 0) > 0 && Number(task.groupId) !== Number(e.group_id)) {
      return e.reply('该序号不属于当前群，无法删除。', 10)
    }

    tasks.splice(taskIndex, 1)
    const ok = Setting.setConfig('reminderTask', {
      ...reminderConfig,
      tasks,
    })

    if (!ok) {
      return e.reply('删除失败：写入 reminderTask 配置失败。', 10)
    }

    const job = this.jobMap.get(serial)
    if (job) {
      job.cancel()
      this.jobMap.delete(serial)
    }

    return e.reply(`已删除提醒序号 ${serial}。`, 10)
  })

  开关提醒 = Command(/^#?(?:(开启|关闭|启用|停用)提醒)\s*(\d+)$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }

    const match = e.msg.match(/^#?(?:(开启|关闭|启用|停用)提醒)\s*(\d+)$/)
    const action = String(match?.[1] || '').trim()
    const serial = String(match?.[2] || '').trim()
    if (!action || !serial) {
      return false
    }

    const enable = action === '开启' || action === '启用'

    const reminderConfig = this.appconfig || {}
    const tasks = Array.isArray(reminderConfig.tasks) ? [...reminderConfig.tasks] : []
    const taskIndex = tasks.findIndex((task) => String(task.id || '') === serial)

    if (taskIndex < 0) {
      return e.reply(`未找到序号为 ${serial} 的提醒任务。`, 10)
    }

    const task = tasks[taskIndex]
    if (Number(e.group_id || 0) > 0 && Number(task.groupId || 0) > 0 && Number(task.groupId) !== Number(e.group_id)) {
      return e.reply(`该序号不属于当前群，无法${enable ? '开启' : '关闭'}。`, 10)
    }

    if (Boolean(task.enable) === enable) {
      return e.reply(`提醒序号 ${serial} 已经是${enable ? '开启' : '关闭'}状态。`, 10)
    }

    tasks[taskIndex] = {
      ...task,
      enable,
    }

    const ok = Setting.setConfig('reminderTask', {
      ...reminderConfig,
      tasks,
    })

    if (!ok) {
      return e.reply(`${enable ? '开启' : '关闭'}失败：写入 reminderTask 配置失败。`, 10)
    }

    const job = this.jobMap.get(serial)
    if (job) {
      job.cancel()
      this.jobMap.delete(serial)
    }

    return e.reply(`已${enable ? '开启' : '关闭'}提醒序号 ${serial}。`, 10)
  })

  scheduleTaskJob(task) {
    const cronExpression = String(task?.cron || '').trim()
    const content = String(task?.content || '').trim()
    const id = String(task?.id || '')

    if (!id || !this.isValidCron(cronExpression) || !content) {
      return false
    }

    const job = schedule.scheduleJob(cronExpression, async () => {
      try {
        await this.sendTaskMessage(task)
      } catch (error) {
        logger.error(`[reminderTask] 任务执行失败 ${task.id || 'unknown'}: ${error}`)
      }
    })

    this.jobs.push(job)
    this.jobMap.set(id, job)
    return true
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

  filterVisibleTasks(e, tasks) {
    if (Number(e.group_id || 0) <= 0) {
      return tasks
    }

    const currentGroupId = Number(e.group_id)
    return tasks.filter((task) => Number(task.groupId || 0) === currentGroupId)
  }

  formatTaskNode(task, index) {
    const serial = String(task.id || '')
    const cron = String(task.cron || '')
    const groupId = Number(task.groupId || 0)
    const qq = String(task.qq || '').trim()
    const content = String(task.content || '').trim() || '(空内容)'
    const createdAt = String(task.createdAt || '') || '-'
    const enableText = task.enable ? '启用' : '停用'
    const targetText = groupId > 0
      ? `群 ${groupId}${qq ? ` @${qq}` : ''}`
      : (qq ? `私聊 ${qq}` : '未设置目标')

    return {
      content: [
        `序号：${serial}`,
        `状态：${enableText}`,
        `cron：${cron}`,
        `目标：${targetText}`,
        `内容：${content}`,
        `创建时间：${createdAt}`,
      ].join('\n'),
    }
  }
}
