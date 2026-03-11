import Setting from "../setting.js"
import { getPixivClient } from "./api.js"
import axios from "axios"
import sharp from "sharp"
import { getRedis } from "../../../../src/utils/redis.js"
import { downloadImage } from "../ImageUtils/ImageUtils.js"
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __rankingDir = path.dirname(fileURLToPath(import.meta.url))
const THUMB_CACHE_DIR = path.resolve(__rankingDir, '../../data/pixivTemp')

const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// 排行榜类型映射
const RANKING_MODES = {
  "日榜": "daily",
  "周榜": "weekly",
  "月榜": "monthly",
  "男性日榜": "male",
  "女性日榜": "female",
  "原创日榜": "original",
  "新人日榜": "rookie",
  "r18日榜": "daily_r18",
  "r18周榜": "weekly_r18",
}

// 网格配置
const MAX_COLUMNS = 5
const MAX_ROWS_PER_CANVAS = 6
const CELL_WIDTH = 200  // 每个单元格宽度
const CELL_HEIGHT = 280 // 每个单元格高度（包含标签区域）
const IMAGE_HEIGHT = 240 // 图片区域高度
const LABEL_HEIGHT = 40  // 标签区域高度
const CANVAS_PADDING = 20
const HEADER_HEIGHT = 80 // 标题区域高度
const FOOTER_HEIGHT = 40 // 底注区域高度
const HORIZONTAL_RATIO = 1.2 // 宽高比超过此值判定为横图

/**
 * 计算到下一个上午11点的秒数（Redis过期时间）
 */
function getExpireSeconds() {
  const now = new Date()
  const next11 = new Date(now)
  next11.setHours(11, 0, 0, 0)
  if (now.getHours() >= 11) {
    next11.setDate(next11.getDate() + 1)
  }
  return Math.max(Math.floor((next11 - now) / 1000), 60)
}

/**
 * 格式化排行榜日期 "20260222" → "2月22日"
 */
function formatRankDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return ''
  const month = parseInt(dateStr.slice(4, 6))
  const day = parseInt(dateStr.slice(6, 8))
  return `${month}月${day}日`
}

/**
 * 清除指定榜单的缩略图磁盘缓存
 */
function clearThumbnailCache(modeKey) {
  const cacheDir = path.join(THUMB_CACHE_DIR, modeKey)
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true })
    logger.info(`[P站排行榜] 已清除${modeKey}缩略图缓存`)
  }
}

/**
 * 构建Web API请求头
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
 * 从Web API获取排行榜数据
 * @param {string} mode 排行榜模式
 * @param {number} page 页码
 * @param {object} config 配置
 * @returns {Promise<Array>} 作品列表
 */
async function fetchWebRanking(mode, page, config) {
  const url = `https://www.pixiv.net/ranking.php?mode=${mode}&p=${page}&format=json`

  try {
    const resp = await axios.get(url, {
      headers: buildWebHeaders(config.cookie),
      timeout: 15000,
    })

    if (resp.data && resp.data.contents) {
      return {
        illusts: resp.data.contents.map(item => ({
          id: item.illust_id,
          title: item.title || '',
          rank: item.rank,
          rating_count: item.rating_count || 0,  // 点赞数
          view_count: item.view_count || 0,      // 浏览数
          illust_content_type: item.illust_content_type,
          width: item.width,
          height: item.height,
          url: item.url,  // 缩略图URL
          user_name: item.user_name || '',
          user_id: item.user_id,
          tags: item.tags || [],
          _source: 'web',
        })),
        date: resp.data.date || '',
      }
    }
    return { illusts: [], date: '' }
  } catch (error) {
    // 抛出异常，让上层 fetchRankingData 决定是否停止
    throw error
  }
}

/**
 * 批量获取排行榜数据（拉取500条）
 */
async function fetchRankingData(mode, config) {
  const MAX_PAGES = 10  // 最多拉取10页（普通榜），R18榜等遇到空/错误时提前退出
  const allIllusts = []
  let rankDate = ''

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    try {
      const { illusts, date } = await fetchWebRanking(mode, page, config)
      if (page === 1 && date) rankDate = date
      // 返回空结果说明已经没有更多页，提前退出
      if (!illusts || illusts.length === 0) {
        logger.info(`[P站排行榜] 第${page}页无数据，停止拉取`)
        break
      }
      allIllusts.push(...illusts)
    } catch (error) {
      logger.warn(`[P站排行榜] 获取第${page}页失败: ${error.message}，停止拉取`)
      break
    }
  }

  return { illusts: allIllusts, rankDate }
}

