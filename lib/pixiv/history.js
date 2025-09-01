const EXPIRATION_SECONDS = 24 * 60 * 60

class PixivHistory {
  static getKey(e) {
    if (!e) return null
    const sessionId = e.isGroup ? `group:${e.group_id}` : `private:${e.user_id}`
    if (!e.group_id && !e.user_id) return null
    return `pixiv:history:${sessionId}`
  }

  static async addHistory(e, illustId) {
    const key = this.getKey(e)
    if (!key) return
    try {
      await redis.sAdd(key, String(illustId))
      await redis.expire(key, EXPIRATION_SECONDS)
    } catch (error) {
      logger.error(`[P站搜图] 写入Redis历史记录失败: ${error}`)
    }
  }

  static async isInHistory(e, illustId) {
    const key = this.getKey(e)
    if (!key) return false
    try {
      return await redis.sIsMember(key, String(illustId))
    } catch (error) {
      logger.error(`[P站搜图] 读取Redis历史记录失败: ${error}`)
      return false
    }
  }
}

export default PixivHistory
