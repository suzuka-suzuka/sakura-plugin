import { connect } from "puppeteer-real-browser"
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import axios from "axios"
import { plugindata } from "../path.js"

const GROK_API_ENDPOINT = "https://grok.com/rest/app-chat/conversations/new"
const GROK_CONVERSATION_RESPONSE_PATH = conversationId =>
  `/rest/app-chat/conversations/${encodeURIComponent(String(conversationId))}/responses`
const GROK_CONVERSATION_RESPONSE_ENDPOINT = conversationId =>
  `https://grok.com${GROK_CONVERSATION_RESPONSE_PATH(conversationId)}`
const GROK_IMAGINE_WS_ENDPOINT = "wss://grok.com/ws/imagine/listen"
const UPLOAD_ENDPOINT = "https://grok.com/rest/app-chat/upload-file"
const POST_CREATE_ENDPOINT = "https://grok.com/rest/media/post/create"
const POST_GET_ENDPOINT = "https://grok.com/rest/media/post/get"
const ASSET_BASE_URL = "https://assets.grok.com/"
const GROK_STATSIG_CHUNK_URL = "https://cdn.grok.com/_next/static/chunks/0en5lu63lw.44.js"
const DEFAULT_IMAGE_ASPECT_RATIO = "2:3"
const DEFAULT_IMAGE_COUNT = 4
const MEDIA_POST_TYPE_IMAGE = "MEDIA_POST_TYPE_IMAGE"
const MEDIA_POST_TYPE_VIDEO = "MEDIA_POST_TYPE_VIDEO"
const DEFAULT_VIDEO_MODE = "custom"
const DEFAULT_VIDEO_ASPECT_RATIO = "auto"
const DEFAULT_VIDEO_DURATION = 6
const DEFAULT_VIDEO_RESOLUTION = "720p"
const GROK_VIDEO_CHAT_MODEL = "imagine-video-gen"

const requestQueue = []
let isProcessing = false

const BROWSER_IDLE_CLOSE_DELAY_MS = 2 * 60 * 1000
let browserInstance = null
let pageInstance = null
let browserCloseTimeout = null
let browserClosingPromise = null
let hasWarnedStatsigFallback = false

const GROK_CONVERSATION_SESSION_TTL_MS = 5 * 60 * 1000
const grokConversationSessions = new Map()

const DEFAULT_GROK_MODEL = "auto"

const GROK_MODELS = {
  auto: {
    modelName: "auto",
    modelMode: "MODEL_MODE_AUTO",
    isVideoModel: false,
  },
  fast: {
    modelName: "fast",
    modelMode: "MODEL_MODE_FAST",
    isVideoModel: false,
  },
  expert: {
    modelName: "expert",
    modelMode: "MODEL_MODE_EXPERT",
    isVideoModel: false,
  },
  "grok-imagine-image": {
    modelName: "grok-imagine-image",
    modelMode: "MODEL_MODE_AUTO",
    isImageModel: true,
    isVideoModel: false,
  },
  "grok-imagine-video": {
    modelName: "grok-imagine-video",
    modelMode: DEFAULT_VIDEO_MODE,
    isVideoModel: true,
  },
}

const IMAGE_ASPECT_RATIO_MAP = {
  auto: DEFAULT_IMAGE_ASPECT_RATIO,
  "1280x720": "16:9",
  "16:9": "16:9",
  "720x1280": "9:16",
  "9:16": "9:16",
  "1792x1024": "3:2",
  "3:2": "3:2",
  "1024x1792": "2:3",
  "2:3": "2:3",
  "1024x1024": "1:1",
  "1:1": "1:1",
}

function generateRandomString(length, useLetters = true) {
  const letters = "abcdefghijklmnopqrstuvwxyz"
  const alphanumeric = "abcdefghijklmnopqrstuvwxyz0123456789"
  const charset = useLetters ? letters : alphanumeric

  let result = ""
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length))
  }
  return result
}

function generateStatsigId() {
  const formatType = Math.random() > 0.5 ? 1 : 2
  let errorMsg

  if (formatType === 1) {
    const randomStr = generateRandomString(5, false)
    errorMsg = `e:TypeError: Cannot read properties of null (reading 'children['${randomStr}']')`
  } else {
    const randomStr = generateRandomString(10, true)
    errorMsg = `e:TypeError: Cannot read properties of undefined (reading '${randomStr}')`
  }

  return Buffer.from(errorMsg).toString("base64")
}

function getDynamicHeaders(config, pathname = "/rest/app-chat/conversations/new") {
  const statsigId = config.dynamic_statsig
    ? generateStatsigId()
    : config.x_statsig_id || generateStatsigId()
  const isUpload = pathname.includes("upload-file")
  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex")

  const headers = {
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Content-Type": isUpload ? "text/plain;charset=UTF-8" : "application/json",
    Connection: "keep-alive",
    Origin: "https://grok.com",
    Priority: "u=1, i",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Baggage: "sentry-environment=production,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c",
    "x-statsig-id": statsigId,
    "x-xai-request-id": requestId,
  }

  return headers
}

function buildAuthCookie(config) {
  const rawToken = config.supersso || config.sso
  if (!rawToken) return ""

  const hasWritable = rawToken.includes("sso-rw=") || rawToken.includes("supersso-rw=")
  if (hasWritable) {
    return rawToken
  }

  const tokenMatch = rawToken.match(/(?:sso|supersso)=([^;]+)/)
  const jwt = tokenMatch ? tokenMatch[1] : rawToken
  return `sso-rw=${jwt};sso=${jwt}`
}

function buildCookieString(config) {
  const authCookie = buildAuthCookie(config)
  if (!authCookie) return ""

  if (!config.cf_clearance) {
    return authCookie
  }

  const clearance = config.cf_clearance.includes("cf_clearance=")
    ? config.cf_clearance
    : `cf_clearance=${config.cf_clearance}`
  return `${authCookie};${clearance}`
}

function extractCfClearanceTimestamp(value = "") {
  const match = String(value || "").match(/-(\d{10})-/)
  const timestamp = match ? Number(match[1]) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

async function currentCookieValue(page, host, cookieName) {
  try {
    const cookies = await page.cookies(host)
    return cookies.find(cookie => cookie.name === cookieName)?.value || ""
  } catch {
    return ""
  }
}

async function captureCfClearanceFromPage(page, config) {
  if (!page || !config) return ""

  const value = await currentCookieValue(page, "https://grok.com", "cf_clearance")
  if (!value) return ""

  config.cf_clearance = `cf_clearance=${value}`
  return value
}

function parseCookiePairs(cookieString) {
  return cookieString
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eqIndex = part.indexOf("=")
      if (eqIndex === -1) return null
      const name = part.slice(0, eqIndex).trim()
      const value = part.slice(eqIndex + 1).trim()
      if (!name || !value) return null
      return { name, value }
    })
    .filter(Boolean)
}

async function ensureBrowserCookies(
  page,
  config,
  hosts = ["https://grok.com", "https://assets.grok.com"],
) {
  const cookieString = buildCookieString(config)
  if (!cookieString) return

  const cookiePairs = []
  const entries = parseCookiePairs(cookieString)
  for (const host of hosts) {
    const hostname = new URL(host).hostname
    for (const { name, value } of entries) {
      if (name === "cf_clearance") {
        const currentValue = await currentCookieValue(page, host, name)
        const currentTimestamp = extractCfClearanceTimestamp(currentValue)
        const configuredTimestamp = extractCfClearanceTimestamp(value)

        if (
          currentValue &&
          (!configuredTimestamp || currentTimestamp >= configuredTimestamp)
        ) {
          continue
        }
      }

      cookiePairs.push({
        name,
        value,
        url: host,
        domain: `.${hostname.replace(/^\./, "")}`,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "None",
      })
    }
  }

  if (cookiePairs.length > 0) {
    await page.setCookie(...cookiePairs)
  }
}

function resolveAssetUrl(url) {
  if (!url) return ""
  if (url.startsWith("http")) {
    return url
  }
  const cleanedPath = url.replace(/^\/+/, "")
  return `${ASSET_BASE_URL}${cleanedPath}`
}

function parseCardAttachmentJson(jsonData) {
  if (!jsonData) return null
  if (typeof jsonData === "object") return jsonData

  try {
    return JSON.parse(jsonData)
  } catch {
    return null
  }
}

function collectCardImageUrls(cardData, urlsByCardId = new Map()) {
  if (!cardData) return Array.from(urlsByCardId.values())

  if (Array.isArray(cardData)) {
    for (const item of cardData) {
      collectCardImageUrls(parseCardAttachmentJson(item), urlsByCardId)
    }
    return Array.from(urlsByCardId.values())
  }

  const imageChunk = cardData.image_chunk || cardData.imageChunk
  const imageUrl = imageChunk?.imageUrl || imageChunk?.image_url || cardData.imageUrl
  if (imageUrl) {
    const cardId = cardData.id || cardData.card_id || imageChunk?.imageUuid || imageUrl
    urlsByCardId.set(cardId, imageUrl)
  }

  return Array.from(urlsByCardId.values())
}

