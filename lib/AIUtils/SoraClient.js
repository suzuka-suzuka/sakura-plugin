import Setting from "../setting.js"
import { connect } from "puppeteer-real-browser"
import sharp from "sharp"

let browserInstance = null
let pageInstance = null
let isGenerating = false

/**
 * 初始化浏览器实例
 */
async function initBrowser() {
  if (browserInstance && pageInstance) {
    return { page: pageInstance, browser: browserInstance }
  }

  const isLinux = process.platform === "linux"

  const { page, browser } = await connect({
    headless: false,
    args: isLinux
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [],
    turnstile: true,
    customConfig: {},
    connectOption: {},
    disableXvfb: false,
    ignoreAllFlags: false,
    ...(isLinux && {
      xvfbsession: true,
    }),
  })

  browserInstance = browser
  pageInstance = page

  return { page, browser }
}

/**
 * 关闭浏览器实例
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close()
    } catch (error) {
      logger.error(`[SoraClient] 关闭浏览器失败: ${error.message}`)
    }
    browserInstance = null
    pageInstance = null
  }
}

/**
 * 下载图片并转换为 Buffer（自动处理 GIF 转 PNG）
 */
async function downloadImage(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  let buffer = Buffer.from(arrayBuffer)
  const contentType = response.headers.get("content-type") || "image/jpeg"

  if (contentType === "image/gif") {
    buffer = await sharp(buffer).toFormat("png").toBuffer()
  }

  return buffer
}

/**
 * 检查是否正在生成中
 */
export function isBusy() {
  return isGenerating
}

/**
 * 创建 SoraClient 实例
 */
export async function createSoraClient() {
  const config = Setting.getConfig("SoraVideo")
  const accessToken = config.access_token

  const { page, browser } = await initBrowser()
  const client = new SoraClient(page, accessToken)

  return { client, browser, closeBrowser }
}

/**
 * 执行文本生成视频
 */
export async function textToVideo(prompt, options = {}) {
  if (isGenerating) {
    throw new Error("当前有视频生成任务正在进行中，请稍后再试")
  }

  isGenerating = true
  try {
    const { client } = await createSoraClient()
    const result = await client.textToVideo(prompt, options)
    return result
  } finally {
    isGenerating = false
    await closeBrowser()
  }
}

/**
 * 执行图片生成视频
 */
export async function imageToVideo(prompt, imageUrl, options = {}) {
  if (isGenerating) {
    throw new Error("当前有视频生成任务正在进行中，请稍后再试")
  }

  isGenerating = true
  try {
    const imageBuffer = await downloadImage(imageUrl)
    const { client } = await createSoraClient()
    const result = await client.imageToVideo(prompt, imageBuffer, {
      ...options,
      filename: "input.png",
    })
    return result
  } finally {
    isGenerating = false
    await closeBrowser()
  }
}

export default class SoraClient {
  constructor(page, accessToken) {
    this.accessToken = accessToken
    this.baseUrl = "https://sora.chatgpt.com/backend"
    this.timeout = 120000

    if (!this.accessToken || this.accessToken === "your_access_token_here") {
      throw new Error("请在 config/SoraVideo.yaml 中配置你的 access_token")
    }

    this.page = page
  }

