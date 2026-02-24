import { getPixivClient } from "./api.js"
import { getRedis } from "../../../../src/utils/redis.js"
import axios from "axios"

const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/**
 * 构建 Web 请求 Headers
 */
function buildWebHeaders(cookie) {
  return {
    "User-Agent": WEB_UA,
    "Cookie": cookie.replace(/[\r\n]+/g, '').trim(),
    "Referer": "https://www.pixiv.net/",
    "Accept": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  }
}

/**
 * 获取群已发送作品的 Redis Key
 * @param {string} groupId 群号
 * @param {string} pid 作品ID
 * @param {string} type 订阅类型 (tag | artist)
 */
function getSentKey(groupId, pid, type = 'tag') {
  return `pixiv:subscription:${type}:sent:${groupId}:${pid}`
}

/**
 * 检查作品是否已在该群发送过
 */
export async function isAlreadySent(groupId, pid, type = 'tag') {
  const redis = getRedis()
  const key = getSentKey(groupId, pid, type)
  const exists = await redis.exists(key)
  return exists === 1
}

/**
 * 标记作品已在该群发送
 * @param {number} expireSeconds 过期时间（秒）
 */
export async function markAsSent(groupId, pid, type = 'tag', expireSeconds = 86400) {
  const redis = getRedis()
  const key = getSentKey(groupId, pid, type)
  await redis.set(key, '1', 'EX', expireSeconds)
}

/**
 * 通过 Web API 搜索标签
 * @param {string} tag 标签
 * @param {number} page 页码
 * @param {object} config pixiv配置
 * @param {boolean} isR18Enabled 是否允许R18
 */
async function webSearchTagPage(tag, page, config, isR18Enabled) {
  const aiParam = config.excludeAI ? '&ai_type=1' : ''
  const r18Param = !isR18Enabled ? '&mode=safe' : '&mode=all'
  const url = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(tag)}?word=${encodeURIComponent(tag)}&order=date_d${r18Param}&p=${page}&s_mode=s_tag_full&type=illust${aiParam}&lang=zh`

  const resp = await axios.get(url, {
    headers: buildWebHeaders(config.cookie),
    timeout: 15000,
  })

  if (resp.data && !resp.data.error) {
    const illusts = resp.data.body?.illustManga?.data || []
    return illusts.map(item => ({
      id: typeof item.id === 'string' ? parseInt(item.id) : item.id,
      title: item.title || '',
      x_restrict: item.xRestrict || 0,
      illust_ai_type: item.aiType || 0,
      tags: (item.tags || []).map(t => typeof t === 'string' ? { name: t } : t),
      user: { name: item.userName || '', id: item.userId },
      create_date: item.createDate || '',
      _webSource: true,
    }))
  }
  return []
}

/**
 * 过滤标签订阅的作品（基于质量条件）
 * @param {Array} illusts 作品列表
 * @param {object} filterConfig 过滤配置
 * @param {number} freshnessPeriod 保质期（秒）
 */
export function filterTagSubscriptionIllusts(illusts, filterConfig, freshnessPeriod = 86400) {
  const {
    minBookmark = 300,
    minBookRate = 0.09,
    minBookPerHour = 50,
  } = filterConfig

  const now = Date.now()

  return illusts.filter(illust => {
    const bookmarkCount = illust.total_bookmarks || 0
    const viewCount = illust.total_view || 0

    // 条件一：绝对收藏底线
    if (bookmarkCount < minBookmark) {
      return false
    }

    // 条件二：收藏转换率
    if (viewCount > 0) {
      const bookRate = bookmarkCount / viewCount
      if (bookRate < minBookRate) {
        return false
      }
    }

    // 条件三：单位时间收藏增速
    const createDate = new Date(illust.create_date).getTime()
    const ageInMs = now - createDate

    // 检查是否在保质期内
    if (ageInMs > freshnessPeriod * 1000) {
      return false
    }

    const ageInHours = Math.max(1, ageInMs / (1000 * 60 * 60))
    const requiredBookmarks = ageInHours * minBookPerHour

    if (bookmarkCount < requiredBookmarks) {
      return false
    }

    return true
  })
}

/**
 * 搜索标签订阅作品
 * @param {string} tag 标签
 * @param {Array<string>} groupIds 订阅了该标签的群号列表
 * @param {object} config pixiv配置
 * @param {object} subscriptionConfig 订阅配置
 * @param {boolean} isR18Enabled 是否允许R18
 */
export async function searchTagSubscription(tag, groupIds, config, subscriptionConfig, isR18Enabled) {
  const {
    maxPages = 5,
    freshnessPeriod = 86400,
    minBookmark = 300,
    minBookRate = 0.09,
    minBookPerHour = 50,
  } = subscriptionConfig

  const pixivCli = await getPixivClient()
  const qualifiedIllusts = []
  const now = Date.now()

  let shouldStopSearching = false

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    try {
      const illusts = await webSearchTagPage(tag, page, config, isR18Enabled)

      if (!illusts || illusts.length === 0) {
        logger.info(`[标签订阅] 第${page}页无数据，停止扫描`)
        break
      }

      // 遍历作品
      for (const illust of illusts) {
        // 检查是否超出保质期
        const createDate = new Date(illust.create_date).getTime()
        if (now - createDate > freshnessPeriod * 1000) {
          shouldStopSearching = true
          break
        }

        // 检查是否已在**所有**群发送过
        let allSent = true
        for (const groupId of groupIds) {
          const sent = await isAlreadySent(groupId, illust.id, 'tag')
          if (!sent) {
            allSent = false
            break
          }
        }
        if (allSent) {
          continue
        }

        // 获取作品详情
        try {
          const detailRes = await pixivCli.illustDetail({ illustId: illust.id })
          if (detailRes?.status === 200 && detailRes.data?.illust) {
            const detail = detailRes.data.illust
            const enrichedIllust = {
              ...illust,
              ...detail,
              total_bookmarks: detail.total_bookmarks || 0,
              total_view: detail.total_view || 0,
            }

            // 应用过滤条件
            const filtered = filterTagSubscriptionIllusts(
              [enrichedIllust],
              { minBookmark, minBookRate, minBookPerHour },
              freshnessPeriod
            )

            if (filtered.length > 0) {
              qualifiedIllusts.push(filtered[0])
            }
          }
        } catch (err) {
          logger.warn(`[标签订阅] 获取作品 ${illust.id} 详情失败: ${err.message}`)
        }

        // 请求间隔
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      if (shouldStopSearching) {
        break
      }
    } catch (err) {
      logger.warn(`[标签订阅] 搜索第${page}页失败: ${err.message}`)
    }
  }

  return qualifiedIllusts
}

/**
 * 通过 Web API 获取画师最新作品
 * @param {string|number} userId 画师ID
 * @param {object} config pixiv配置
 */
async function fetchArtistWorksWeb(userId, config) {
  const url = `https://www.pixiv.net/ajax/user/${userId}/profile/all?lang=zh`

  const resp = await axios.get(url, {
    headers: buildWebHeaders(config.cookie),
    timeout: 15000,
  })

  if (resp.data && !resp.data.error) {
    // 返回 illusts 的 id 列表（按时间倒序）
    const illustIds = Object.keys(resp.data.body?.illusts || {})
      .map(id => parseInt(id))
      .sort((a, b) => b - a) // 按 ID 倒序（通常 ID 越大越新）
    return illustIds
  }
  return []
}

