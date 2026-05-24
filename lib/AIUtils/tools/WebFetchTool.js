const cache = new Map()

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "DNT": "1",
}

function detectCharset(buf, contentType) {
  const ctMatch = contentType.match(/charset=([^;\s]+)/i)
  if (ctMatch) return ctMatch[1].trim().toLowerCase().replace(/["']/g, "")
  const head = new TextDecoder("ascii", { fatal: false }).decode(buf.slice(0, 2048))
  const m = head.match(/<meta[^>]+charset\s*=\s*["']?([^"'>\s;]+)/i)
  return m ? m[1].trim().toLowerCase() : "utf-8"
}

function detectAntiBot(html) {
  const sample = html.slice(0, 5000)
  if (/cf-ray|cf_chl_|just a moment|attention required.*cloudflare|enable javascript and cookies to continue/i.test(sample)) {
    return "Cloudflare 防护页"
  }
  if (/<title[^>]*>[^<]*(captcha|verify|robot|人机验证|滑动验证)/i.test(sample) || /please.*(verify|prove).*(human|robot)/i.test(sample)) {
    return "人机验证页"
  }
  if (/access denied|你的访问已被拒绝|疑似黑客攻击|当前访问异常|访问频繁/i.test(sample)) {
    return "访问拒绝页（疑似反爬）"
  }
  return null
}

export class WebFetchTool {
  name = "WebFetch"
  description = "访问网页提取正文。首次调用不传offset，若内容被截断，按返回提示传offset继续读取。"

  parameters = {
    type: "object",
    properties: {
      url: { type: "string", description: "网页URL，必须以 http:// 或 https:// 开头" },
      offset: { type: "string", description: "从第几个字符开始读取（截断后继续时使用）" },
    },
    required: ["url"],
  }

  function() {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }

  func = async (opts) => {
    const url = (opts.url || "").trim()
    if (!url) return "访问失败：URL 为空"
    if (!/^https?:\/\//i.test(url)) {
      return `访问失败：URL 必须以 http:// 或 https:// 开头，收到：${url.slice(0, 80)}`
    }

    let parsedUrl, hostname
    try {
      parsedUrl = new URL(url)
      hostname = parsedUrl.hostname
      if (!hostname) return `访问失败：URL 缺少域名 - ${url}`
    } catch {
      return `访问失败：URL 格式错误 - ${url}`
    }

    const chunkSize = 4000
    const offset = Math.max(0, parseInt(opts.offset) || 0)

    try {
      if (!cache.has(url)) {
        let res
        try {
          res = await fetch(url, {
            headers: {
              ...DEFAULT_HEADERS,
              "Referer": `${parsedUrl.protocol}//${hostname}/`,
            },
            signal: AbortSignal.timeout(15000),
            redirect: "follow",
          })
        } catch (fetchErr) {
          const code = fetchErr.cause?.code || fetchErr.code
          const name = fetchErr.name
          if (name === "TimeoutError" || name === "AbortError") {
            return `访问失败：请求超时（15秒，${hostname}），可能被反爬挑战拖延`
          }
          if (code === "ENOTFOUND") return `访问失败：域名解析失败（${hostname} 不存在或DNS异常）`
          if (code === "ECONNREFUSED") return `访问失败：${hostname} 拒绝连接`
          if (code === "ECONNRESET") return `访问失败：连接被对方重置（${hostname}）`
          if (code === "ETIMEDOUT") return `访问失败：连接超时（${hostname}）`
          if (code === "EHOSTUNREACH") return `访问失败：${hostname} 不可达（路由问题）`
          if (code === "CERT_HAS_EXPIRED") return `访问失败：${hostname} 的 SSL 证书已过期`
          if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
            return `访问失败：${hostname} 使用自签名证书`
          }
          if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
            return `访问失败：${hostname} 的 SSL 证书无法验证（CA 链问题）`
          }
          if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
            return `访问失败：${hostname} 的 SSL 证书域名不匹配`
          }
          return `访问失败：${name || "网络错误"} - ${fetchErr.message}`
        }

        if (!res.ok) {
          if (res.status === 403) return `访问失败：HTTP 403 Forbidden（${hostname} 拒绝访问，常见于反爬虫；可换搜索引擎缓存或镜像站）`
          if (res.status === 429) return `访问失败：HTTP 429 Too Many Requests（${hostname} 限流，稍后重试）`
          if (res.status === 503) return `访问失败：HTTP 503（${hostname} 服务不可用，可能是 Cloudflare 等防护层）`
          if (res.status === 401) return `访问失败：HTTP 401 Unauthorized（${hostname} 需要身份验证）`
          if (res.status === 451) return `访问失败：HTTP 451（${hostname} 因法律原因不可访问）`
          return `访问失败：HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}（${hostname}）`
        }

        const contentType = res.headers.get("content-type") || ""
        if (contentType && !/text\/(html|plain|xml)|application\/(xhtml|xml|json)/i.test(contentType)) {
          return `访问失败：不支持的内容类型 ${contentType}（仅支持 HTML/纯文本/XML/JSON）`
        }

        const buf = await res.arrayBuffer()
        if (!buf.byteLength) return `访问失败：${hostname} 返回空响应体`

        const charset = detectCharset(buf, contentType)
        let html
        try {
          html = new TextDecoder(charset, { fatal: false }).decode(buf)
        } catch {
          html = new TextDecoder("utf-8", { fatal: false }).decode(buf)
        }

        const antiBot = detectAntiBot(html)
        if (antiBot) {
          return `访问失败：${hostname} ${antiBot}（HTTP 200 但内容为验证页，需 JS/Cookie 挑战，本工具无法绕过；可尝试搜索引擎缓存）`
        }

        let text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#?\w+;/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n[ \t]+/g, "\n")
          .trim()

        if (!text) {
          return `访问失败：页面提取后内容为空（原始 ${html.length} 字节，charset=${charset}，可能是 JS 渲染页面或纯图片页）`
        }

        cache.set(url, text)
        setTimeout(() => cache.delete(url), 300000)
      }

      const fullText = cache.get(url)

      if (offset >= fullText.length) {
        return `已到达页面末尾。页面总长 ${fullText.length} 字符，传入 offset=${offset} 已超出范围`
      }

      const chunk = fullText.slice(offset, offset + chunkSize)
      const remain = fullText.length - offset - chunkSize

      if (remain > 0) {
        return `${chunk}\n\n--- 剩余约 ${remain} 字符，传 offset=${offset + chunkSize} 继续 ---`
      }
      return chunk
    } catch (err) {
      return `访问失败：${err.name || "Error"} - ${err.message}`
    }
  }
}