function resolveImageAspectRatio(value) {
  const text = String(value || "").trim().toLowerCase()
  return IMAGE_ASPECT_RATIO_MAP[text] || DEFAULT_IMAGE_ASPECT_RATIO
}

function parseGrokImageOptions(input = "") {
  const tokens = String(input || "").trim().split(/\s+/).filter(Boolean)
  const promptParts = []
  let aspectRatio = DEFAULT_IMAGE_ASPECT_RATIO
  let enablePro = false
  let count = DEFAULT_IMAGE_COUNT

  for (const token of tokens) {
    const lower = token.trim().toLowerCase()
    if (!lower) continue

    if (IMAGE_ASPECT_RATIO_MAP[lower]) {
      aspectRatio = resolveImageAspectRatio(lower)
      continue
    }

    if (lower === "pro" || lower === "quality" || lower === "hd") {
      enablePro = true
      continue
    }

    if (lower === "fast" || lower === "speed") {
      enablePro = false
      continue
    }

    const countMatch = lower.match(/^(?:n=|count=)([1-6])$/) ||
      lower.match(/^([1-6])(?:张|枚|images?|pics?)$/)
    if (countMatch) {
      count = Math.max(1, Math.min(6, Number(countMatch[1])))
      continue
    }

    promptParts.push(token)
  }

  return {
    prompt: promptParts.join(" ").trim(),
    aspectRatio,
    enablePro,
    count,
  }
}

function normalizeVideoDuration(sec) {
  if (!sec || Number.isNaN(Number(sec))) {
    return DEFAULT_VIDEO_DURATION
  }
  const value = Number(sec)
  if (value <= 6) return 6
  return 10
}

function normalizeVideoResolution(value) {
  const text = String(value || "").trim().toLowerCase()
  if (text === "480p" || text === "sd" || text === "low") {
    return "480p"
  }
  if (text === "720p" || text === "draft" || text === "standard") {
    return "720p"
  }
  return DEFAULT_VIDEO_RESOLUTION
}

function normalizeVideoAspectRatio(value) {
  const text = String(value || "").trim().toLowerCase()
  if (text === "auto") {
    return "auto"
  }
  if (text === "9:16" || text === "1:1" || text === "16:9") {
    return text
  }
  return DEFAULT_VIDEO_ASPECT_RATIO
}

function normalizeVideoMode(value, fallback = DEFAULT_VIDEO_MODE) {
  const text = String(value || "").trim().toLowerCase()
  if (!text) return fallback
  if (text === "custom" || text === "normal" || text === "extremely-spicy-or-crazy") {
    return text
  }
  return fallback
}

function parseGrokVideoOptions(input = "") {
  const raw = String(input || "").trim()
  if (!raw) {
    return {
      prompt: "",
      aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
      quality: "",
      durationSec: DEFAULT_VIDEO_DURATION,
      size: "",
      resolution: DEFAULT_VIDEO_RESOLUTION,
    }
  }

  const tokens = raw.split(/\s+/)
  const promptParts = []
  let aspectRatio = DEFAULT_VIDEO_ASPECT_RATIO
  let quality = ""
  let durationSec = DEFAULT_VIDEO_DURATION
  let resolution = DEFAULT_VIDEO_RESOLUTION
  let size = ""

  for (const token of tokens) {
    const cleaned = token.trim()
    if (!cleaned) continue

    const lower = cleaned.toLowerCase()
    if (/^(auto|16:9|9:16|1:1)$/.test(lower)) {
      aspectRatio = lower
      continue
    }
    if (/^(480p|720p|sd|low|draft|standard)$/.test(lower)) {
      quality = lower
      resolution = normalizeVideoResolution(lower)
      continue
    }
    if (/^(6|10)(s|sec|secs|second|seconds|\u79d2)?$/i.test(cleaned)) {
      durationSec = normalizeVideoDuration(parseInt(cleaned, 10))
      continue
    }
    if (/^(480x854|854x480|480x480|720x1280|720x720|1280x720)$/.test(lower)) {
      size = lower
      if (lower === "480x854" || lower === "720x1280") {
        aspectRatio = "9:16"
      } else if (lower === "480x480" || lower === "720x720") {
        aspectRatio = "1:1"
      } else {
        aspectRatio = "16:9"
      }
      resolution = normalizeVideoResolution(
        lower.includes("720") || lower.includes("1280")
          ? "720p"
          : "480p"
      )
      quality = resolution
      continue
    }
    promptParts.push(cleaned)
  }

  return {
    prompt: promptParts.join(" ").trim(),
    aspectRatio,
    quality,
    durationSec,
    size,
    resolution,
  }
}

function firstStringByKey(value, key) {
  if (!value || !key) return ""

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringByKey(item, key)
      if (found) return found
    }
    return ""
  }

  if (typeof value !== "object") return ""

  const direct = value[key]
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim()
  }

  for (const child of Object.values(value)) {
    const found = firstStringByKey(child, key)
    if (found) return found
  }

  return ""
}

function firstStringByKeys(value, keys) {
  for (const key of keys) {
    const found = firstStringByKey(value, key)
    if (found) return found
  }
  return ""
}

function isVideoUrlCandidate(raw) {
  const value = String(raw || "").trim()
  if (!value) return false
  const lower = value.toLowerCase()
  if (
    lower.includes("preview_image") ||
    lower.includes("thumbnail") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp")
  ) {
    return false
  }
  return (
    lower.includes(".mp4") ||
    lower.includes(".webm") ||
    lower.includes("generated_video") ||
    lower.includes("/video/")
  )
}

function derivePreviewImageUrl(videoUrl) {
  const value = String(videoUrl || "").trim()
  if (!value) return ""
  const lower = value.toLowerCase()
  for (const marker of ["/generated_video.mp4", "/generated_video.webm", "/generated_video"]) {
    const idx = lower.lastIndexOf(marker)
    if (idx >= 0) {
      return `${value.slice(0, idx)}/preview_image.jpg`
    }
  }
  if (lower.endsWith(".mp4") || lower.endsWith(".webm")) {
    const idx = value.lastIndexOf("/")
    if (idx >= 0) {
      return `${value.slice(0, idx)}/preview_image.jpg`
    }
  }
  return ""
}

function extractUuid(raw) {
  const value = String(raw || "")
  const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return match ? match[match.length - 1] : ""
}

function extractAssetIdFromUrl(raw) {
  const value = String(raw || "")
  const parts = value.split("/")
  for (let i = parts.length - 1; i >= 0; i--) {
    const match = parts[i].match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    if (match) return match[0]
  }
  return ""
}

function collectVideoArtifacts(value, out = { videoUrl: "", thumbUrl: "", videoPostId: "" }) {
  if (!value) return out

  if (Array.isArray(value)) {
    for (const item of value) {
      collectVideoArtifacts(item, out)
    }
    return out
  }

  if (typeof value !== "object") {
    if (!out.videoUrl && isVideoUrlCandidate(value)) {
      out.videoUrl = resolveAssetUrl(value)
    }
    return out
  }

  if (!out.videoPostId) {
    out.videoPostId = firstStringByKeys(value, [
      "videoPostId",
      "video_post_id",
      "assetId",
      "asset_id",
      "videoId",
      "video_id",
      "postId",
      "post_id",
      "mediaPostId",
    ])
  }

  if (!out.thumbUrl) {
    const thumb = firstStringByKeys(value, ["thumbnailImageUrl", "thumbnailUrl", "coverUrl"])
    if (thumb) {
      out.thumbUrl = resolveAssetUrl(thumb)
    }
  }

  if (!out.videoUrl) {
    const direct = firstStringByKeys(value, ["videoUrl", "videoURL", "video_url", "mediaUrl", "result_url"])
    if (direct && isVideoUrlCandidate(direct)) {
      out.videoUrl = resolveAssetUrl(direct)
    }
  }

  for (const child of Object.values(value)) {
    collectVideoArtifacts(child, out)
  }

  return out
}

function defaultVideoSizeForResolution(resolution, aspectRatio = "16:9") {
  const ratio = normalizeVideoAspectRatio(aspectRatio)
  if (resolution === "480p") {
    if (ratio === "9:16") return "480x854"
    if (ratio === "1:1") return "480x480"
    return "854x480"
  }
  if (ratio === "9:16") return "720x1280"
  if (ratio === "1:1") return "720x720"
  return "1280x720"
}