/**
 * 搜索画师订阅作品
 * @param {string|number} artistId 画师ID
 * @param {Array<string>} groupIds 订阅了该画师的群号列表
 * @param {object} config pixiv配置
 * @param {object} subscriptionConfig 订阅配置
 */
export async function searchArtistSubscription(artistId, groupIds, config, subscriptionConfig) {
  const {
    freshnessPeriod = 43200, // 12小时
  } = subscriptionConfig

  const pixivCli = await getPixivClient()
  const qualifiedIllusts = []
  const now = Date.now()

  try {
    // 获取画师所有作品 ID
    const illustIds = await fetchArtistWorksWeb(artistId, config)

    if (!illustIds || illustIds.length === 0) {
      logger.info(`[画师订阅] 画师 ${artistId} 无作品`)
      return []
    }

    // 取最新的若干作品进行检查
    const checkIds = illustIds.slice(0, 20) // 最多检查最新20个

    for (const illustId of checkIds) {
      // 检查是否已在所有群发送过
      let allSent = true
      for (const groupId of groupIds) {
        const sent = await isAlreadySent(groupId, illustId, 'artist')
        if (!sent) {
          allSent = false
          break
        }
      }
      if (allSent) {
        continue
      }

      // 获取作品详情
      try {
        const detailRes = await pixivCli.illustDetail({ illustId })
        if (detailRes?.status === 200 && detailRes.data?.illust) {
          const detail = detailRes.data.illust
          const createDate = new Date(detail.create_date).getTime()

          // 检查是否超出保质期
          if (now - createDate > freshnessPeriod * 1000) {
            break
          }

          qualifiedIllusts.push(detail)
        }
      } catch (err) {
        logger.warn(`[画师订阅] 获取作品 ${illustId} 详情失败: ${err.message}`)
      }

      // 请求间隔
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  } catch (err) {
    logger.error(`[画师订阅] 获取画师 ${artistId} 作品列表失败: ${err.message}`)
  }

  return qualifiedIllusts
}

/**
 * 获取作品的图片 URL（应用反代）
 * @param {object} illust 作品详情
 * @param {string} proxy 反代域名
 * @param {number} maxImages 最多返回图片数
 */
export function getIllustImageUrls(illust, proxy, maxImages = 3) {
  let pages = []

  if (illust.meta_pages && illust.meta_pages.length > 0) {
    pages = illust.meta_pages.map(p => p.image_urls.original)
  } else if (illust.meta_single_page?.original_image_url) {
    pages = [illust.meta_single_page.original_image_url]
  }

  // 应用反代
  return pages.slice(0, maxImages).map(url => {
    if (!proxy) return url
    const u = new URL(url)
    u.hostname = proxy
    return u.href
  })
}

/**
 * 构建作品信息文本
 */
export function buildIllustInfoText(illust) {
  const tags = illust.tags?.slice(0, 5).map(t => `#${t.name || t}`).join(' ') || '无'
  const bookmarks = illust.total_bookmarks || 0
  const views = illust.total_view || 0
  const bookRate = views > 0 ? ((bookmarks / views) * 100).toFixed(2) : '0.00'

  const pageCount = illust.page_count || illust.meta_pages?.length || 1
  const pageStr = pageCount > 3 ? `(共 ${pageCount} 张)` : ''

  return [
    `PID: ${illust.id} ${pageStr}`,
    `标题: ${illust.title || '无标题'}`,
    `画师: ${illust.user?.name || '未知'} (${illust.user?.id || '-'})`,
    `收藏: ${bookmarks} | 浏览: ${views} | 收藏率: ${bookRate}%`,
    `标签: ${tags}`,
  ].join('\n')
}