/**
 * 第一次筛选：点赞率 > 0.1
 * 点赞率 = rating_count / view_count
 */
function filterByLikeRate(illusts, minRate = 0.1) {
  return illusts.filter(illust => {
    if (illust.view_count === 0) return false
    const likeRate = illust.rating_count / illust.view_count
    illust.likeRate = likeRate
    return likeRate > minRate
  })
}

/**
 * 并发获取作品详情（使用App API）
 */
async function fetchIllustDetails(illusts, concurrency = 5) {
  const pixivCli = await getPixivClient()
  const results = []

  for (let i = 0; i < illusts.length; i += concurrency) {
    const batch = illusts.slice(i, i + concurrency)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    const batchResults = await Promise.all(batch.map(async (illust) => {
      try {
        const detailRes = await pixivCli.illustDetail({ illustId: illust.id })
        if (detailRes?.status === 200 && detailRes.data?.illust) {
          const detail = detailRes.data.illust
          return {
            ...illust,
            total_bookmarks: detail.total_bookmarks || 0,
            total_view: detail.total_view || 0,
            x_restrict: detail.x_restrict || 0,
            meta_single_page: detail.meta_single_page,
            meta_pages: detail.meta_pages,
            image_urls: detail.image_urls,
            tags: detail.tags,
            _hasDetail: true,
          }
        }
      } catch (error) {
        logger.warn(`[P站排行榜] 获取作品${illust.id}详情失败: ${error.message}`)
      }
      return null
    }))

    results.push(...batchResults.filter(Boolean))
  }

  return results
}

/**
 * 第二次筛选：收藏率 > minRate 且 收藏数 > minBookmarks
 * 收藏率 = total_bookmarks / total_view
 */
function filterByBookmarkRate(illusts, minRate = 0.1, minBookmarks = 500) {
  return illusts.filter(illust => {
    if (!illust._hasDetail || illust.total_view === 0) return false
    if (illust.total_bookmarks < minBookmarks) return false
    const bookmarkRate = illust.total_bookmarks / illust.total_view
    illust.bookmarkRate = bookmarkRate
    return bookmarkRate > minRate
  })
}

/**
 * 按点赞率排序
 */
function sortByLikeRate(illusts) {
  return illusts.sort((a, b) => (b.likeRate || 0) - (a.likeRate || 0))
}

/**
 * 判断是否为横图
 */
function isHorizontalImage(width, height) {
  return width / height > HORIZONTAL_RATIO
}

/**
 * 下载并处理缩略图（带磁盘缓存）
 */
async function downloadThumbnail(url, config, modeKey = '', illustId = '') {
  // 优先读取磁盘缓存
  if (modeKey && illustId) {
    const cacheFile = path.join(THUMB_CACHE_DIR, modeKey, `${illustId}.jpg`)
    if (fs.existsSync(cacheFile)) {
      try { return fs.readFileSync(cacheFile) } catch { }
    }
  }

  try {
    // 应用反代
    let fetchUrl = url
    if (config.proxy) {
      const u = new URL(url)
      u.hostname = config.proxy
      fetchUrl = u.href
    }

    const buffer = await downloadImage(fetchUrl)
    if (!buffer) return null

    // 写入磁盘缓存
    if (modeKey && illustId) {
      try {
        const cacheDir = path.join(THUMB_CACHE_DIR, modeKey)
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(path.join(cacheDir, `${illustId}.jpg`), buffer)
      } catch { }
    }

    return buffer
  } catch (error) {
    logger.warn(`[P站排行榜] 下载缩略图失败: ${error.message}`)
    return null
  }
}

/**
 * 计算图片布局
 * @returns {Array<Array>} 每个画布的布局信息
 */
function calculateLayout(illusts) {
  const canvases = []
  let currentCanvas = []
  let currentRow = 0
  let currentCol = 0

  for (let i = 0; i < illusts.length; i++) {
    const illust = illusts[i]
    const isHorizontal = isHorizontalImage(illust.width, illust.height)
    const colSpan = isHorizontal ? 2 : 1

    // 检查当前行是否能容纳
    if (currentCol + colSpan > MAX_COLUMNS) {
      // 换行
      currentRow++
      currentCol = 0
    }

    // 检查是否需要新画布
    if (currentRow >= MAX_ROWS_PER_CANVAS) {
      canvases.push(currentCanvas)
      currentCanvas = []
      currentRow = 0
      currentCol = 0
    }

    currentCanvas.push({
      illust,
      index: i,  // 全局排名序号
      row: currentRow,
      col: currentCol,
      colSpan,
      isHorizontal,
    })

    currentCol += colSpan
  }

  // 添加最后一个画布
  if (currentCanvas.length > 0) {
    canvases.push(currentCanvas)
  }

  return canvases
}