function videoConfig(size, aspect, quality) {
  let resolvedAspect = normalizeVideoAspectRatio(aspect)
  let resolvedResolution = normalizeVideoResolution(quality)
  let resolvedSize = String(size || "").trim()
  if (!resolvedSize) {
    resolvedSize = defaultVideoSizeForResolution(resolvedResolution)
  }

  if (resolvedAspect === "auto") {
    const fallbackSize = defaultVideoSizeForResolution(resolvedResolution)
    const fallbackParts = fallbackSize.split("x").map(v => parseInt(v, 10))
    const fallbackWidth = Number.isFinite(fallbackParts[0]) ? fallbackParts[0] : 1280
    const fallbackHeight = Number.isFinite(fallbackParts[1]) ? fallbackParts[1] : 720
    const parts = resolvedSize.split("x").map(v => parseInt(v, 10))
    const width = Number.isFinite(parts[0]) ? parts[0] : fallbackWidth
    const height = Number.isFinite(parts[1]) ? parts[1] : fallbackHeight
    return {
      aspectRatio: "auto",
      resolutionName: resolvedResolution,
      width,
      height,
      size: resolvedSize || `${width}x${height}`,
    }
  }

  if (!resolvedAspect) {
    switch (resolvedSize) {
      case "480x854":
      case "720x1280":
        resolvedAspect = "9:16"
        break
      case "480x480":
      case "720x720":
        resolvedAspect = "1:1"
        break
      case "854x480":
      case "1280x720":
      default:
        resolvedAspect = "16:9"
        break
    }
  }

  if (resolvedAspect === "9:16") {
    if (resolvedResolution === "480p") {
      resolvedSize = "480x854"
    } else {
      resolvedSize = "720x1280"
      resolvedResolution = "720p"
    }
  } else if (resolvedAspect === "1:1") {
    if (resolvedResolution === "480p") {
      resolvedSize = "480x480"
    } else {
      resolvedSize = "720x720"
      resolvedResolution = "720p"
    }
  } else {
    if (resolvedResolution === "480p") {
      resolvedSize = "854x480"
    } else {
      resolvedSize = "1280x720"
      resolvedResolution = "720p"
    }
  }

  const parts = resolvedSize.split("x").map(v => parseInt(v, 10))
  const width = Number.isFinite(parts[0]) ? parts[0] : 1280
  const height = Number.isFinite(parts[1]) ? parts[1] : 720

  return {
    aspectRatio: resolvedAspect,
    resolutionName: resolvedResolution,
    width,
    height,
    size: resolvedSize,
  }
}

function stripGrokRenderBlocks(message = "") {
  return message.replace(/<grok:render\b[\s\S]*?<\/grok:render>/g, "").trim()
}

async function initBrowser() {
  if (browserCloseTimeout) {
    clearTimeout(browserCloseTimeout)
    browserCloseTimeout = null
  }

  if (browserClosingPromise) {
    await browserClosingPromise
  }

  if (
    browserInstance &&
    pageInstance &&
    !(typeof pageInstance.isClosed === "function" && pageInstance.isClosed()) &&
    !(typeof browserInstance.isConnected === "function" && !browserInstance.isConnected())
  ) {
    return { browser: browserInstance, page: pageInstance }
  }

  browserInstance = null
  pageInstance = null

  const isLinux = process.platform === "linux"

  const { browser, page } = await connect({
    headless: "auto",
    args: isLinux ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] : [],
    turnstile: true,
    connectOption: {
      defaultViewport: null,
    },
    disableXvfb: false,
    ignoreAllFlags: false,
    ...(isLinux && {
      xvfbsession: true,
    }),
  })

  browserInstance = browser
  pageInstance = page

  return { browser, page }
}

async function closeCurrentBrowser(reason = "", logLevel = "warn") {
  if (browserClosingPromise) {
    await browserClosingPromise
    return
  }

  const browser = browserInstance
  browserInstance = null
  pageInstance = null

  if (!browser) return

  browserClosingPromise = (async () => {
    try {
      await browser.close()
    } catch (error) {
      const message = reason
        ? `[Grok] ${reason}: ${error.message}`
        : `[Grok] close browser failed: ${error.message}`
      if (logLevel === "error") {
        logger.error(message)
      } else {
        logger.warn(message)
      }
    } finally {
      browserClosingPromise = null
    }
  })()

  await browserClosingPromise
}

export async function closeBrowser() {
  if (browserCloseTimeout) {
    clearTimeout(browserCloseTimeout)
  }

  browserCloseTimeout = setTimeout(async () => {
    browserCloseTimeout = null
    await closeCurrentBrowser("关闭浏览器失败", "error")
  }, BROWSER_IDLE_CLOSE_DELAY_MS)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isPageNavigationError(error) {
  const message = String(error?.message || error || "").toLowerCase()
  return (
    message.includes("execution context was destroyed") ||
    message.includes("most likely because of a navigation") ||
    message.includes("cannot find context with specified id") ||
    message.includes("target closed") ||
    message.includes("session closed")
  )
}

async function resetBrowserInstance(reason = "") {
  if (browserCloseTimeout) {
    clearTimeout(browserCloseTimeout)
    browserCloseTimeout = null
  }

  await closeCurrentBrowser(
    `close stale browser failed${reason ? ` (${reason})` : ""}`,
    "warn",
  )
}

async function waitForPageStable(page) {
  try {
    await page.waitForFunction(
      () => document.readyState === "interactive" || document.readyState === "complete",
      { timeout: 10000 },
    )
  } catch { }
  await sleep(1000)
}

async function waitForCloudflareClearance(page, timeoutMs = 45000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const status = await page
      .evaluate(() => {
        const title = document.title || ""
        const bodyText = document.body?.innerText || ""
        const html = document.documentElement?.innerHTML || ""
        const text = `${title}
${bodyText}
${html.slice(0, 4096)}`.toLowerCase()
        return {
          title,
          blocked:
            text.includes("just a moment") ||
            text.includes("checking your browser") ||
            text.includes("cf-chl") ||
            text.includes("challenge-platform") ||
            text.includes("turnstile") ||
            text.includes("cloudflare"),
        }
      })
      .catch(() => ({ title: "", blocked: false }))

    if (!status.blocked) {
      return true
    }

    await sleep(1500)
  }

  return false
}

