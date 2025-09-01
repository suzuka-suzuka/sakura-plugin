import Setting from "../setting.js"

export async function requestApi(url) {
  const config = Setting.getConfig("pixiv")

  if (!config.cookie) {
    throw new Error("Pixiv Cookie 未配置。")
  }

  const headers = {
    Cookie: config.cookie,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    Referer: "https://www.pixiv.net/",
  }

  const response = await fetch(url, {
    headers,
    timeout: 30000,
  })

  if (!response.ok) {
    const error = new Error(`Pixiv API 请求失败，状态码: ${response.status}`)
    error.status = response.status
    throw error
  }

  const res = await response.json()

  if (res.error) {
    throw new Error(`Pixiv API 返回错误: ${res.message || "未知错误"}`)
  }

  return res
}
