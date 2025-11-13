import Setting from "../setting.js"

export default class SoraClient {
  constructor(page) {
    this.config = Setting.getConfig("SoraVideo")

    this.accessToken = this.config.sora.access_token
    this.baseUrl = this.config.sora.base_url
    this.timeout = this.config.sora.timeout * 1000

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

        if (!response || !response.ok()) {
          const status = response ? response.status() : 'no response'
          logger.error(`[SoraClient] 请求失败: ${url}, status=${status}`)
        }

        const bodyText = await this.page.evaluate(() => {
          const preElement = document.querySelector("pre")
          if (preElement) {
            return preElement.textContent
          }
          return document.body.innerText
        })

        try {
          const jsonResult = JSON.parse(bodyText)
          return jsonResult
        } catch (e) {
          logger.warn(`[SoraClient] 响应不是JSON格式: ${bodyText.substring(0, 200)}`)
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
      orientation = this.config.video.orientation,
      nFrames = this.config.video.n_frames,
    } = options

    logger.info(`[SoraClient] 生成视频参数: orientation=${orientation}, nFrames=${nFrames}, imageFileId=${imageFileId}`)

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
      size: this.config.video.size,
      n_frames: nFrames,
      model: this.config.video.model,
      inpaint_items: inpaintItems,
    }

    logger.info(`[SoraClient] 发送视频生成请求...`)
    const result = await this._request("POST", "/nf/create", data, null, true)
    logger.info(`[SoraClient] 获得任务ID: ${result.id}`)
    return result.id
  }

  async getPendingTasks() {
    const result = await this._request("GET", "/nf/pending")
    const tasks = Array.isArray(result) ? result : []
    logger.info(`[SoraClient] 当前待处理任务数: ${tasks.length}`)
    return tasks
  }

  async getVideoDrafts(limit = 15) {
    logger.info(`[SoraClient] 获取视频草稿列表，limit=${limit}`)
    const result = await this._request("GET", `/project_y/profile/drafts?limit=${limit}`)
    const items = result.items || []
    logger.info(`[SoraClient] 获取到 ${items.length} 个草稿`)
    return items
  }

  async waitForVideo(taskId, maxWaitTime = 1500, pollInterval = 5) {
    const startTime = Date.now()
    const maxWaitMs = maxWaitTime * 1000
    const pollIntervalMs = pollInterval * 1000

    logger.info(`[SoraClient] 开始等待视频生成，任务ID: ${taskId}`)

    while (Date.now() - startTime < maxWaitMs) {
      const pendingTasks = await this.getPendingTasks()
      const task = pendingTasks.find(t => t.id === taskId)

      if (task) {
        logger.info(`[SoraClient] 任务仍在处理中，继续等待...`)
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
      } else {
        logger.info(`[SoraClient] 任务已完成，开始获取视频链接`)
        break
      }
    }

    if (Date.now() - startTime >= maxWaitMs) {
      throw new Error(`视频生成超时（超过 ${maxWaitTime} 秒），任务仍在处理中`)
    }

    const maxRetries = 3
    const retryInterval = 5000

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        logger.info(`[SoraClient] 第 ${retry + 1}/${maxRetries} 次尝试获取视频链接`)
        
        const drafts = await this.getVideoDrafts(50)
        logger.info(`[SoraClient] 获取到 ${drafts.length} 个草稿`)
        
        const draft = drafts.find(d => d.task_id === taskId)

        if (draft) {
          logger.info(`[SoraClient] 找到对应草稿: ${JSON.stringify(draft)}`)
          const videoUrl = draft.downloadable_url || draft.url
          const thumbnailUrl = draft.thumbnail_url || ""

          if (videoUrl) {
            logger.info(`[SoraClient] 成功获取视频链接: ${videoUrl}`)
            return {
              url: videoUrl,
              thumbnailUrl,
              draft,
            }
          } else {
            logger.warn(`[SoraClient] 草稿中没有视频链接`)
          }
        } else {
          logger.warn(`[SoraClient] 未找到对应的草稿，任务ID: ${taskId}`)
        }

        if (retry < maxRetries - 1) {
          logger.info(`[SoraClient] 等待 ${retryInterval}ms 后重试...`)
          await new Promise(resolve => setTimeout(resolve, retryInterval))
        }
      } catch (error) {
        logger.error(`[SoraClient] 获取视频链接时出错: ${error.message}`)
        if (retry < maxRetries - 1) {
          logger.info(`[SoraClient] 等待 ${retryInterval}ms 后重试...`)
          await new Promise(resolve => setTimeout(resolve, retryInterval))
        }
      }
    }

    throw new Error(`无法获取视频链接，已重试 ${maxRetries} 次`)
  }

  async textToVideo(prompt, options = {}) {
    const taskId = await this.generateVideo(prompt, options)
    const result = await this.waitForVideo(taskId, options.maxWaitTime, options.pollInterval)
    return result
  }

  async imageToVideo(prompt, imageBuffer, options = {}) {
    const fileId = await this.uploadImage(imageBuffer, options.filename || "image.png")
    const taskId = await this.generateVideo(prompt, { ...options, imageFileId: fileId })
    const result = await this.waitForVideo(taskId, options.maxWaitTime, options.pollInterval)
    return result
  }
}
