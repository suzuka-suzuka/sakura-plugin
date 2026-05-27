import puppeteer from "puppeteer"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const userDataDir = resolve(__dirname, "../../../data/bing")

const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 50
const cache = new Map()

function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, { value, ts: Date.now() })
}

function checkRelevance(query, results) {
  if (results.length < 3) return null
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  if (!terms.length) return null
  return results.every(r => !terms.some(t => (r.title + r.snippet).toLowerCase().includes(t))) ? true : null
}

async function getBrowser(e) {
  try {
    const renderer = e?.runtime?.puppeteer
    if (renderer?.browser) return renderer.browser
    if (renderer?.browserInit) return await renderer.browserInit()
  } catch {}
  return puppeteer.launch({
    headless: "new",
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  })
}

export class BingSearchTool {
  name = "BingSearch"
  description = "使用Bing搜索引擎搜索网页。相比于WebSearchTool信息的权威性更高但容易被反爬虫替换为不相关结果，若被替换请告知用户。技巧：精确字符串用英文引号包裹；限定站点用 site: 前缀。"

  parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      count: { type: "string", description: "返回条数（1-10，默认5）" },
    },
    required: ["query"],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts, e) => {
    const query = (opts.query || "").trim()
    if (!query) return "搜索失败：关键词不能为空"
    const count = Math.max(1, Math.min(parseInt(opts.count) || 5, 10))

    const cacheKey = `${query}|${count}`
    const cached = cacheGet(cacheKey)
    if (cached) return cached

    let page = null
    try {
      const browser = await getBrowser(e)
      page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setExtraHTTPHeaders({ "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" })
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false })
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] })
        Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] })
        window.chrome = { runtime: {} }
        const q = window.navigator.permissions.query
        window.navigator.permissions.query = (p) =>
          p.name === "notifications" ? Promise.resolve({ state: Notification.permission }) : q(p)
      })

      const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`
      await page.goto(searchUrl, { timeout: 15000, waitUntil: "networkidle2" })
      await page.waitForSelector("li.b_algo", { timeout: 10000 }).catch(() => {})

      const data = await page.evaluate((query) => {
        const title = document.title || ""
        const bodyText = document.body?.innerText?.slice(0, 3000) || ""
        if (/just a moment|attention required.*cloudflare/i.test(bodyText)) return { blocked: "Cloudflare 防护" }
        if (/captcha|滑动验证|人机验证/i.test(title)) return { blocked: "人机验证" }

        const altEl = document.querySelector("#sp_requery, #sp_query_correction")
        let alteration = null
        if (altEl) {
          const corrected = altEl.querySelector("strong")?.textContent?.trim()
          if (corrected && corrected.toLowerCase() !== query.toLowerCase()) {
            alteration = { corrected, original: query }
          }
        }
        const insteadEl = document.querySelector("#sp_recquery, .b_scopebar")
        if (insteadEl) {
          const orig = insteadEl.querySelector("strong, a")?.textContent?.trim()
          if (orig) alteration = alteration || { original: orig }
        }

        const dymEl = document.querySelector("#sp_dym, .b_dym_q_i")
        const didYouMean = dymEl?.querySelector("strong, a")?.textContent?.trim() || null

        const items = document.querySelectorAll("li.b_algo")
        const results = []
        for (const item of items) {
          const a = item.querySelector("h2 a")
          const p = item.querySelector("p")
          if (a) {
            results.push({
              title: a.textContent.trim(),
              url: a.href,
              snippet: p ? p.textContent.trim() : "",
            })
          }
        }
        return { alteration, didYouMean, results }
      }, query)

      if (data.blocked) return `搜索失败：Bing ${data.blocked}（页面为验证页）`

      const results = data.results.filter(r => r.title && r.url.startsWith("http"))

      let value
      if (results.length > 0) {
        const alt = data.alteration
        let prefix = ""
        if (alt?.corrected) {
          prefix = `Bing 已将"${alt.original}"自动纠错为"${alt.corrected}"，以下结果可能不相关：\n\n`
        } else if (alt?.original) {
          prefix = `Bing 可能已改为搜索"${alt.original}"，以下结果可能不匹配：\n\n`
        } else if (checkRelevance(query, results)) {
          prefix = `Bing 可能已将"${query}"自动纠错或替换，以下结果可能不匹配：\n\n`
        }
        const formatted = results.slice(0, count).map((r, i) =>
          `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`
        )
        value = prefix + formatted.join("\n\n")
      } else {
        const hint = data.didYouMean ? `\nBing 建议改为：${data.didYouMean}` : ""
        value = `未找到"${query}"的相关结果（可尝试加引号精确搜索或用 site: 限定站点）${hint}`
      }

      cacheSet(cacheKey, value)
      return value
    } catch (err) {
      if (err.name === "TimeoutError") return "搜索失败：浏览器导航超时（15秒）"
      return `搜索失败：${err.message}`
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }
}
