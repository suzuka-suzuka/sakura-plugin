import { requestStopCurrentTasks } from "../lib/AIUtils/stopFlag.js";

export class ForceStop extends plugin {
    constructor() {
        super({
            name: "强制停止",
            dsc: "中断当前正在运行的 AI 对话或生成任务",
            event: "message",
            priority: 10,
        });
    }

    forceStop = Command(/^#?(强制)?停止(对话|生成)?$/i, async (e) => {
        const hasRunningTask = requestStopCurrentTasks(e);

        if (!hasRunningTask) {
            await e.reply("当前没有正在运行的对话或生成任务。", 10);
            return false;
        }

        await e.reply("已接收强制停止指令，正在结束当前执行逻辑...", 10);
        return false;
    });
}