async function refreshGrokPageForAntiBot(page, config, reason = "") {
  const label = reason ? ` (${reason})` : ""

  try {
    await ensureBrowserCookies(page, config)
    await page.goto(`https://grok.com/?sakura_cf_refresh=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    await waitForPageStable(page)
    const cleared = await waitForCloudflareClearance(page)
    await captureCfClearanceFromPage(page, config)

    if (!cleared) {
      logger.warn(`[Grok] Cloudflare challenge 未在等待时间内结束${label}`)
    }
  } catch (error) {
    logger.warn(`[Grok] 刷新 Grok 页面失败${label}: ${error.message}`)
  }

  return page
}

async function prepareGrokPage(config, { forceNew = false, reason = "" } = {}) {
  if (forceNew) {
    await resetBrowserInstance(reason)
  }

  const { page } = await initBrowser()
  await ensureBrowserCookies(page, config)

  if (!page.url().includes("grok.com")) {
    await page.goto("https://grok.com", { waitUntil: "domcontentloaded", timeout: 60000 })
  }

  await waitForPageStable(page)
  await waitForCloudflareClearance(page, 15000)
  await captureCfClearanceFromPage(page, config)
  return page
}

function createRequestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex")
}

async function fetchJsonOnGrokPage(
  page,
  config,
  {
    url,
    pathname,
    body,
    method = "POST",
    referer = "",
    useNativeHeaders = true,
  } = {},
) {
  const cleanPathname = pathname || new URL(url).pathname
  const requestId = createRequestId()
  const browserStatsigId = await generateBrowserStatsigId(page, cleanPathname, method)
  const isUpload = cleanPathname.includes("upload-file")
  const headers = useNativeHeaders
    ? {
        Accept: "application/json, */*",
        "Content-Type": isUpload ? "text/plain;charset=UTF-8" : "application/json",
        ...(browserStatsigId ? { "x-statsig-id": browserStatsigId } : {}),
        "x-xai-request-id": requestId,
      }
    : {
        ...getDynamicHeaders(config, cleanPathname),
        Accept: "application/json, */*",
        ...(browserStatsigId ? { "x-statsig-id": browserStatsigId } : {}),
        ...(referer ? { Referer: referer } : {}),
      }

  return await page.evaluate(
    async ({ url, method, headers, body, referrer }) => {
      const init = {
        method,
        headers,
        credentials: "include",
      }

      if (body !== undefined) {
        init.body = JSON.stringify(body)
      }
      if (referrer) {
        init.referrer = referrer
      }

      const response = await fetch(url, init)
      const text = await response.text()
      if (!response.ok) {
        const cfInfo = [
          response.headers.get("cf-mitigated"),
          response.headers.get("cf-ray"),
        ]
          .filter(Boolean)
          .join(" ")
        const prefix = cfInfo ? ` ${cfInfo}:` : ""
        throw new Error(`HTTP ${response.status}:${prefix} ${text.substring(0, 300)}`)
      }

      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`invalid JSON response: ${text.substring(0, 240)}`)
      }
    },
    { url, method, headers, body, referrer: referer },
  )
}

async function fetchJsonWithAntiBotRetry(
  page,
  config,
  fetchOptions,
  { label = "请求", attempts = 3, preferNativeHeaders = true } = {},
) {
  let activePage = page
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const modes = preferNativeHeaders ? [true, false] : [false, true]
    let antiBotHit = false

    for (const useNativeHeaders of modes) {
      try {
        const payload = await fetchJsonOnGrokPage(activePage, config, {
          ...fetchOptions,
          useNativeHeaders,
        })
        return { payload, page: activePage }
      } catch (error) {
        lastError = error
        if (isAntiBotRejection(error)) {
          antiBotHit = true
          continue
        }
      }
    }

    if (antiBotHit && attempt < attempts - 1) {
      logger.warn(`[Grok] ${label}触发 Cloudflare challenge，刷新页面后重试`)
      activePage = await refreshGrokPageForAntiBot(activePage, config, label)
      continue
    }

    break
  }

  throw lastError || new Error(`${label} failed`)
}

async function uploadImage(page, imageInput, config) {
  try {
    let imageBuffer, mimeType, fileName

    if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
      const response = await axios.get(imageInput, { responseType: "arraybuffer" })
      const buffer = Buffer.from(response.data)
      imageBuffer = buffer.toString("base64")
      mimeType = response.headers["content-type"] || "image/jpeg"
      fileName = `image_${Date.now()}.${mimeType.split("/")[1] || "jpg"}`
    } else {
      imageBuffer = imageInput.includes("data:image") ? imageInput.split(",")[1] : imageInput

      if (imageInput.includes("data:image")) {
        const match = imageInput.match(/data:image\/(\w+)/)
        if (match) {
          mimeType = `image/${match[1]}`
          fileName = `image_${Date.now()}.${match[1]}`
        }
      } else {
        mimeType = "image/jpeg"
        fileName = `image_${Date.now()}.jpg`
      }
    }

    const uploadData = {
      fileName,
      fileMimeType: mimeType,
      content: imageBuffer,
    }

    const { payload: result } = await fetchJsonWithAntiBotRetry(
      page,
      config,
      {
        url: UPLOAD_ENDPOINT,
        pathname: "/rest/app-chat/upload-file",
        body: uploadData,
        referer: "https://grok.com/imagine",
      },
      { label: "上传图片", preferNativeHeaders: true },
    )

    if (result) {
      const fileId = result.fileMetadataId || ""
      const fileUri = result.fileUri || ""
      return { fileId, fileUri }
    }

    return { fileId: "", fileUri: "" }
  } catch (error) {
    logger.warn(`[Grok] 上传图片失败: ${error.message}`)
    return { fileId: "", fileUri: "" }
  }
}

async function uploadImages(page, imageUrls, config) {
  const fileIds = []
  const fileUris = []

  for (const url of imageUrls) {
    const result = await uploadImage(page, url, config)
    if (result.fileId) {
      fileIds.push(result.fileId)
      fileUris.push(result.fileUri)
    }
  }

  return { fileIds, fileUris }
}

async function createMediaPost(page, config, { mediaType, mediaUrl = "", prompt = "" } = {}) {
  try {
    if (!mediaType) {
      return null
    }
    const normalizedMediaUrl = resolveAssetUrl(mediaUrl)
    const payloadCandidates = [
      {
        mediaType,
        prompt,
        ...(normalizedMediaUrl ? { mediaUrl: normalizedMediaUrl } : {}),
      },
      {
        media_type: mediaType,
        prompt,
        ...(normalizedMediaUrl ? { media_url: normalizedMediaUrl } : {}),
      },
    ]
    let lastError = null

    for (const payload of payloadCandidates) {
      try {
        const { payload: result } = await fetchJsonWithAntiBotRetry(
          page,
          config,
          {
            url: POST_CREATE_ENDPOINT,
            pathname: "/rest/media/post/create",
            body: payload,
            referer: "https://grok.com/imagine",
          },
          { label: "创建媒体帖子", preferNativeHeaders: true },
        )

        const postId =
          result?.post?.id ||
          result?.postId ||
          result?.mediaPostId ||
          firstStringByKeys(result, ["postId", "mediaPostId", "id"])
        if (postId) {
          return postId
        }
        lastError = new Error(`missing post id: ${JSON.stringify(result).slice(0, 240)}`)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error("创建 Grok 媒体帖子失败")
  } catch (error) {
    logger.warn(`[Grok] 创建媒体帖子失败: ${error.message}`)
    return null
  }
}

function buildPayload(content, modelName, modelMode, fileIds, temporary, isVideoModel) {
  if (isVideoModel) {
    return buildVideoPayload({
      message: content,
      fileAttachments: fileIds,
      modelName: GROK_VIDEO_CHAT_MODEL,
      parentPostId: "",
      aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
      durationSec: DEFAULT_VIDEO_DURATION,
      resolutionName: DEFAULT_VIDEO_RESOLUTION,
      originalPrompt: content,
    })
  }

  return {
    temporary: temporary !== false,
    modelName: modelName || DEFAULT_GROK_MODEL,
    message: content,
    fileAttachments: fileIds,
    imageAttachments: [],
    disableSearch: false,
    enableImageGeneration: true,
    returnImageBytes: false,
    returnRawGrokInXaiRequest: false,
    enableImageStreaming: true,
    imageGenerationCount: 4,
    forceConcise: false,
    toolOverrides: {},
    enableSideBySide: true,
    sendFinalMetadata: true,
    isReasoning: false,
    webpageUrls: [],
    disableTextFollowUps: true,
    responseMetadata: {
      requestModelDetails: {
        modelId: modelName || DEFAULT_GROK_MODEL,
      },
    },
    disableMemory: false,
    forceSideBySide: false,
    modelMode: modelMode || "default",
    isAsyncChat: false,
  }
}

function buildContinuationPayload(content, modelName, modelMode, fileIds, parentResponseId) {
  const payload = buildPayload(content, modelName, modelMode, fileIds, false, false)
  delete payload.temporary
  payload.parentResponseId = parentResponseId
  payload.skipResponseCache = true
  payload.skipCancelCurrentInflightRequests = true
  return payload
}

function buildVideoPayload({
  message,
  fileAttachments = [],
  modelName = GROK_VIDEO_CHAT_MODEL,
  parentPostId = "",
  aspectRatio = DEFAULT_VIDEO_ASPECT_RATIO,
  durationSec = DEFAULT_VIDEO_DURATION,
  resolutionName = DEFAULT_VIDEO_RESOLUTION,
  originalPrompt = "",
  imageReferences = [],
  isReferenceToVideo = false,
}) {
  const videoGenModelConfig = {
    parentPostId,
    aspectRatio: aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO,
    videoLength: durationSec,
    isVideoEdit: false,
    resolutionName,
    isReferenceToVideo: isReferenceToVideo || imageReferences.length > 0,
  }

  if (originalPrompt) {
    videoGenModelConfig.originalPrompt = originalPrompt
  }

  if (imageReferences.length > 0) {
    videoGenModelConfig.imageReferences = imageReferences
  }

  return {
    ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
    modelName,
    temporary: true,
    message,
    responseMetadata: {
      experiments: [],
      modelConfigOverride: {
        modelMap: {
          videoGenModelConfig,
        },
      },
    },
    enableSideBySide: true,
  }
}

async function downloadMedia(page, url, savePath, type = "image", config = {}) {
  const resolvedUrl = resolveAssetUrl(url)
  if (!resolvedUrl) {
    logger.error(`[Grok] ${type} 无效地址，跳过: ${url}`)
    return null
  }

  try {
    const base64Data = await page.evaluate(
      async (targetUrl, timeout) => {
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeout)

        try {
          const response = await fetch(targetUrl, {
            signal: controller.signal,
            credentials: "include",
            headers: {
              Referer: "https://grok.com/",
              Origin: "https://grok.com",
            },
          })
          clearTimeout(id)

          if (!response.ok) throw new Error(`HTTP ${response.status}`)

          const blob = await response.blob()
          return await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
        } catch (e) {
          throw e
        }
      },
      resolvedUrl,
      type === "video" ? 180000 : 60000,
    )

    if (!base64Data) throw new Error("未获取到数据")

    const buffer = Buffer.from(base64Data.split(",")[1], "base64")
    await fs.mkdir(path.dirname(savePath), { recursive: true })
    await fs.writeFile(savePath, buffer)

    return savePath
  } catch (error) {
    logger.error(`[Grok] 下载失败: ${error.message}`)
    return null
  }
}

function getImageExtension(url = "") {
  const cleanUrl = String(url || "").split("?")[0].toLowerCase()
  const match = cleanUrl.match(/\.(png|jpe?g|webp)$/)
  if (!match) return "jpg"
  return match[1] === "jpeg" ? "jpg" : match[1]
}

async function saveBase64Media(base64Data, savePath) {
  if (!base64Data) return null

  const raw = String(base64Data)
  const body = raw.includes(",") ? raw.split(",").pop() : raw
  if (!body) return null

  const buffer = Buffer.from(body, "base64")
  if (buffer.length === 0) return null

  await fs.mkdir(path.dirname(savePath), { recursive: true })
  await fs.writeFile(savePath, buffer)
  return savePath
}

function normalizeSessionPart(value) {
  return encodeURIComponent(String(value ?? ""))
}

export function buildGrokConversationSessionKey(e, channelName = "", profileKey = "") {
  const scopeType = e?.group_id ? "group" : "private"
  const scopeId = e?.group_id ? e.group_id : "private"
  const botId = e?.self_id ?? "default"
  const userId = e?.user_id ?? "unknown"

  return [
    "grok",
    botId,
    scopeType,
    scopeId,
    userId,
    channelName || "default",
    profileKey || "default",
  ]
    .map(normalizeSessionPart)
    .join(":")
}

function getGrokConversationScopePrefix(e) {
  const scopeType = e?.group_id ? "group" : "private"
  const scopeId = e?.group_id ? e.group_id : "private"
  const botId = e?.self_id ?? "default"
  const userId = e?.user_id ?? "unknown"
  return ["grok", botId, scopeType, scopeId, userId].map(normalizeSessionPart).join(":") + ":"
}

function clearGrokConversationSessionTimer(session) {
  if (session?.timer) {
    clearTimeout(session.timer)
  }
}

function pruneExpiredGrokConversationSession(key, session) {
  if (!session) return null
  if (session.expiresAt && Date.now() > session.expiresAt) {
    clearGrokConversationSessionTimer(session)
    grokConversationSessions.delete(key)
    return null
  }
  return session
}

function getGrokConversationSession(key) {
  if (!key) return null
  const session = grokConversationSessions.get(key)
  return pruneExpiredGrokConversationSession(key, session)
}

function setGrokConversationSession(key, data = {}) {
  if (!key) return null

  const now = Date.now()
  const existing = getGrokConversationSession(key)
  if (existing) {
    clearGrokConversationSessionTimer(existing)
  }

  const session = {
    ...(existing || {}),
    ...data,
    key,
    updatedAt: now,
    expiresAt: now + GROK_CONVERSATION_SESSION_TTL_MS,
  }

  session.timer = setTimeout(() => {
    const current = grokConversationSessions.get(key)
    if (current === session) {
      grokConversationSessions.delete(key)
    }
  }, GROK_CONVERSATION_SESSION_TTL_MS)
  session.timer.unref?.()

  grokConversationSessions.set(key, session)
  return session
}

export function clearGrokConversationSession(key) {
  const session = grokConversationSessions.get(key)
  if (!session) return false
  clearGrokConversationSessionTimer(session)
  grokConversationSessions.delete(key)
  return true
}

export function clearGrokConversationSessionsForEvent(e) {
  const prefix = getGrokConversationScopePrefix(e)
  let cleared = 0

  for (const key of [...grokConversationSessions.keys()]) {
    if (!key.startsWith(prefix)) continue
    if (clearGrokConversationSession(key)) {
      cleared++
    }
  }

  return cleared
}

export function clearAllGrokConversationSessions() {
  let cleared = 0
  for (const [key, session] of grokConversationSessions.entries()) {
    clearGrokConversationSessionTimer(session)
    grokConversationSessions.delete(key)
    cleared++
  }
  return cleared
}

async function generateImagesViaImagineWs(page, options, config) {
  const prompt = String(options.prompt || "").trim()
  if (!prompt) {
    throw new Error("图片提示词不能为空")
  }

  const aspectRatio = resolveImageAspectRatio(options.aspectRatio)
  const count = Math.max(1, Math.min(6, Number(options.count || DEFAULT_IMAGE_COUNT)))
  const enableNsfw = options.enableNsfw !== false
  const enablePro = Boolean(options.enablePro)
  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex")

  const runImagineWs = async activePage => await activePage.evaluate(
    async ({ wsUrl, requestId, prompt, aspectRatio, count, enableNsfw, enablePro }) => {
      const readMessageData = async data => {
        if (typeof data === "string") return data
        if (data instanceof Blob) return await data.text()
        if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
        return ""
      }

      const parseImageId = url => {
        const match = String(url || "").match(/\/images\/([a-f0-9-]+)\.(png|jpg|jpeg|webp)/i)
        if (match) return match[1]
        return ""
      }

      const resetMessage = {
        type: "conversation.item.create",
        timestamp: Date.now(),
        item: {
          type: "message",
          content: [{ type: "reset" }],
        },
      }

      const requestMessage = {
        type: "conversation.item.create",
        timestamp: Date.now(),
        item: {
          type: "message",
          content: [{
            requestId,
            text: prompt,
            type: "input_text",
            properties: {
              section_count: 0,
              is_kids_mode: false,
              enable_nsfw: enableNsfw,
              skip_upsampler: false,
              enable_side_by_side: true,
              is_initial: false,
              aspect_ratio: aspectRatio,
              enable_pro: enablePro,
            },
          }],
        },
      }

      return await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        const slots = new Map()
        const finalImages = []
        let settled = false

        const finish = () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            ws.close(1000, "done")
          } catch { }
          finalImages.sort((a, b) => (a.order || 0) - (b.order || 0))
          resolve(finalImages.slice(0, count))
        }

        const fail = error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            ws.close(1000, "error")
          } catch { }
          reject(error)
        }

        const timer = setTimeout(() => {
          if (finalImages.length > 0) {
            finish()
          } else {
            fail(new Error("Imagine WebSocket timeout"))
          }
        }, 180000)

        ws.onopen = () => {
          ws.send(JSON.stringify(resetMessage))
          ws.send(JSON.stringify(requestMessage))
        }

        ws.onerror = () => {
          fail(new Error("Imagine WebSocket error"))
        }

        ws.onclose = () => {
          if (!settled) {
            if (finalImages.length > 0) {
              finish()
            } else {
              fail(new Error("Imagine WebSocket closed before image completed"))
            }
          }
        }

        ws.onmessage = event => {
          void (async () => {
            const text = await readMessageData(event.data)
            if (!text) return

            let msg
            try {
              msg = JSON.parse(text)
            } catch {
              return
            }

            if (msg.type === "error") {
              fail(new Error(msg.err_msg || msg.error || JSON.stringify(msg).slice(0, 160)))
              return
            }

            if (msg.type === "json") {
              const status = msg.current_status
              const imageId = String(msg.image_id || msg.job_id || "")
              if (!imageId) return

              if (status === "start_stage") {
                slots.set(imageId, {
                  imageId,
                  order: Number(msg.order || 0),
                  width: Number(msg.width || 0),
                  height: Number(msg.height || 0),
                  url: "",
                  blob: "",
                })
                return
              }

              if (status === "completed") {
                const slot = slots.get(imageId)
                if (!slot || msg.moderated) return
                finalImages.push({
                  imageId,
                  order: slot.order,
                  width: slot.width,
                  height: slot.height,
                  url: slot.url,
                  blob: slot.blob,
                })
                if (finalImages.length >= count) {
                  finish()
                }
              }
              return
            }

            if (msg.type === "image") {
              const url = msg.url || ""
              const imageId = String(msg.image_id || msg.job_id || parseImageId(url))
              if (!imageId) return

              const slot = slots.get(imageId) || {
                imageId,
                order: Number(msg.order || 0),
                width: Number(msg.width || 0),
                height: Number(msg.height || 0),
                url: "",
                blob: "",
              }
              slot.url = url || slot.url
              slot.blob = msg.blob || slot.blob
              slots.set(imageId, slot)
            }
          })().catch(fail)
        }
      })
    },
    {
      wsUrl: GROK_IMAGINE_WS_ENDPOINT,
      requestId,
      prompt,
      aspectRatio,
      count,
      enableNsfw,
      enablePro,
    },
  )

  let images
  try {
    images = await runImagineWs(page)
  } catch (error) {
    if (!isPageNavigationError(error)) {
      throw error
    }
    logger.warn("[Grok] Imagine page navigated during image generation, reopening browser and retrying")
    page = await prepareGrokPage(config, {
      forceNew: true,
      reason: "image generation page navigation",
    })
    images = await runImagineWs(page)
  }

  const result = {
    message: "",
    images: [],
    videos: [],
    searchResultImage: null,
  }

  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    const imageUrl = image.url ? resolveAssetUrl(image.url) : ""
    const ext = getImageExtension(imageUrl)
    const storagePath = path.join(plugindata, "grok", "images")
    const savePath = path.join(storagePath, `image_${Date.now()}_${i}.${ext}`)
    let localPath = null

    if (image.blob) {
      localPath = await saveBase64Media(image.blob, savePath)
    }
    if (!localPath && imageUrl) {
      localPath = await downloadMedia(page, imageUrl, savePath, "image", config)
    }

    result.images.push({
      url: imageUrl,
      localPath,
      width: image.width || 0,
      height: image.height || 0,
    })
  }

  return result
}

async function processResponse(page, data, config, e) {
  const grokResp = data.result?.response || {}
  const modelResponse = grokResp.modelResponse || {}
  const message = grokResp.message || modelResponse.message || ""
  const legacyImages = Array.isArray(grokResp.images) ? grokResp.images : []
  const generatedImageUrls = Array.isArray(modelResponse.generatedImageUrls)
    ? modelResponse.generatedImageUrls
    : []
  const cardImageUrls = collectCardImageUrls([
    grokResp.cardAttachment?.jsonData,
    ...(Array.isArray(modelResponse.cardAttachmentsJson)
      ? modelResponse.cardAttachmentsJson
      : []),
  ])
  const videos = Array.isArray(grokResp.videos) ? [...grokResp.videos] : []
  const responseVideo = collectVideoArtifacts(grokResp)
  if (responseVideo.videoUrl) {
    videos.push({ url: responseVideo.videoUrl, thumbUrl: responseVideo.thumbUrl })
  }

  const images = [...legacyImages]
  const seenImageUrls = new Set()

  for (const genUrl of generatedImageUrls) {
    if (!genUrl) continue
    const absoluteUrl = resolveAssetUrl(genUrl)
    if (seenImageUrls.has(absoluteUrl)) continue
    seenImageUrls.add(absoluteUrl)
    images.push({ url: absoluteUrl })
  }

  for (const cardUrl of cardImageUrls) {
    if (!cardUrl) continue
    const absoluteUrl = resolveAssetUrl(cardUrl)
    if (seenImageUrls.has(absoluteUrl)) continue
    seenImageUrls.add(absoluteUrl)
    images.push({ url: absoluteUrl })
  }

  const result = {
    message: stripGrokRenderBlocks(message),
    images: [],
    videos: [],
    searchResultImage: null,
  }

  if (message.includes("**Search Results:**")) {
    const searchResults = []
    const searchRegex = /- \[(.*?)\]\((.*?) "(.*?)"\)/g
    let match

    const searchSection = message.split("**Search Results:**")[1]
    if (searchSection) {
      while ((match = searchRegex.exec(searchSection)) !== null) {
        searchResults.push({
          title: match[1],
          url: match[2],
          preview: match[3],
        })
      }
    }

    if (searchResults.length > 0 && e) {
      const nodes = searchResults.map((item, index) => {
        return {
          user_id: e.self_id,
          nickname: "搜索结果",
          content: `【${index + 1}】${item.title}\n链接：${item.url}\n摘要：${item.preview}`,
        }
      })

      await e.sendForwardMsg(nodes, { source: `搜索结果 (${searchResults.length}条)` })
    }

    const searchBlockRegex = /(\n\n)?\*\*Search Results:\*\*\n(?:- \[.*?\]\(.*? ".*?"\)\n?)+/g
    result.message = message.replace(searchBlockRegex, "").trim()
  }

  if (images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const imageUrl = resolveAssetUrl(img.url || img.uri)
      if (!imageUrl) continue

      let localPath = null
      const storagePath = path.join(plugindata, "grok", "images")
      const fileName = `image_${Date.now()}_${i}.jpg`
      const savePath = path.join(storagePath, fileName)
      localPath = await downloadMedia(page, imageUrl, savePath, "image", config)

      result.images.push({
        url: imageUrl,
        localPath,
      })
    }
  }

  if (videos.length > 0) {
    const seenVideoUrls = new Set()
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      const rawVideoUrl = typeof video === "string"
        ? video
        : video.url || video.uri || video.videoUrl || video.videoURL || video.video_url || video.mediaUrl
      const videoUrl = resolveAssetUrl(rawVideoUrl)
      if (!videoUrl) continue
      if (seenVideoUrls.has(videoUrl)) continue
      seenVideoUrls.add(videoUrl)

      let localPath = null
      const storagePath = path.join(plugindata, "grok", "videos")
      const fileName = `video_${Date.now()}_${i}.mp4`
      const savePath = path.join(storagePath, fileName)
      localPath = await downloadMedia(page, videoUrl, savePath, "video", config)

      result.videos.push({
        url: videoUrl,
        localPath: localPath || null,
      })
    }
  }

  return result
}

async function fetchMediaPost(page, postId, config) {
  const cleanPostId = String(postId || "").trim()
  if (!cleanPostId) {
    return null
  }

  try {
    const { payload: result } = await fetchJsonWithAntiBotRetry(
      page,
      config,
      {
        url: POST_GET_ENDPOINT,
        pathname: "/rest/media/post/get",
        body: { id: cleanPostId },
        referer: `https://grok.com/imagine/${encodeURIComponent(cleanPostId)}`,
      },
      { label: "获取媒体帖子", preferNativeHeaders: true },
    )

    if (!result) {
      return null
    }

    const artifacts = collectVideoArtifacts(result)
    if (!artifacts.videoUrl && !artifacts.thumbUrl) {
      return null
    }
    return artifacts
  } catch (error) {
    logger.warn(`[Grok] 获取媒体帖子失败: ${error.message}`)
    return null
  }
}

