export const activeAiTasks = new Map();
export const aiStopRequests = new Set();

let aiTaskCounter = 0;

export function getStopKey(e) {
    const selfId = e.self_id || "default";
    return e.group_id
        ? `bot:${selfId}:group:${e.group_id}:user:${e.user_id}`
        : `bot:${selfId}:private:${e.user_id}`;
}

function createTaskId() {
    aiTaskCounter += 1;
    return `ai-task-${Date.now()}-${aiTaskCounter}`;
}

export function startAiTask(e) {
    const key = getStopKey(e);
    const taskId = createTaskId();
    let tasks = activeAiTasks.get(key);

    if (!tasks) {
        tasks = new Set();
        activeAiTasks.set(key, tasks);
    }

    tasks.add(taskId);
    return taskId;
}

export function finishAiTask(e, taskId) {
    if (!taskId) {
        return;
    }

    aiStopRequests.delete(taskId);

    const key = getStopKey(e);
    const tasks = activeAiTasks.get(key);

    if (!tasks) {
        return;
    }

    tasks.delete(taskId);
    if (tasks.size === 0) {
        activeAiTasks.delete(key);
    }
}

export function requestStopCurrentTasks(e) {
    const tasks = activeAiTasks.get(getStopKey(e));

    if (!tasks || tasks.size === 0) {
        return false;
    }

    for (const taskId of tasks) {
        aiStopRequests.add(taskId);
    }

    return true;
}

export function checkAndClearStopFlag(taskId) {
    if (taskId && aiStopRequests.has(taskId)) {
        aiStopRequests.delete(taskId);
        return true;
    }

    return false;
}