/**
 * 生成单个画布
 * @param {Array} layoutItems 布局项
 * @param {object} config 配置
 * @param {string} modeKey 排行榜类型名称
 * @param {number} canvasIndex 画布序号
 * @param {number} totalCanvases 总画布数
 */
async function generateCanvas(layoutItems, config, modeKey = "日榜", canvasIndex = 0, totalCanvases = 1, rankDate = '') {
  // 判断是否为R18榜
  const isR18 = modeKey.includes("r18")

  // 计算画布尺寸
  const maxRow = Math.max(...layoutItems.map(item => item.row)) + 1
  const canvasWidth = MAX_COLUMNS * CELL_WIDTH + CANVAS_PADDING * 2
  const canvasHeight = maxRow * CELL_HEIGHT + CANVAS_PADDING * 2 + HEADER_HEIGHT + FOOTER_HEIGHT

  const composites = []

  // 生成标题区域
  const pageInfo = totalCanvases > 1 ? ` (${canvasIndex + 1}/${totalCanvases})` : ''
  const escapeXml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  const dateLabel = rankDate ? formatRankDate(rankDate) : (() => { const n = new Date(); return `${n.getMonth() + 1}月${n.getDate()}日` })()
  const titleText = escapeXml(`${dateLabel} ${modeKey}${pageInfo}`)
  const botname = Setting.getConfig("bot")?.botname || '本喵'
  const subtitleText = escapeXml(`由${botname}严选的优质插画~`)

  const headerSvg = Buffer.from(`
    <svg width="${canvasWidth}" height="${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="35" dominant-baseline="middle" text-anchor="middle" 
            font-family="Arial, Microsoft YaHei, sans-serif" font-size="24" fill="white" font-weight="bold">
        ${titleText}
      </text>
      <text x="50%" y="60" dominant-baseline="middle" text-anchor="middle" 
            font-family="Arial, Microsoft YaHei, sans-serif" font-size="14" fill="#aaaaaa">
        ${subtitleText}
      </text>
    </svg>
  `)

  composites.push({
    input: headerSvg,
    left: 0,
    top: 0,
  })

  for (const item of layoutItems) {
    const { illust, index, row, col, colSpan, isHorizontal } = item

    // 下载缩略图（优先读取磁盘缓存）
    const thumbBuffer = await downloadThumbnail(illust.url, config, modeKey, illust.id)
    if (!thumbBuffer) continue

    // 计算图片尺寸和位置（需要加上标题高度偏移）
    const cellWidth = colSpan * CELL_WIDTH
    const x = CANVAS_PADDING + col * CELL_WIDTH
    const y = HEADER_HEIGHT + CANVAS_PADDING + row * CELL_HEIGHT

    try {
      // 调整图片大小以适应格子
      let imageProcessor = sharp(thumbBuffer)
        .resize(cellWidth - 4, IMAGE_HEIGHT - 4, {
          fit: 'cover',
          position: 'center'
        })

      // R18榜应用高斯模糊
      if (isR18) {
        imageProcessor = imageProcessor.blur(15)
      }

      const resizedImage = await imageProcessor.png().toBuffer()

      composites.push({
        input: resizedImage,
        left: x + 2,
        top: y + 2,
      })

      // 创建标签背景
      const labelBg = await sharp({
        create: {
          width: cellWidth - 4,
          height: LABEL_HEIGHT - 4,
          channels: 4,
          background: { r: 50, g: 50, b: 60, alpha: 1 }
        }
      }).png().toBuffer()

      composites.push({
        input: labelBg,
        left: x + 2,
        top: y + IMAGE_HEIGHT,
      })

      // 创建序号和PID标签 (使用SVG)
      const labelText = `#${index + 1} | ${illust.id}`
      const escapedText = labelText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const textSvg = Buffer.from(`
        <svg width="${cellWidth - 4}" height="${LABEL_HEIGHT - 4}" xmlns="http://www.w3.org/2000/svg">
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                font-family="Arial, sans-serif" font-size="13" fill="white" font-weight="bold">
            ${escapedText}
          </text>
        </svg>
      `)

      composites.push({
        input: textSvg,
        left: x + 2,
        top: y + IMAGE_HEIGHT,
      })
    } catch (error) {
      logger.warn(`[P站排行榜] 处理图片${illust.id}失败: ${error.message}`)
    }
  }

  // 生成底注区域
  const footerText = escapeXml('Created by sakura-plugin & sakura-bot')
  const footerSvg = Buffer.from(`
    <svg width="${canvasWidth}" height="${FOOTER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
            font-family="Arial, sans-serif" font-size="12" fill="white">
        ${footerText}
      </text>
    </svg>
  `)

  composites.push({
    input: footerSvg,
    left: 0,
    top: canvasHeight - FOOTER_HEIGHT,
  })

  // 创建底图并合成所有图层
  const result = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 30, g: 30, b: 40, alpha: 1 }
    }
  }).composite(composites).png().toBuffer()

  return result
}

