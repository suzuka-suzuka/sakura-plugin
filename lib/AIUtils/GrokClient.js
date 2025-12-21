import { connect } from "puppeteer-real-browser"
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import axios from "axios"
import { plugindata } from "../path.js"

const GROK_API_ENDPOINT = "https://grok.com/rest/app-chat/conversations/new"
const UPLOAD_ENDPOINT = "https://grok.com/rest/app-chat/upload-file"
const POST_CREATE_ENDPOINT = "https://grok.com/rest/media/post/create"
const ASSET_BASE_URL = "https://assets.grok.com/"

const requestQueue = []
let isProcessing = false

let browserInstance = null
let pageInstance = null
let browserCloseTimeout = null

const GROK_MODELS = {
  "grok-3-fast": { modelName: "grok-3", modelMode: "MODEL_MODE_FAST", isVideoModel: false },
  "grok-4-fast": {
    modelName: "grok-4-mini-thinking-tahoe",
    modelMode: "MODEL_MODE_GROK_4_MINI_THINKING",
    isVideoModel: false,
  },
  "grok-4-fast-expert": {
    modelName: "grok-4-mini-thinking-tahoe",
    modelMode: "MODEL_MODE_EXPERT",
    isVideoModel: false,
  },
  "grok-4-expert": {
    modelName: "grok-4",
    modelMode: "MODEL_MODE_EXPERT",
    isVideoModel: false,
  },
  "grok-4-heavy": {
    modelName: "grok-4-heavy",
    modelMode: "MODEL_MODE_HEAVY",
    isVideoModel: false,
  },
  "grok-4.1": {
    modelName: "grok-4-1-non-thinking-w-tool",
    modelMode: "MODEL_MODE_GROK_4_1",
    isVideoModel: false,
  },
  "grok-4.1-thinking": {
    modelName: "grok-4-1-thinking-1108b",
    modelMode: "MODEL_MODE_AUTO",
    isVideoModel: false,
  },
  "grok-imagine-0.9": {
    modelName: "grok-3",
    modelMode: "MODEL_MODE_FAST",
    isVideoModel: true,
  },
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

async function initBrowser() {
  if (browserCloseTimeout) {
    clearTimeout(browserCloseTimeout)
    browserCloseTimeout = null
  }

  if (browserInstance && pageInstance) {
    return { browser: browserInstance, page: pageInstance }
  }

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

export async function closeBrowser() {
  if (browserCloseTimeout) {
    clearTimeout(browserCloseTimeout)
  }

  browserCloseTimeout = setTimeout(async () => {
    if (browserInstance) {
      try {
        await browserInstance.close()
      } catch (err) {
        logger.error(`[Grok] 关闭浏览器失败: ${err.message}`)
      }
      browserInstance = null
      pageInstance = null
    }
    browserCloseTimeout = null
  }, 120000)
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

    const headers = {
      ...getDynamicHeaders(config, "/rest/app-chat/upload-file"),
    }

    const result = await page.evaluate(
      async ({ url, headers, body }) => {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })

        if (response.ok) {
          return await response.json()
        }

        return null
      },
      { url: UPLOAD_ENDPOINT, headers, body: uploadData },
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

async function createMediaPost(page, fileUri, config) {
  try {
    if (!fileUri) {
      return null
    }
    const mediaUrl = fileUri.startsWith("http")
      ? fileUri
      : `https://assets.grok.com/${fileUri.replace(/^\/+/, "")}`
    const payload = {
      media_url: mediaUrl,
      media_type: "MEDIA_POST_TYPE_IMAGE",
    }
    const headers = {
      ...getDynamicHeaders(config, "/rest/media/post/create"),
    }
    const result = await page.evaluate(
      async ({ url, headers, body }) => {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
        if (!response.ok) {
          const text = await response.text()
          throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`)
        }
        return await response.json()
      },
      { url: POST_CREATE_ENDPOINT, headers, body: payload },
    )

    const postId = result?.post?.id
    if (postId) {
      return postId
    }
    return null
  } catch (error) {
    logger.warn(`[Grok] 创建媒体帖子失败: ${error.message}`)
    return null
  }
}

function buildPayload(content, modelName, modelMode, fileIds, temporary, isVideoModel) {
  if (isVideoModel) {
    return {
      temporary: true,
      modelName: "grok-3",
      message: content,
      fileAttachments: fileIds,
      toolOverrides: { videoGen: true },
    }
  }

  return {
    temporary: temporary !== false,
    modelName: modelName || "grok-3",
    message: content,
    fileAttachments: fileIds,
    imageAttachments: [],
    disableSearch: false,
    enableImageGeneration: true,
    returnImageBytes: false,
    returnRawGrokInXaiRequest: false,
    enableImageStreaming: true,
    imageGenerationCount: 2,
    forceConcise: false,
    toolOverrides: {},
    enableSideBySide: true,
    sendFinalMetadata: true,
    isReasoning: false,
    webpageUrls: [],
    disableTextFollowUps: true,
    responseMetadata: {
      requestModelDetails: {
        modelId: modelName || "grok-3",
      },
    },
    disableMemory: false,
    forceSideBySide: false,
    modelMode: modelMode || "default",
    isAsyncChat: false,
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

async function processResponse(page, data, config, e) {
  const grokResp = data.result?.response || {}
  const modelResponse = grokResp.modelResponse || {}
  const message = grokResp.message || modelResponse.message || ""
  const legacyImages = Array.isArray(grokResp.images) ? grokResp.images : []
  const generatedImageUrls = Array.isArray(modelResponse.generatedImageUrls)
    ? modelResponse.generatedImageUrls
    : []
  const videos = Array.isArray(grokResp.videos) ? grokResp.videos : []

  const images = [...legacyImages]

  for (const genUrl of generatedImageUrls) {
    if (!genUrl) continue
    const absoluteUrl = resolveAssetUrl(genUrl)
    images.push({ url: absoluteUrl })
  }

  const result = {
    message,
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
          type: "node",
          data: {
            user_id: e.self_id || e.bot?.uin || 2854196310,
            nickname: "搜索结果",
            content: `【${index + 1}】${item.title}\n链接：${item.url}\n摘要：${item.preview}`,
          },
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
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      const videoUrl = resolveAssetUrl(video.url || video.uri)
      if (!videoUrl) continue

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

async function sendRequest(page, payload, config, options = {}) {
  try {
    const headers = {
      ...getDynamicHeaders(config, "/rest/app-chat/conversations/new"),
    }
    if (options.refererId) {
      headers["Referer"] = `https://grok.com/imagine/${options.refererId}`
    }

    const responseText = await page.evaluate(
      async ({ url, headers, body }) => {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`)
        }

        return await response.text()
      },
      { url: GROK_API_ENDPOINT, headers, body: payload },
    )

    const lines = responseText.split("\n").filter(line => line.trim())
    let finalMessage = ""
    let finalData = null
    const collectedVideos = []

    for (const line of lines) {
      try {
        const data = JSON.parse(line)

        const videoResp = data.result?.response?.streamingVideoGenerationResponse
        if (videoResp?.videoUrl) {
          const cleanedPath = videoResp.videoUrl.replace(/^\/+/, "")
          const absoluteUrl = cleanedPath.startsWith("http")
            ? cleanedPath
            : `https://assets.grok.com/${cleanedPath}`
          collectedVideos.push({ url: absoluteUrl })
        }

        const token = data.result?.response?.token
        if (token) {
          const filteredTags = ["xaiartifact", "xai:tool_usage_card", "grok:render"]
          const shouldSkip = filteredTags.some(tag => token.includes(tag))

          if (!shouldSkip) {
            finalMessage += token
          }
        }

        const webSearchResults = data.result?.response?.webSearchResults
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

        if (data.result?.response?.modelResponse) {
          finalData = data
        }
      } catch (e) {}
    }

    if (finalMessage && finalData) {
      finalData.result.response.message = finalMessage
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

    return await processResponse(page, finalData, config, options.e)
  } catch (error) {
    throw new Error(`请求失败: ${error.message}`)
  }
}

function extractContentFromMessages(messages) {
  const imageUrls = []

  const parsedMessages = messages
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
  const { model = "grok-3", messages } = request

  const { content, imageUrls } = extractContentFromMessages(messages)

  if (!content && imageUrls.length === 0) {
    throw new Error("消息内容不能为空")
  }

  if (!config.sso && !config.supersso) {
    throw new Error("未配置认证Token (sso 或 supersso)")
  }

  const modelInfo = GROK_MODELS[model] || GROK_MODELS["grok-3-fast"]
  if (!modelInfo) {
    throw new Error(`未找到模型配置: ${model}`)
  }
  const isVideoModel = modelInfo.isVideoModel

  const { page } = await initBrowser()

  try {
    await ensureBrowserCookies(page, config)

    if (!page.url().includes("grok.com")) {
      await page.goto("https://grok.com", { waitUntil: "networkidle2", timeout: 60000 })

      await new Promise(resolve => setTimeout(resolve, 3000))
    }

    let fileIds = []
    let fileUris = []

    if (imageUrls.length > 0) {
      const uploadResult = await uploadImages(page, imageUrls, config)
      fileIds = uploadResult.fileIds
      fileUris = uploadResult.fileUris
    }

    if (isVideoModel && fileUris.length > 0) {
      const imageUri = fileUris[0]
      const postId = await createMediaPost(page, imageUri, config)
      const videoMessage = postId
        ? `https://grok.com/imagine/${postId}  ${content} --mode=custom`
        : `https://assets.grok.com/post/${imageUri}  ${content} --mode=custom`

      const payload = buildPayload(
        videoMessage,
        modelInfo.modelName,
        modelInfo.modelMode,
        fileIds,
        config.temporary,
        true,
      )

      const refererId = postId || fileIds[0] || null
      const result = await sendRequest(page, payload, config, { refererId, e })

      return {
        text: result.message,
        images: result.images,
        videos: result.videos,
      }
    }

    const payload = buildPayload(
      content,
      modelInfo.modelName,
      modelInfo.modelMode,
      fileIds,
      config.temporary,
      false,
    )

    const result = await sendRequest(page, payload, config, { e })

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
