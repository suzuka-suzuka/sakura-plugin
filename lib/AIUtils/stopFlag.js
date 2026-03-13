export const aiStopFlags = new Map();

export function getStopKey(e) {
    return e.group_id ? `group:${e.group_id}:user:${e.user_id}` : `private:${e.user_id}`;
}

export function setStopFlag(e) {
    aiStopFlags.set(getStopKey(e), true);
}

export function checkAndClearStopFlag(e) {
    const key = getStopKey(e);
    if (aiStopFlags.has(key)) {
        aiStopFlags.delete(key);
        return true;
    }
    return false;
}