/**
 * 存储排行榜数据到Redis
 */
async function saveRankingToRedis(mode, illusts, rankDate = '') {
  const redis = getRedis()
  const key = `sakura:pixiv:ranking:${mode}`
  const dataKey = `${key}:data`
  const expireSeconds = getExpireSeconds() // 到下一个上午11点

  // 存储完整数据
  const data = illusts.map((illust, index) => ({
    rank: index + 1,
    id: illust.id,
    title: illust.title,
    likeRate: illust.likeRate,
    bookmarkRate: illust.bookmarkRate,
    total_bookmarks: illust.total_bookmarks,
    total_view: illust.total_view,
    rating_count: illust.rating_count,
    view_count: illust.view_count,
    user_name: illust.user_name,
    user_id: illust.user_id,
    width: illust.width,
    height: illust.height,
    url: illust.url,
    x_restrict: illust.x_restrict || 0,
    tags: illust.tags,
    meta_single_page: illust.meta_single_page,
    meta_pages: illust.meta_pages,
  }))

  await redis.set(dataKey, JSON.stringify(data), "EX", expireSeconds)
  await redis.set(`${key}:updateTime`, Date.now().toString(), "EX", expireSeconds)
  if (rankDate) await redis.set(`${key}:date`, rankDate, "EX", expireSeconds)

  logger.info(`[P站排行榜] 已存储${mode}排行榜数据，共${data.length}条`)

  return data
}

/**
 * 从Redis获取排行榜数据
 */
async function getRankingFromRedis(mode) {
  const redis = getRedis()
  const dataKey = `sakura:pixiv:ranking:${mode}:data`

  const dataStr = await redis.get(dataKey)
  if (!dataStr) return null

  try {
    return JSON.parse(dataStr)
  } catch {
    return null
  }
}

/**
 * 从Redis获取特定排名的作品
 */
async function getRankingItemFromRedis(mode, rank) {
  const data = await getRankingFromRedis(mode)
  if (!data || rank < 1 || rank > data.length) return null
  return data[rank - 1]
}

/**
 * 从 Redis 获取榜单日期字符串（如 "20260222"）
 */
async function getRankingDate(mode) {
  const redis = getRedis()
  const dateStr = await redis.get(`sakura:pixiv:ranking:${mode}:date`)
  return dateStr || ''
}

/**
 * 获取指定排行榜的筛选配置
 */
function getRankingConfig(config, modeKey) {
  const rankingConfigs = config.rankingConfigs || []
  const found = rankingConfigs.find(c => c.mode === modeKey)
  return found || { minLikeRate: 0.1, minBookmarkRate: 0.1, minBookmarks: 500 }
}

/**
 * 完整的排行榜刷新流程
 */
async function refreshRanking(modeKey = "日榜") {
  const config = Setting.getConfig("pixiv")
  if (!config.cookie) {
    throw new Error("未配置 Pixiv Cookie")
  }

  const mode = RANKING_MODES[modeKey] || "daily"
  const rankingConfig = getRankingConfig(config, modeKey)
  const minLikeRate = rankingConfig.minLikeRate || 0.1
  const minBookmarkRate = rankingConfig.minBookmarkRate || 0.1
  const minBookmarks = rankingConfig.minBookmarks || 500

  logger.info(`[P站排行榜] 开始刷新${modeKey}... (点赞率>${minLikeRate}, 收藏率>${minBookmarkRate}, 收藏数>${minBookmarks})`)

  // 清除旧缩略图缓存
  clearThumbnailCache(modeKey)

  // 1. 拉取500条数据
  const { illusts: rawData, rankDate } = await fetchRankingData(mode, config)
  if (rawData.length === 0) {
    throw new Error("获取排行榜数据失败")
  }
  logger.info(`[P站排行榜] 获取到${rawData.length}条原始数据，榜单日期: ${rankDate}`)

  // 2. 第一次筛选：点赞率 > minLikeRate
  const likeFiltered = filterByLikeRate(rawData, minLikeRate)
  logger.info(`[P站排行榜] 点赞率筛选后剩余${likeFiltered.length}条`)

  if (likeFiltered.length === 0) {
    throw new Error("没有符合点赞率要求的作品")
  }

  // 3. 获取详情
  const withDetails = await fetchIllustDetails(likeFiltered, 10)
  logger.info(`[P站排行榜] 获取详情后剩余${withDetails.length}条`)

  // 4. 第二次筛选：收藏率 > minBookmarkRate 且 收藏数 > minBookmarks
  const bookmarkFiltered = filterByBookmarkRate(withDetails, minBookmarkRate, minBookmarks)
  logger.info(`[P站排行榜] 收藏率和收藏数筛选后剩余${bookmarkFiltered.length}条`)

  if (bookmarkFiltered.length === 0) {
    throw new Error("没有符合收藏率和收藏数要求的作品")
  }

  // 5. 按点赞率排序
  const sorted = sortByLikeRate(bookmarkFiltered)

  // 6. 存储到Redis
  await saveRankingToRedis(mode, sorted, rankDate)

  // 7. 生成一览图
  const canvasImages = await generateRankingImages(sorted, config, modeKey, rankDate)

  return {
    total: sorted.length,
    images: canvasImages,
    data: sorted,
  }
}