function isAntiBotRejection(error) {
  const message = String(error?.message || error || "").toLowerCase()
  return (
    message.includes("anti-bot") ||
    message.includes("request rejected") ||
    message.includes("just a moment") ||
    message.includes("checking your browser") ||
    message.includes("challenge-platform") ||
    message.includes("cf-chl") ||
    message.includes("cf-mitigated") ||
    message.includes("cloudflare") ||
    (message.includes("http 403") && message.includes("<!doctype html"))
  )
}

async function setImaginePageUrl(page, postId = "") {
  const cleanPostId = String(postId || "").trim()
  try {
    await page.evaluate(id => {
      if (window.location.origin !== "https://grok.com") return
      const path = id ? `/imagine/${encodeURIComponent(id)}` : "/imagine"
      window.history.replaceState(window.history.state, "", path)
    }, cleanPostId)
  } catch (error) {
    logger.warn(`[Grok] 设置 Imagine 页面来源失败: ${error.message}`)
  }
}

async function generateBrowserStatsigId(page, pathname, method = "POST") {
  const cleanPathname = String(pathname || "/rest/app-chat/conversations/new").split("?")[0].trim()
  const cleanMethod = String(method || "POST").toUpperCase()

  try {
    return await page.evaluate(
      async ({ chunkUrl, pathname, method }) => {
        function inspectStatsigPayload(payload) {
          if (!Array.isArray(payload)) return null

          let defaultExport = null
          const inspectContext = {
            s(entries) {
              if (!Array.isArray(entries)) return

              for (let j = 0; j < entries.length; j += 3) {
                if (entries[j] === "default" && typeof entries[j + 2] === "function") {
                  defaultExport = entries[j + 2]
                  return
                }
              }

              for (const entry of entries) {
                if (
                  Array.isArray(entry) &&
                  entry[0] === "default" &&
                  typeof entry[2] === "function"
                ) {
                  defaultExport = entry[2]
                  return
                }
              }
            },
          }

          const inspectFactory = factory => {
            if (defaultExport || typeof factory !== "function") return
            try {
              factory(inspectContext)
            } catch { }
          }

          for (let i = 1; i < payload.length; i += 2) {
            inspectFactory(payload[i + 1])
          }

          for (const item of payload) {
            if (defaultExport) break

            if (typeof item === "function") {
              inspectFactory(item)
            } else if (item && typeof item === "object" && !Array.isArray(item)) {
              for (const value of Object.values(item)) {
                inspectFactory(value)
                if (defaultExport) break
              }
            }
          }

          return defaultExport
        }

        async function loadStatsigSigner() {
          if (typeof window.__sakuraGrokStatsigSigner === "function") {
            return window.__sakuraGrokStatsigSigner
          }

          if (!window.__sakuraGrokStatsigSignerPromise) {
            window.__sakuraGrokStatsigSignerPromise = new Promise((resolve, reject) => {
              const previousTurbopack = window.TURBOPACK
              let defaultExport = null
              let script = null
              let settled = false

              const cleanup = () => {
                try {
                  if (script?.parentNode) {
                    script.parentNode.removeChild(script)
                  }
                } catch { }

                try {
                  window.TURBOPACK = previousTurbopack
                } catch { }
              }

              const finish = error => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                cleanup()

                if (error) {
                  reject(error)
                  return
                }

                if (typeof defaultExport !== "function") {
                  reject(new Error("statsig default export not found"))
                  return
                }

                const signer = defaultExport()
                if (typeof signer !== "function") {
                  reject(new Error("statsig signer not found"))
                  return
                }

                window.__sakuraGrokStatsigSigner = signer
                resolve(signer)
              }

              const forwardPayload = payload => {
                try {
                  if (previousTurbopack && typeof previousTurbopack.push === "function") {
                    return previousTurbopack.push.call(previousTurbopack, payload)
                  }

                  if (Array.isArray(previousTurbopack)) {
                    return Array.prototype.push.call(previousTurbopack, payload)
                  }
                } catch { }
              }

              const wrapper = []
              if (previousTurbopack && typeof previousTurbopack === "object") {
                try {
                  Object.assign(wrapper, previousTurbopack)
                } catch { }
              }

              wrapper.push = payload => {
                try {
                  defaultExport ||= inspectStatsigPayload(payload)
                } catch { }

                return forwardPayload(payload)
              }
              window.TURBOPACK = wrapper

              const timer = setTimeout(() => {
                finish(new Error("statsig chunk script load timeout"))
              }, 30000)

              script = document.createElement("script")
              const nonce = document.querySelector("script[nonce]")?.nonce
              if (nonce) {
                script.setAttribute("nonce", nonce)
              }
              script.async = true
              script.src = chunkUrl
              script.onload = () => finish()
              script.onerror = () => finish(new Error("statsig chunk script load failed"))

              const mount = document.head || document.documentElement || document.body
              if (!mount) {
                finish(new Error("document mount node not found"))
                return
              }
              mount.appendChild(script)
            }).catch(error => {
              delete window.__sakuraGrokStatsigSignerPromise
              delete window.__sakuraGrokStatsigSigner
              throw error
            })
          }

          return await window.__sakuraGrokStatsigSignerPromise
        }

        const signer = await loadStatsigSigner()
        try {
          return await signer(pathname, method)
        } catch (error) {
          return btoa(`x1:${error}`)
        }
      },
      { chunkUrl: GROK_STATSIG_CHUNK_URL, pathname: cleanPathname, method: cleanMethod },
    )
  } catch (error) {
    if (!hasWarnedStatsigFallback) {
      hasWarnedStatsigFallback = true
      logger.warn(`[Grok] 浏览器 statsig 生成失败，已降级旧算法: ${error.message}`)
    }
    return Buffer.from(`x1:${error}`).toString("base64")
  }
}

