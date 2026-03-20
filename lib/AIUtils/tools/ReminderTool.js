import { AbstractTool } from "./AbstractTool.js";
import {
    addRepeatReminderTask,
    buildRepeatCron,
    parseDelayMs,
    resolveReminderTarget,
    scheduleOnceReminder,
} from '../reminder.js';

export class ReminderTool extends AbstractTool {
    name = 'Reminder';
    parameters = {
        properties: {
            time: {
                type: 'string',
                description: "具体时间点，必须是 'HH:mm' 或 'HH:mm:ss' 格式",
            },
            relativeTime: {
                type: 'string',
                description: "相对时长，使用 h(小时), m(分钟), s(秒) 为单位进行表述",
            },
            qq: {
                type: 'string',
                description: '需要提醒的用户QQ号（可选，不填默认当前用户QQ）。',
            },
            content: {
                type: 'string',
                description: '提醒的具体内容文本。',
            },
            type: {
                type: 'string',
                description: "提醒类型：'once'(单次，默认) 或 'repeat'(重复)",
            },
            cron: {
                type: 'string',
                description: "重复提醒的 5 段 cron 表达式（可选）。填写后将创建周期提醒，例如 '0 8 * * *'",
            }
        },
        required: ['content']
    };
    description = '当你需要在一个具体的时间点或一段时间后设置提醒给某人时使用';
    func = async function (opts, e) {
        let { time, relativeTime, qq, content, cron, type = 'once' } = opts;

        const mode = String(type || 'once').trim().toLowerCase();
        if (mode !== 'once' && mode !== 'repeat') {
            return "参数错误：'type' 仅支持 'once' 或 'repeat'。";
        }

        const { groupId, targetQQ, hasQQ, hasGroup } = resolveReminderTarget(e, qq);

        if (!hasQQ) {
            return "参数错误：无法确定提醒对象，请提供 qq 或在私聊/群聊上下文中调用。";
        }

        if (!/^\d{5,11}$/.test(targetQQ)) {
            return `参数错误：提供的QQ号 "${targetQQ}" 格式不正确。`;
        }

        if (!content || !content.trim()) {
            return `参数错误：提醒内容不能为空。`;
        }

        try {
            if (mode === 'repeat') {
                const repeatResult = buildRepeatCron(cron);
                if (!repeatResult.ok) {
                    return repeatResult.message;
                }
                if (!repeatResult.hasCron) {
                    return "参数错误：type='repeat' 时必须提供 cron 表达式。";
                }

                const repeatSaveResult = addRepeatReminderTask({
                    targetQQ,
                    groupId: hasGroup ? Number(groupId) : 0,
                    content,
                    cronExpression: repeatResult.cronExpression,
                });

                if (!repeatSaveResult.ok) {
                    return '重复提醒创建失败：写入配置文件失败。';
                }

                return `重复提醒已创建成功（序号: ${repeatSaveResult.taskId}）。`;
            }

            const delayResult = parseDelayMs(time, relativeTime);
            if (!delayResult.ok) {
                return delayResult.message;
            }

            const { delayMs } = delayResult;

            if (delayMs <= 0) {
                return "错误：计算出的提醒时间点异常，无法设置。";
            }

            try {
                await scheduleOnceReminder({
                    delayMs,
                    targetQQ,
                    groupId: hasGroup ? Number(groupId) : 0,
                    content,
                });
            } catch (error) {
                return `提醒设置失败：Redis 过期提醒注册失败（${error.message}）。`;
            }

            return "提醒已设置成功。";

        } catch (error) {
            console.error(`[ReminderTool] 设置提醒时发生未知错误: ${error.message}`);
            return `设置提醒时发生内部错误: ${error.message}`;
        }
    };
}