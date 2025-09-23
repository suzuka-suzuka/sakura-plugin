import { exec } from "child_process"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import { finished } from "stream/promises"
import setting from "../lib/setting.js"
import { makeForwardMsg } from "../lib/utils.js"

const FFMPEG_PATH = "ffmpeg"

const MAX_VIDEO_DURATION = 600

const TEMP_DIR = path.join(process.cwd(), "data", "bilibili_temp")

let lastVideoSentTimestamp = 0

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true })
}

export class bilibili extends plugin {
  constructor() {
    super({
      name: "Bilibili视频解析",
      dsc: "自动解析B站链接并发送视频",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: /(b23.tv|bilibili.com|BV[a-zA-Z0-9]{10})/i,
          fnc: "handleBiliLink",
          log: false,
        },
      ],
    })
  }
  get appconfig() {
    return setting.getConfig("bilicookie")
  }

  async handleBiliLink(e) {
    this.e = e

    try {
      let bvId = null

      const bvMatch = e.msg.match(/BV([a-zA-Z0-9]{10})/i)
      if (bvMatch) {
        bvId = `BV${bvMatch[1]}`
      } else {
        let url = null
        if (Array.isArray(e.message)) {
          const jsonMessage = e.message.find(msg => msg.type === "json" && msg.data)
          if (jsonMessage) {
            try {
              const innerJsonData = JSON.parse(jsonMessage.data)
              const rawUrl = innerJsonData?.meta?.detail_1?.qqdocurl
              if (rawUrl) {
                url = rawUrl.replace(/\\/g, "")
              }
            } catch (error) {}
          }
        }

        if (!url && e.msg) {
          const urlMatch = e.msg.match(/(https?:\/\/[^\s]+(b23.tv|bilibili.com)[^\s]*)/)
          if (urlMatch) {
            url = urlMatch[0]
          }
        }

        if (!url) {
          return false
        }

        bvId = await this.getBvIdFromUrl(url)
      }

      if (!bvId) {
        logger.warn("未能从链接中提取到有效的BV号")
        return false
      }
      logger.info(`成功解析BV号: ${bvId}`)

      const videoInfo = await this.getVideoInfo(bvId)
      if (!videoInfo) {
        return false
      }

      const comments = await this.getComments(videoInfo.aid)

      await this.sendVideoInfoCard(videoInfo, comments)

      if (videoInfo.duration > MAX_VIDEO_DURATION) {
        return false
      }

      const cooldown = 5 * 60 * 1000
      if (Date.now() - lastVideoSentTimestamp < cooldown) {
        logger.info("视频解析处于冷却中，跳过发送视频。")
        return false
      }

      const playUrls = await this.getPlayUrls(bvId, videoInfo.cid, videoInfo.duration)
      if (!playUrls) {
        return false
      }
      await this.processAndSendVideo(bvId, playUrls)
      lastVideoSentTimestamp = Date.now()
    } catch (error) {
      logger.error("处理过程中发生未知错误:", error)
    }

    return true
  }

  async getBvIdFromUrl(url) {
    let bvMatch = url.match(/BV([a-zA-Z0-9]{10})/i)
    if (bvMatch) {
      return `BV${bvMatch[1]}`
    }

    if (url.includes("b23.tv")) {
      try {
        const response = await fetch(url, { method: "GET", redirect: "manual" })
        if (response.status === 302 || response.status === 301) {
          const location = response.headers.get("location")
          if (location) {
            return await this.getBvIdFromUrl(location)
          }
        }
      } catch (error) {
        logger.error(`解析短链接 ${url} 失败:`, error)
        return null
      }
    }

    return null
  }

  async getVideoInfo(bvId) {
    const BILI_COOKIE = this.appconfig.cookie || ""
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`
    try {
      const response = await fetch(url, {
        headers: {
          Cookie: BILI_COOKIE,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
          Referer: `https://www.bilibili.com/video/${bvId}`,
        },
      })
      const json = await response.json()
      if (json.code === 0) {
        return json.data
      }
      logger.error(`API获取视频信息失败: ${json.message}`)
      return null
    } catch (error) {
      logger.error("请求视频信息API时出错:", error)
      return null
    }
  }

  async getComments(aid, count = 5) {
    const BILI_COOKIE = this.appconfig.cookie || ""
    const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3`
    try {
      const response = await fetch(url, { headers: { Cookie: BILI_COOKIE } })
      const json = await response.json()
      if (json.code === 0 && json.data.replies && json.data.replies.length > 0) {
        return json.data.replies.slice(0, count)
      }
      logger.warn(`获取评论失败或没有评论: ${json.message || "返回数据为空"}`)
      return null
    } catch (error) {
      logger.error("请求评论API时出错:", error)
      return null
    }
  }

  async sendVideoInfoCard(videoInfo, comments) {
    try {
      const formatNum = num => (num > 10000 ? `${(num / 10000).toFixed(1)}万` : num)

      const { title, owner, stat, pic, desc } = videoInfo

      const infoText = [
        `标题：${title}`,
        `UP主：${owner.name}`,
        `播放：${formatNum(stat.view)} | 弹幕：${formatNum(stat.danmaku)} | 评论：${formatNum(stat.reply)}`,
        `点赞：${formatNum(stat.like)} | 投币：${formatNum(stat.coin)} | 收藏：${formatNum(
          stat.favorite,
        )}`,
        ...(desc ? [`简介：${desc.substring(0, 50)}${desc.length > 50 ? "..." : ""}`] : []),
      ].join("\n")

      await this.e.reply([segment.image(pic), infoText])

      if (comments && comments.length > 0) {
        const forwardMessages = []
        for (const comment of comments) {
          const content = comment.content.message.replace(/\[.*?\]/g, "").trim()
          const hasPictures = comment.content.pictures && comment.content.pictures.length > 0

          if (content || hasPictures) {
            const messageParts = []
            if (content) {
              messageParts.push(content)
            }
            if (hasPictures) {
              comment.content.pictures.forEach(p => messageParts.push(segment.image(p.img_src)))
            }

            if (messageParts.length > 0) {
              forwardMessages.push({ text: messageParts, senderId: this.e.user_id })
            }
          }
        }

        if (forwardMessages.length > 0) {
          await makeForwardMsg(this.e, forwardMessages, "热门评论")
        }
      }
    } catch (error) {
      logger.error("发送视频信息时出错:", error)
    }
  }

  autoQuality(duration) {
    if (duration <= 120) {
      return 120
    } else if (duration <= 180) {
      return 112
    } else if (duration <= 300) {
      return 80
    } else if (duration <= 480) {
      return 64
    } else {
      return 32
    }
  }

  async getPlayUrls(bvId, cid, duration) {
    const BILI_COOKIE = this.appconfig.cookie || ""
    const targetQn = this.autoQuality(duration)
    const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvId}&cid=${cid}&fnval=80`
    try {
      const response = await fetch(url, {
        headers: {
          Cookie: BILI_COOKIE,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
          Referer: "https://www.bilibili.com",
        },
      })
      const json = await response.json()
      if (json.code === 0) {
        const dash = json.data.dash
        const availableVideos = dash.video
        const availableQns = [...new Set(availableVideos.map(v => v.id))].sort((a, b) => b - a)
        let selectedVideo = availableVideos.find(v => v.id === targetQn)

        if (!selectedVideo) {
          const fallbackQn = availableQns.find(qn => qn <= targetQn)

          if (fallbackQn) {
            selectedVideo = availableVideos.find(v => v.id === fallbackQn)
          } else {
            selectedVideo = availableVideos[0]
          }
        }

        logger.info(`目标清晰度: ${targetQn}, 最终选择: ${selectedVideo.id}`)

        return {
          videoUrl: selectedVideo.baseUrl,
          audioUrl: dash.audio[0].baseUrl,
        }
      }
      logger.error(`API获取播放地址失败: ${json.message}`)
      return null
    } catch (error) {
      logger.error("请求播放地址API时出错:", error)
      return null
    }
  }

  async processAndSendVideo(bvId, urls) {
    const videoPath = path.join(TEMP_DIR, `${bvId}_video.m4s`)
    const audioPath = path.join(TEMP_DIR, `${bvId}_audio.m4s`)
    const outputPath = path.join(TEMP_DIR, `${bvId}.mp4`)

    const cleanup = () => {
      ;[videoPath, audioPath, outputPath].forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file)
      })
    }

    try {
      await Promise.all([
        this.downloadFile(urls.videoUrl, videoPath),
        this.downloadFile(urls.audioUrl, audioPath),
      ])

      await this.mergeWithFfmpeg(videoPath, audioPath, outputPath)

      await this.reply(segment.video(outputPath))
    } catch (error) {
      logger.error(`处理视频 ${bvId} 时出错:`, error.message)
    } finally {
      cleanup()
    }
  }

  async downloadFile(url, destPath) {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        Referer: "https://www.bilibili.com",
      },
    })
    if (!response.ok) {
      throw new Error(`下载失败: ${response.statusText}`)
    }
    const fileStream = fs.createWriteStream(destPath)
    await finished(Readable.fromWeb(response.body).pipe(fileStream))
  }

  mergeWithFfmpeg(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
      const command = `"${FFMPEG_PATH}" -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a copy "${outputPath}" -y`

      exec(command, (error, _, stderr) => {
        if (error) {
          logger.error(`合并失败: ${stderr}`)
          if (stderr.includes("not found") || error.code === 127) {
            return reject(new Error("FFmpeg未找到，请检查路径配置是否正确。"))
          }
          return reject(new Error("视频合并失败，请查看后台日志。"))
        }
        resolve()
      })
    })
  }
}