  _generateSentinelToken() {
    const length = Math.floor(Math.random() * 11) + 10
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let result = ""
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  async _request(method, endpoint, data = null, formData = null, addSentinel = false) {
    if (!this.page) {
      throw new Error("Page 对象未初始化")
    }

    const url = `${this.baseUrl}${endpoint}`

    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/",
    }

    if (addSentinel) {
      headers["Openai-Sentinel-Token"] = this._generateSentinelToken()
    }

    try {
      let result

      if (formData) {
        await this.page.goto("https://sora.chatgpt.com/", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        })

        result = await this.page.evaluate(
          async (url, headersObj, formDataObj) => {
            return new Promise((resolve, reject) => {
              try {
                const xhr = new XMLHttpRequest()
                xhr.open("POST", url, true)

                const formData = new FormData()

                const byteCharacters = atob(formDataObj.fileBase64)
                const byteNumbers = new Array(byteCharacters.length)
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)
                const blob = new Blob([byteArray], { type: formDataObj.mimeType })

                formData.append("file", blob, formDataObj.filename)
                formData.append("file_name", formDataObj.filename)

                for (const [key, value] of Object.entries(headersObj)) {
                  if (key.toLowerCase() !== "content-type") {
                    try {
                      xhr.setRequestHeader(key, value)
                    } catch (e) {}
                  }
                }

                xhr.onload = function () {
                  resolve({
                    status: xhr.status,
                    body: xhr.responseText,
                  })
                }

                xhr.onerror = function () {
                  reject(new Error("Network error"))
                }

                xhr.ontimeout = function () {
                  reject(new Error("Request timeout"))
                }

                xhr.timeout = 60000
                xhr.send(formData)
              } catch (error) {
                reject(error)
              }
            })
          },
          url,
          headers,
          formData,
        )

        if (result.status < 200 || result.status >= 300) {
          throw new Error(`HTTP ${result.status}: ${result.body}`)
        }

        try {
          return JSON.parse(result.body)
        } catch (e) {
          return result.body
        }
      } else if (method === "POST" && data) {
        await this.page.setRequestInterception(true)

        this.page.once("request", interceptedRequest => {
          const overrides = {
            method: "POST",
            headers: {
              ...interceptedRequest.headers(),
              ...headers,
              "Content-Type": "application/json",
            },
            postData: JSON.stringify(data),
          }

          interceptedRequest.continue(overrides)
        })

        const response = await this.page.goto(url, {
          waitUntil: "networkidle2",
          timeout: this.timeout,
        })

        await this.page.setRequestInterception(false)

        const bodyText = await this.page.evaluate(() => {
          const preElement = document.querySelector("pre")
          if (preElement) {
            return preElement.textContent
          }
          return document.body.innerText
        })

        try {
          return JSON.parse(bodyText)
        } catch (e) {
          return bodyText
        }
      } else {
        await this.page.setExtraHTTPHeaders(headers)
        const response = await this.page.goto(url, {
          waitUntil: "networkidle2",
          timeout: this.timeout,
        })

        const bodyText = await this.page.evaluate(() => {
          const preElement = document.querySelector("pre")
          if (preElement) {
            return preElement.textContent
          }
          return document.body.innerText
        })

        try {
          return JSON.parse(bodyText)
        } catch (e) {
          return bodyText
        }
      }
    } catch (error) {
      throw new Error(`请求失败: ${error.message}`)
    }
  }

  async uploadImage(imageBuffer, filename = "image.png") {
    let mimeType = "image/png"
    if (filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg")) {
      mimeType = "image/jpeg"
    } else if (filename.toLowerCase().endsWith(".webp")) {
      mimeType = "image/webp"
    }

    const formDataObj = {
      fileBase64: imageBuffer.toString("base64"),
      filename: filename,
      mimeType: mimeType,
    }

    const result = await this._request("POST", "/uploads", null, formDataObj)

    if (!result || !result.id) {
      throw new Error("上传失败，未返回 file_id")
    }

    return result.id
  }

  async generateVideo(prompt, options = {}) {
    const {
      imageFileId = null,
      orientation = "portrait",
      nFrames = 300,
      size = "small",
      model = "sy_8",
    } = options

    const inpaintItems = []
    if (imageFileId) {
      inpaintItems.push({
        kind: "upload",
        upload_id: imageFileId,
      })
    }

    const data = {
      kind: "video",
      prompt,
      orientation,
      size,
      n_frames: nFrames,
      model,
      inpaint_items: inpaintItems,
    }

    const result = await this._request("POST", "/nf/create", data, null, true)
    return result.id
  }

  async getPendingTasks() {
    const result = await this._request("GET", "/nf/pending")
    return Array.isArray(result) ? result : []
  }

  async getVideoDrafts(limit = 15) {
    const result = await this._request("GET", `/project_y/profile/drafts?limit=${limit}`)
    return result.items || []
  }

  async waitForVideo(taskId, maxWaitTime = 1500, pollInterval = 20) {
    const startTime = Date.now()
    const maxWaitMs = maxWaitTime * 1000
    const pollIntervalMs = pollInterval * 1000

    while (Date.now() - startTime < maxWaitMs) {
      const pendingTasks = await this.getPendingTasks()
      const task = pendingTasks.find(t => t.id === taskId)

      if (task) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
      } else {
        break
      }
    }

    if (Date.now() - startTime >= maxWaitMs) {
      throw new Error(`视频生成超时，任务仍在处理中`)
    }

    const maxRetries = 3
    const retryInterval = 5000

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const drafts = await this.getVideoDrafts(50)
        const draft = drafts.find(d => d.task_id === taskId)

        if (draft) {
          const videoUrl = draft.downloadable_url || draft.url
          const thumbnailUrl = draft.thumbnail_url || ""

          if (videoUrl) {
            return {
              url: videoUrl,
              thumbnailUrl,
              draft,
            }
          }
        }

        if (retry < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryInterval))
        }
      } catch (error) {
        if (retry < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryInterval))
        }
      }
    }

    throw new Error(`无法获取视频链接，可能是违规请求，请更换提示词或图片`)
  }

  async textToVideo(prompt, options = {}) {
    const taskId = await this.generateVideo(prompt, options)
    const result = await this.waitForVideo(taskId)
    return result
  }

  async imageToVideo(prompt, imageBuffer, options = {}) {
    const fileId = await this.uploadImage(imageBuffer, options.filename || "image.png")
    const taskId = await this.generateVideo(prompt, { ...options, imageFileId: fileId })
    const result = await this.waitForVideo(taskId)
    return result
  }
}
