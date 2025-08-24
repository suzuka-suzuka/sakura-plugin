import { AbstractTool } from "./AbstractTool.js";

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
                description: '需要提醒的用户的QQ号。',
            },
            content: {
                type: 'string',
                description: '提醒的具体内容文本。',
            }
        },
        required: ['qq', 'content']
    };
    description = '当你需要在一个具体的时间点或一段时间后设置提醒给某人时使用';
    func = async function (opts, e) {
        let { time, relativeTime, qq, content } = opts;

        if ((time && relativeTime) || (!time && !relativeTime)) {
            return "参数错误：'time' (绝对时间) 和 'relativeTime' (相对时间) 必须提供一个，且只能提供一个。";
        }
        if (!/^\d{5,11}$/.test(qq)) {
            return `参数错误：提供的QQ号 "${qq}" 格式不正确。`;
        }
        if (!content || !content.trim()) {
            return `参数错误：提醒内容不能为空。`;
        }

        try {
            let delayMs;
            const now = new Date();

            if (time) {
                if (!/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(time)) {
                    return `参数错误：提供的时间 "${time}" 格式不正确，请使用 'HH:mm' 或 'HH:mm:ss' 格式。`;
                }
                const [hour, minute, second = 0] = time.split(':').map(Number);
                if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
                    return `参数错误：时间 ${time} 包含无效的数值。`;
                }
                let targetDate = new Date();
                targetDate.setHours(hour, minute, second, 0);
                if (targetDate <= now) {
                    targetDate.setDate(targetDate.getDate() + 1);
                }
                delayMs = targetDate.getTime() - now.getTime();
            } else { 
                const hoursMatch = relativeTime.match(/(\d+)\s*h/i);
                const minutesMatch = relativeTime.match(/(\d+)\s*m/i);
                const secondsMatch = relativeTime.match(/(\d+)\s*s/i);
                const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
                const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
                const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
                delayMs = (hours * 3600000) + (minutes * 60000) + (seconds * 1000);
                if (delayMs <= 0) {
                     return `参数错误：相对时间 "${relativeTime}" 解析后的总时长必须大于0秒。`;
                }
            }

            if (delayMs <= 0) {
                return "错误：计算出的提醒时间点异常，无法设置。";
            }
            
            const targetDate = new Date(now.getTime() + delayMs);

            setTimeout(async () => {
                try {
                    const message = [
                        segment.at(qq),
                        ' ',
                        content
                    ];
                    await e.reply(message);
                } catch (error) {
                    console.error(`[ReminderTool] 发送提醒时出错: ${error.message}`);
                }
            }, delayMs);

            const remindTimeString = targetDate.toLocaleString('zh-CN', { hour12: false });
            const confirmationMsg = `提醒已设置成功。\n将在 ${remindTimeString} 提醒QQ用户 ${qq}。`;
            return confirmationMsg;

        } catch (error) {
            console.error(`[ReminderTool] 设置提醒时发生未知错误: ${error.message}`);
            return `设置提醒时发生内部错误: ${error.message}`;
        }
    };
}