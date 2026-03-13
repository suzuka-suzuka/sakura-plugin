import { setStopFlag } from '../lib/AIUtils/stopFlag.js'

export class ForceStop extends plugin {
    constructor() {
        super({
            name: '强制停止',
            dsc: '中断正在运行的AI工具调用循环',
            event: 'message',
            priority: 10,
        })
    }

    forceStop = Command(/^#?(强制)?停止(对话|生成)?$/i, async (e) => {
        setStopFlag(e)
        await e.reply('已接收强制停止指令，正在结束当前执行逻辑...', 10)
        return false
    })
}
