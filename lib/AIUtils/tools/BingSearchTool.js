const cache = new Map()
const CACHE_TTL = 5 * 60 * 1000

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
}

const decodeHtml = (s) => s
  .replace(/&nbsp;/g, " ")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/gi, "'")
  .replace(/&#39;/g, "'")
  .replace(/&#?\w+;/g, "")

function detectBlock(html) {
  const sample = html.slice(0, 5000)
  if (/cf-ray|just a moment|attention required.*cloudflare/i.test(sample)) return "Cloudflare 防护"
  if (/<title[^>]*>[^<]*(captcha|滑动验证|人机验证)/i.test(sample)) return "人机验证"
  return null
}

function extractDidYouMean(html) {
  const m = html.match(/(?:Did you mean|你是不是要找|你要找的是不是)[^<]*<[^>]+>([\s\S]{1,200}?)<\//i)
  return m ? decodeHtml(m[1].replace(/<[^>]+>/g, "")).trim() : null
}

function detectAlteration(html, query) {
  const m = html.match(/(?:Showing results for|已改为搜索|改为搜索|Including results for)\s*<strong>([^<]+)<\/strong>/i)
  if (m) {
    const corrected = decodeHtml(m[1]).trim()
    if (corrected.toLowerCase() !== query.toLowerCase()) return { corrected, original: query }
  }
  const m2 = html.match(/(?:Search instead for|要不要搜|仍要搜索)\s*(?:<[^>]+>)*\s*(?:<strong>)?\s*([^<]{1,200}?)\s*(?:<\/strong>)?\s*(?:<[^>]+>)*/i)
  if (m2) return { original: decodeHtml(m2[1].replace(/<[^>]+>/g, "")).trim() }
  return null
}

function checkRelevance(query, results) {
  if (results.length < 3) return null
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  if (!terms.length) return null
  return results.every(r => !terms.some(t => r.toLowerCase().includes(t))) ? true : null
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

  func = async (opts) => {
    const query = (opts.query || "").trim()
    if (!query) return "搜索失败：关键词不能为空"
    const count = Math.max(1, Math.min(parseInt(opts.count) || 5, 10))

    const cacheKey = `${query}|${count}`
    const cached = cache.get(cacheKey)
    if (cached) {
      clearTimeout(cached.timer)
      cached.timer = setTimeout(() => cache.delete(cacheKey), CACHE_TTL)
      return cached.value
    }

    try {
      const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&sp=0`
      const res = await fetch(searchUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      })
      if (!res.ok) return `搜索失败：HTTP ${res.status}（Bing 可能限流或反爬）`
      const html = await res.text()

      const blocked = detectBlock(html)
      if (blocked) return `搜索失败：Bing ${blocked}（HTTP 200 但内容为验证页）`

      const items = html.match(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>[\s\S]*?<\/li>/gi) || []
      const results = []
      for (const item of items) {
        if (results.length >= count) break
        const titleM = item.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
        const snippetM = item.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
        if (!titleM) continue
        const url = decodeHtml(titleM[1])
        const title = decodeHtml(titleM[2].replace(/<[^>]+>/g, "")).trim()
        const snippet = decodeHtml((snippetM?.[1] || "").replace(/<[^>]+>/g, "")).trim()
        if (title && url.startsWith("http")) {
          results.push(`${results.length + 1}. ${title}\n   ${snippet}\n   ${url}`)
        }
      }

      let value
      if (results.length > 0) {
        const alt = detectAlteration(html, query)
        let prefix = ""
        if (alt?.corrected) {
          prefix = `Bing 已将"${alt.original}"自动纠错为"${alt.corrected}"，以下结果可能不相关：\n\n`
        } else if (alt?.original) {
          prefix = `Bing 可能已改为搜索"${alt.original}"，以下结果可能不匹配：\n\n`
        } else if (checkRelevance(query, results)) {
          prefix = `Bing 可能已将"${query}"自动纠错或替换，以下结果可能不匹配：\n\n`
        }
        value = prefix + results.join("\n\n")
      } else {
        const dym = extractDidYouMean(html)
        const hint = dym ? `\nBing 建议改为：${dym}` : ""
        value = `未找到"${query}"的相关结果（可尝试加引号精确搜索或用 site: 限定站点）${hint}`
      }

      const timer = setTimeout(() => cache.delete(cacheKey), CACHE_TTL)
      cache.set(cacheKey, { value, timer })
      return value
    } catch (err) {
      const code = err.cause?.code || err.code
      const name = err.name
      if (name === "TimeoutError" || name === "AbortError") return "搜索失败：请求超时（10秒，Bing 可能反爬挑战拖延）"
      if (code === "ENOTFOUND") return "搜索失败：域名解析失败（DNS 异常或 bing.com 被屏蔽）"
      if (code === "ECONNREFUSED") return "搜索失败：bing.com 拒绝连接"
      if (code === "ECONNRESET") return "搜索失败：连接被对方重置"
      if (code === "ETIMEDOUT") return "搜索失败：连接超时"
      return `搜索失败：${err.message}`
    }
  }
}