async function sendRequestOnPage(page, payload, config, options = {}) {
  try {
    const pathname = options.pathname || "/rest/app-chat/conversations/new"
    const requestUrl = options.url || GROK_API_ENDPOINT
    const referer = options.conversationId && options.parentResponseId
      ? `https://grok.com/c/${options.conversationId}?rid=${options.parentResponseId}`
      : options.refererId
        ? `https://grok.com/imagine/${options.refererId}`
        : ""
    const browserStatsigId = await generateBrowserStatsigId(page, pathname, "POST")

    const fetchResponseText = async (useNativeHeaders = false) => {
      const requestId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : crypto.randomBytes(16).toString("hex")
      const headers = useNativeHeaders
        ? {
            Accept: "text/event-stream, application/json, */*",
            "Content-Type": "application/json",
            ...(browserStatsigId ? { "x-statsig-id": browserStatsigId } : {}),
            "x-xai-request-id": requestId,
          }
        : {
            ...getDynamicHeaders(config, pathname),
            Accept: "text/event-stream, application/json, */*",
            ...(referer ? { Referer: referer } : {}),
          }
      if (browserStatsigId) {
        headers["x-statsig-id"] = browserStatsigId
      }

      return await page.evaluate(
        async ({ url, headers, body, referrer }) => {
          const init = {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            credentials: "include",
          }
          if (referrer) {
            init.referrer = referrer
          }

          const response = await fetch(url, init)

          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`)
          }

          return await response.text()
        },
        { url: requestUrl, headers, body: payload, referrer: referer },
      )
    }

    let responseText
    try {
      responseText = await fetchResponseText(false)
    } catch (error) {
      if (!options.allowNativeHeaderRetry || !isAntiBotRejection(error)) {
        throw error
      }
      logger.warn("[Grok] 网页视频请求被 anti-bot 拦截，改用浏览器原生 headers 重试")
      responseText = await fetchResponseText(true)
    }

    const lines = responseText.split("\n").filter(line => line.trim())
    let finalMessage = ""
    let finalData = null
    const collectedVideos = []
    let collectedVideoPostId = ""
    let conversationId = options.conversationId || ""
    let userResponseId = ""
    let assistantResponseId = ""

    for (const rawLine of lines) {
      let line = rawLine.trim()
      if (line.startsWith("data:")) {
        line = line.replace(/^data:\s*/, "").trim()
      }
      if (!line || line === "[DONE]") {
        continue
      }

      try {
        const data = JSON.parse(line)
        const result = data.result || {}
        const response = result.response || result.modelResponse || result.userResponse || result

        const frameConversationId = result.conversation?.conversationId
        if (frameConversationId) {
          conversationId = frameConversationId
        }

        const frameUserResponseId = response.userResponse?.responseId || result.userResponse?.responseId
        if (frameUserResponseId) {
          userResponseId = frameUserResponseId
        }

        const frameAssistantResponseId =
          response.modelResponse?.responseId ||
          response.responseId ||
          result.modelResponse?.responseId ||
          result.responseId
        if (frameAssistantResponseId) {
          assistantResponseId = frameAssistantResponseId
        }

        const artifacts = collectVideoArtifacts(response)
        if (artifacts.videoUrl) {
          collectedVideos.push({ url: artifacts.videoUrl, thumbUrl: artifacts.thumbUrl || "" })
        }
        if (!collectedVideoPostId && artifacts.videoPostId) {
          collectedVideoPostId = artifacts.videoPostId
        }

        const streamVideoUrl = response.streamingVideoGenerationResponse?.videoUrl
        if (streamVideoUrl) {
          collectedVideos.push({ url: resolveAssetUrl(streamVideoUrl) })
        }

        const token = response.token
        if (token) {
          const filteredTags = ["xaiartifact", "xai:tool_usage_card", "grok:render"]
          const shouldSkip = filteredTags.some(tag => token.includes(tag))

          if (!shouldSkip) {
            finalMessage += token
          }
        }

        const webSearchResults = response.webSearchResults
        if (webSearchResults && webSearchResults.results) {
          let searchContent = "\n\n**Search Results:**\n"
          for (const result of webSearchResults.results) {
            const title = result.title || "No Title"
            const url = result.url || "#"
            const preview = (result.preview || "").replace(/\n/g, " ")
            searchContent += `- [${title}](${url} "${preview}")\n`
          }
          finalMessage += searchContent
        }

        const hasModelResponse = Boolean(result.modelResponse || response.modelResponse)
        if (hasModelResponse) {
          finalData = data.result?.response ? data : {
            ...data,
            result: {
              ...result,
              response,
            },
          }
        }
      } catch (e) { }
    }

    if (!collectedVideos.some(item => item.url) && collectedVideoPostId) {
      const fetched = await fetchMediaPost(page, collectedVideoPostId, config)
      if (fetched?.videoUrl) {
        collectedVideos.push({ url: fetched.videoUrl, thumbUrl: fetched.thumbUrl || "" })
      }
    }

    if (finalData) {
      const modelMessage = finalData.result?.response?.modelResponse?.message || finalData.result?.response?.message
      if (modelMessage || finalMessage) {
        const searchIndex = finalMessage.indexOf("\n\n**Search Results:**")
        const searchContent = searchIndex >= 0 ? finalMessage.slice(searchIndex) : ""
        finalData.result.response.message = `${modelMessage || finalMessage}${searchContent}`.trim()
      }
    }

    if (!finalData && collectedVideos.length > 0) {
      finalData = {
        result: {
          response: {
            message: "视频生成完成",
            videos: collectedVideos,
          },
        },
      }
    }

    if (!finalData) {
      throw new Error("未找到有效响应数据")
    }
    if (collectedVideos.length > 0 && finalData.result.response) {
      const resp = finalData.result.response
      resp.videos = Array.isArray(resp.videos)
        ? resp.videos.concat(collectedVideos)
        : collectedVideos
    }

    const processed = await processResponse(page, finalData, config, options.e)
    processed.conversationId = conversationId || ""
    processed.responseId = assistantResponseId || finalData?.result?.response?.modelResponse?.responseId || finalData?.result?.response?.responseId || ""
    processed.userResponseId = userResponseId || finalData?.result?.response?.userResponse?.responseId || ""
    return processed
  } catch (error) {
    throw new Error(`请求失败: ${error.message}`)
  }
}

async function sendRequest(page, payload, config, options = {}) {
  let activePage = page

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await sendRequestOnPage(activePage, payload, config, options)
    } catch (error) {
      if (attempt > 0 || !isPageNavigationError(error)) {
        throw error
      }

      logger.warn("[Grok] page navigated during request, reopening browser and retrying")
      activePage = await prepareGrokPage(config, {
        forceNew: true,
        reason: "request page navigation",
      })
      if (options.refererId) {
        await setImaginePageUrl(activePage, options.refererId)
      }
    }
  }

  throw new Error("Grok 请求重试后仍然失败")
}

function extractContentFromMessages(messages, options = {}) {
  const imageUrls = []
  const sourceMessages = Array.isArray(messages) ? messages : []
  const workingMessages = options.latestUserOnly
    ? sourceMessages.filter(msg => msg?.role === "user").slice(-1)
    : sourceMessages

  const parsedMessages = workingMessages
    .map(msg => {
      let content = msg.content || ""

      if (Array.isArray(content)) {
        let textPart = ""
        for (const item of content) {
          if (item.type === "text") {
            textPart += item.text || ""
          } else if (item.type === "image_url") {
            const url = item.image_url?.url || ""
            if (url) imageUrls.push(url)
          }
        }
        content = textPart
      }

      return { role: msg.role || "user", content }
    })
    .filter(m => m.content)

  if (parsedMessages.length === 1 && parsedMessages[0].role === "user") {
    return {
      content: parsedMessages[0].content,
      imageUrls,
    }
  }

  const contentParts = []
  for (const msg of parsedMessages) {
    if (msg.role === "system") {
      contentParts.push(`System: ${msg.content}`)
    } else if (msg.role === "user") {
      contentParts.push(`User: ${msg.content}`)
    } else if (msg.role === "assistant") {
      contentParts.push(`Assistant: ${msg.content}`)
    } else {
      contentParts.push(`${msg.role}: ${msg.content}`)
    }
  }

  return {
    content: contentParts.join("\n\n"),
    imageUrls,
  }
}

async function executeGrokRequest(request, config, e) {
  const { model = DEFAULT_GROK_MODEL, messages, imageOptions = {}, videoOptions = {}, grokSessionKey = "" } = request

  const activeGrokSession =
    grokSessionKey && model !== "grok-imagine-image" && model !== "grok-imagine-video"
      ? getGrokConversationSession(grokSessionKey)
      : null
  const extracted = extractContentFromMessages(messages, {
    latestUserOnly: Boolean(activeGrokSession),
  })
  const fallbackExtracted = activeGrokSession ? extractContentFromMessages(messages) : extracted
  const { content, imageUrls } = extracted

  if (!content && imageUrls.length === 0) {
    throw new Error("消息内容不能为空")
  }

  if (!config.sso && !config.supersso) {
    throw new Error("未配置认证Token (sso 或 supersso)")
  }

  const modelInfo = GROK_MODELS[model]
  if (!modelInfo) {
    throw new Error(`未找到模型配置: ${model}`)
  }
  const isVideoModel = modelInfo.isVideoModel
  const isImageModel = modelInfo.isImageModel

  let page
  try {
    page = await prepareGrokPage(config)

    let fileIds = []
    let fileUris = []

    if (imageUrls.length > 0) {
      const uploadResult = await uploadImages(page, imageUrls, config)
      fileIds = uploadResult.fileIds
      fileUris = uploadResult.fileUris
    }

    if (isImageModel && imageUrls.length === 0) {
      const parsedOptions = parseGrokImageOptions(content)
      const prompt = String(imageOptions.prompt ?? parsedOptions.prompt ?? "").trim()
      const result = await generateImagesViaImagineWs(
        page,
        {
          prompt,
          aspectRatio: imageOptions.aspectRatio || parsedOptions.aspectRatio,
          count: imageOptions.count || parsedOptions.count,
          enableNsfw: imageOptions.enableNsfw,
          enablePro: imageOptions.enablePro ?? parsedOptions.enablePro,
        },
        config,
      )

      return {
        text: result.message,
        images: result.images,
        videos: result.videos,
      }
    }

    if (isVideoModel) {
      const parsedOptions = parseGrokVideoOptions(content)
      const prompt = String(videoOptions.prompt ?? parsedOptions.prompt ?? "").trim()
      const durationSec = normalizeVideoDuration(
        videoOptions.durationSec ?? videoOptions.duration ?? parsedOptions.durationSec,
      )
      const shape = videoConfig(
        videoOptions.size || parsedOptions.size,
        videoOptions.aspectRatio || parsedOptions.aspectRatio,
        videoOptions.quality || videoOptions.resolution || parsedOptions.quality || parsedOptions.resolution,
      )
      const assetUrls = fileUris.map(uri => resolveAssetUrl(uri)).filter(Boolean)
      const requestedVideoMode = normalizeVideoMode(videoOptions.mode || videoOptions.videoMode, "")
      const videoMode = requestedVideoMode || (assetUrls.length > 0 && !prompt ? "normal" : DEFAULT_VIDEO_MODE)
      const promptPart = prompt ? ` ${prompt}` : ""
      let parentPostId = ""
      let videoMessage = ""
      let fileAttachments = []

      if (assetUrls.length === 1) {
        parentPostId = await createMediaPost(page, config, {
          mediaType: MEDIA_POST_TYPE_IMAGE,
          mediaUrl: assetUrls[0],
        })
        if (!parentPostId) {
          throw new Error("创建 Grok 图片媒体帖子失败")
        }
        const attachmentId = extractAssetIdFromUrl(assetUrls[0]) || assetUrls[0]
        fileAttachments = [attachmentId]
        videoMessage = `${assetUrls[0]}${promptPart} --mode=${videoMode}`.trim()
      } else {
        parentPostId = await createMediaPost(page, config, {
          mediaType: MEDIA_POST_TYPE_VIDEO,
          prompt,
        })
        if (!parentPostId) {
          throw new Error("创建 Grok 视频媒体帖子失败")
        }

        if (assetUrls.length > 1) {
          videoMessage = `${prompt || ""} --mode=${videoMode}`.trim()
        } else {
          videoMessage = `${prompt || "Generate a video"} --mode=${videoMode}`.trim()
        }
      }

      const payload = buildVideoPayload({
        message: videoMessage,
        fileAttachments,
        parentPostId,
        aspectRatio: shape.aspectRatio,
        durationSec,
        resolutionName: shape.resolutionName,
        originalPrompt: prompt,
        imageReferences: assetUrls.length > 1 ? assetUrls : [],
        isReferenceToVideo: assetUrls.length > 1,
      })

      await setImaginePageUrl(page, parentPostId)
      const result = await sendRequest(page, payload, config, {
        refererId: parentPostId,
        allowNativeHeaderRetry: true,
        e,
      })

      return {
        text: result.message,
        images: result.images,
        videos: result.videos,
      }
    }

    const shouldMaintainSession = Boolean(grokSessionKey)
    const useContinuation = Boolean(activeGrokSession?.conversationId && (activeGrokSession.responseId || activeGrokSession.lastResponseId))
    const requestPayload = useContinuation
      ? buildContinuationPayload(
          content,
          modelInfo.modelName,
          modelInfo.modelMode,
          fileIds,
          activeGrokSession.responseId || activeGrokSession.lastResponseId || activeGrokSession.messageId || "",
        )
      : buildPayload(
          content,
          modelInfo.modelName,
          modelInfo.modelMode,
          fileIds,
          shouldMaintainSession ? false : config.temporary,
          false,
        )

    const requestOptions = useContinuation
      ? {
          e,
          conversationId: activeGrokSession.conversationId,
          parentResponseId: activeGrokSession.responseId || activeGrokSession.lastResponseId || "",
          pathname: activeGrokSession.conversationId
            ? GROK_CONVERSATION_RESPONSE_PATH(activeGrokSession.conversationId)
            : "/rest/app-chat/conversations/new",
          url: activeGrokSession.conversationId
            ? GROK_CONVERSATION_RESPONSE_ENDPOINT(activeGrokSession.conversationId)
            : GROK_API_ENDPOINT,
        }
      : { e }

    let result
    try {
      result = await sendRequest(page, requestPayload, config, requestOptions)
    } catch (error) {
      const shouldRetryAsNew =
        useContinuation &&
        /Response not found|Invalid uuid|HTTP 40[04]/i.test(error.message || "")
      if (!shouldRetryAsNew) {
        throw error
      }

      clearGrokConversationSession(grokSessionKey)
      const newPayload = buildPayload(
        fallbackExtracted.content || content,
        modelInfo.modelName,
        modelInfo.modelMode,
        fileIds,
        false,
        false,
      )
      result = await sendRequest(page, newPayload, config, { e })
    }

    if (shouldMaintainSession) {
      const nextConversationId = result.conversationId || activeGrokSession?.conversationId
      const nextResponseId = result.responseId || ""
      if (nextConversationId && nextResponseId) {
        setGrokConversationSession(grokSessionKey, {
          conversationId: nextConversationId,
          responseId: nextResponseId,
          lastResponseId: nextResponseId,
          modelName: modelInfo.modelName,
          modelMode: modelInfo.modelMode,
        })
      }
    }

    return {
      text: result.message,
      images: result.images,
      videos: result.videos,
    }
  } finally {
    await closeBrowser()
  }
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return

  isProcessing = true

  while (requestQueue.length > 0) {
    const { request, config, e, resolve, reject } = requestQueue.shift()

    try {
      const result = await executeGrokRequest(request, config, e)
      resolve(result)
    } catch (error) {
      reject(error)
    }
  }

  isProcessing = false
}

export async function grokRequest(request, config, e) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ request, config, e, resolve, reject })
    processQueue()
  })
}
