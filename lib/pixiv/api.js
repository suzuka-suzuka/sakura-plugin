import Setting from "../setting.js"
import PixivModule from "@book000/pixivts"

const Pixiv = PixivModule.default?.Pixiv || PixivModule.Pixiv || PixivModule

let pixivClient = null
let lastLoginTime = 0

export async function getPixivClient() {
  const config = Setting.getConfig("pixiv")
  const refreshToken = config.refresh_token

  if (!refreshToken) {
    throw new Error("Pixiv Refresh Token 未配置。")
  }

  const now = Date.now()
  // Token 有效期约 3600 秒，这里 3000 秒刷新一次
  if (!pixivClient || now - lastLoginTime > 3000 * 1000) {
    try {
      // 关闭旧的客户端
      if (pixivClient) {
        await pixivClient.close().catch(() => {})
      }
      pixivClient = await Pixiv.of(refreshToken)
      lastLoginTime = now
      logger.info("[P站搜图] Pixiv Token 刷新成功。")
    } catch (err) {
      throw new Error(`Pixiv 登录失败: ${err.message || err.error || err}`)
    }
  }

  return pixivClient
}