/**
 * 生成排行榜一览图
 * @param {Array} illusts 作品列表
 * @param {object} config 配置
 * @param {string} modeKey 排行榜类型名称
 */
async function generateRankingImages(illusts, config, modeKey = "日榜", rankDate = '') {
  const layouts = calculateLayout(illusts)
  const images = []

  for (let i = 0; i < layouts.length; i++) {
    logger.info(`[P站排行榜] 生成第${i + 1}/${layouts.length}张一览图...`)
    try {
      const canvasBuffer = await generateCanvas(layouts[i], config, modeKey, i, layouts.length, rankDate)
      images.push(canvasBuffer)
    } catch (error) {
      logger.error(`[P站排行榜] 生成第${i + 1}张一览图失败: ${error.message}`)
    }
  }

  return images
}

/**
 * 获取缓存的排行榜一览图
 * 如果没有缓存则重新生成
 */
async function getRankingOverview(modeKey = "日榜") {
  const mode = RANKING_MODES[modeKey] || "daily"
  const config = Setting.getConfig("pixiv")

  // 检查缓存
  const cachedData = await getRankingFromRedis(mode)

  if (cachedData && cachedData.length > 0) {
    // 有缓存，读取榜单日期并生成一览图
    const rankDate = await getRankingDate(mode)
    const images = await generateRankingImages(cachedData, config, modeKey, rankDate)
    return {
      total: cachedData.length,
      images,
      fromCache: true,
    }
  }

  // 无缓存，自动拉取
  return await refreshRanking(modeKey)
}

/**
 * 构建排行榜转发消息参数，可在 event.sendForwardMsg 和 bot.sendForwardMsg 中复用
 * @param {object} result  getRankingOverview 的返回值
 * @param {string} modeKey  榜单名称（日榜 / r18日榜 等）
 * @param {number|string} botId  机器人 QQ，用于节点 user_id
 * @returns {{ nodes, prompt, news, source }}
 */
function buildRankingForwardParams(result, modeKey, botId) {
  const now = new Date()
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`
  const cacheInfo = result.fromCache ? '(缓存)' : ''

  const nodes = []

  // 标题节点
  nodes.push({
    nickname: 'P站排行榜',
    user_id: botId,
    content: `📊 ${dateStr} ${modeKey}${cacheInfo}\n共 ${result.total} 张优质作品`,
  })

  // 一览图节点
  for (const img of result.images) {
    nodes.push({
      nickname: 'P站排行榜',
      user_id: botId,
      content: segment.image(img),
    })
  }

  // 使用说明节点
  nodes.push({
    nickname: 'P站排行榜',
    user_id: botId,
    content: [
      `📖 使用方法`,
      `━━━━━━━━━━━━━━`,
      `🔹 发送「${modeKey}#1」获取第1名图片`,
      `━━━━━━━━━━━━━━`,
      `💡 序号对应一览图中的排名`,
    ].join('\n'),
  })

  return {
    nodes,
    prompt: `P站${modeKey}排行榜`,
    news: [
      { text: `${dateStr} ${modeKey}${cacheInfo}` },
      { text: `共 ${result.total} 张优质作品` },
    ],
    source: 'pixiv排行榜',
  }
}

export {
  RANKING_MODES,
  refreshRanking,
  getRankingFromRedis,
  getRankingItemFromRedis,
  getRankingOverview,
  generateRankingImages,
  buildRankingForwardParams,
}
