import Setting from "../setting.js"
import { getPixivClient } from "./api.js"
import axios from "axios"

const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function getRandomSample(arr, count) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, Math.min(count, arr.length))
}

function buildWebHeaders(cookie) {
    return {
        "User-Agent": WEB_UA,
        "Cookie": cookie.replace(/[\r\n]+/g, '').trim(),
        "Referer": "https://www.pixiv.net/",
        "Accept": "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
}

async function getWebTotalCount(tag, isR18, config) {
    const mode = isR18 ? "r18" : "safe"
    const aiParam = config.excludeAI ? '&ai_type=1' : ''
    const url = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(tag)}?word=${encodeURIComponent(tag)}&order=date_d&mode=${mode}&p=1&s_mode=s_tag_full&type=illust${aiParam}&lang=zh`
    const headers = buildWebHeaders(config.cookie)

    const fetchTotal = async () => {
        const resp = await axios.get(url, { headers, timeout: 10000 })
        if (resp.data?.error) return null
        return resp.data?.body?.illustManga?.total || 0
    }

    try {
        let total = await fetchTotal()
        if (total === 0) {
            logger.warn(`[P站搜图] 获取总量为0，等待 60 秒后重试...`)
            await new Promise(resolve => setTimeout(resolve, 60000))
            total = await fetchTotal()
        }
        return total || null
    } catch {
        return null
    }
}

async function webSearchPage(tag, isR18, config, page) {
    const mode = isR18 ? "r18" : "safe"
    const aiParam = config.excludeAI ? '&ai_type=1' : ''
    const url = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(tag)}?word=${encodeURIComponent(tag)}&order=date_d&mode=${mode}&p=${page}&s_mode=s_tag_full&type=illust${aiParam}&lang=zh`

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

async function randomSampleSearch(tag, isR18, config) {
    const MAX_SCAN_PAGES = 3
    const DETAIL_FETCH_COUNT = 60
    const WEB_PAGE_SIZE = 60
    const minBookmarks = config.minBookmarks || 100
    const minBookmarkViewRatio = config.minBookmarkViewRatio || 0.03

    const totalCount = await getWebTotalCount(tag, isR18, config)
    if (!totalCount) return null

    const maxPage = Math.ceil(totalCount / WEB_PAGE_SIZE)
    const pagesToFetch = getRandomSample(
        Array.from({ length: maxPage }, (_, i) => i),
        Math.min(MAX_SCAN_PAGES, maxPage)
    )

    let allIllusts = []
    for (let i = 0; i < pagesToFetch.length; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000))
        try {
            const illusts = await webSearchPage(tag, isR18, config, pagesToFetch[i] + 1)
            allIllusts.push(...illusts)
        } catch { /* 单页失败跳过 */ }
    }

    const seenIds = new Set()
    const filtered = allIllusts.filter(i => {
        if (seenIds.has(i.id)) return false
        seenIds.add(i.id)
        return true
    })

    if (filtered.length === 0) return null

    const sampled = getRandomSample(filtered, Math.min(DETAIL_FETCH_COUNT, filtered.length))
    const pixivCli = await getPixivClient()
    const BATCH_COUNT = 6
    const BATCH_SIZE = 10
    const qualifiedList = []

    for (let i = 0; i < BATCH_COUNT; i++) {
        const batch = sampled.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        if (batch.length === 0) break
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000))

        const batchResults = await Promise.all(batch.map(async (illust) => {
            try {
                const detailRes = await pixivCli.illustDetail({ illustId: illust.id })
                if (detailRes?.status === 200 && detailRes.data?.illust) {
                    const detail = detailRes.data.illust
                    const bookmarkCount = detail.total_bookmarks || 0
                    const viewCount = detail.total_view || 0
                    const ratio = viewCount > 0 ? bookmarkCount / viewCount : 0
                    if (bookmarkCount >= minBookmarks && (viewCount === 0 || ratio >= minBookmarkViewRatio)) {
                        return { ...illust, ...detail, bookmarkCount, viewCount, _webSource: false }
                    }
                }
            } catch { /* 单作品详情失败跳过 */ }
            return null
        }))

        qualifiedList.push(...batchResults.filter(Boolean))
    }

    if (qualifiedList.length === 0) return null

    qualifiedList.sort((a, b) => b.bookmarkCount - a.bookmarkCount)
    return qualifiedList
}

/**
 * 搜索 Pixiv 图片，返回最佳匹配作品的信息和图片链接
 * @param {string} tag 搜索标签
 * @param {boolean} isR18 是否搜索 R18 内容
 * @returns {Promise<{
 *   illust: object,        // 作品详情对象（含 id、title、user、tags、create_date、x_restrict 等）
 *   imageUrls: string[],   // 已应用反代的图片链接数组（最多3张）
 * } | null>} 未找到时返回 null
 */
export async function searchPixivImage(tag, isR18 = false) {
    const config = Setting.getConfig("pixiv")

    const qualifiedList = await randomSampleSearch(tag, isR18, config)
    if (!qualifiedList || qualifiedList.length === 0) return null

    let illust = qualifiedList[0]
    let pages = null

    // 如果来自 Web API，还没有原图 URL，需要补充详情
    if (illust._webSource) {
        const pixivCli = await getPixivClient()
        const detailRes = await pixivCli.illustDetail({ illustId: illust.id })
        if (detailRes?.status === 200 && detailRes.data?.illust) {
            const detail = detailRes.data.illust
            illust = { ...illust, ...detail, bookmarkCount: illust.bookmarkCount, viewCount: illust.viewCount }
            if (detail.meta_pages && detail.meta_pages.length > 0) {
                pages = detail.meta_pages.map(p => p.image_urls.original)
            } else if (detail.meta_single_page?.original_image_url) {
                pages = [detail.meta_single_page.original_image_url]
            }
        }
        if (!pages) return null
    } else {
        if (illust.meta_pages && illust.meta_pages.length > 0) {
            pages = illust.meta_pages.map(p => p.image_urls.original)
        } else {
            pages = [illust.meta_single_page.original_image_url]
        }
    }

    // 应用反代域名（最多取前3张）
    const proxy = config.proxy
    const imageUrls = pages.slice(0, 3).map(originalUrl => {
        if (!proxy) return originalUrl
        const u = new URL(originalUrl)
        u.hostname = proxy
        return u.href
    })

    return { illust, imageUrls }
}
