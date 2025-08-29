import { exec } from "child_process"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import { finished } from "stream/promises"
import setting from "../lib/setting.js"

const FFMPEG_PATH = "ffmpeg"

const MAX_VIDEO_DURATION = 600

const TEMP_DIR = path.join(process.cwd(), "data", "bilibili_temp")

const cd = new Map()

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
          reg: "",
          fnc: "handleBiliLink",
          log: false,
        },
      ],
    })
  }
  get appconfig() {
    return setting.getConfig("bilicookie")
  }

  async dealUrl(e) {
    const standaloneBvMatch = e.msg.match(/BV[a-zA-Z0-9]{10}/i)
    if (standaloneBvMatch) {
      return standaloneBvMatch[0]
    }

    let url = null
    const urllist = ["b23.tv", "b22.tv", "m.bilibili.com", "www.bilibili.com"]
    const domainReg = new RegExp(urllist.join("|"))

    if (e.json) {
      const jsonString = e.json
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&amp;/g, "&")
      try {
        const json = JSON.parse(jsonString)
        url = json.meta?.detail_1?.qqdocurl || json.meta?.news?.jumpUrl
      } catch (error) {
        const urlMatchInJson = jsonString.match(
          /"(https?:\\?\/\\?\/[^"]*(bilibili\.com|b23\.tv)[^"]*)"/,
        )
        if (urlMatchInJson && urlMatchInJson[1]) {
          url = urlMatchInJson[1].replace(/\\/g, "")
        }
      }
    }

    if (!url && e.msg) {
      const urlMatch = e.msg.match(/(https?:\/\/[^\s]+)/)
      if (urlMatch) {
        url = urlMatch[0]
      }
    }

    if (!url || !url.match(domainReg)) {
      return false
    }

    const bvReg = /(BV[a-zA-Z0-9]{10})/
    let bvMatch = url.match(bvReg)

    if (bvMatch) {
      return bvMatch[0]
    }

    try {
      const response = await fetch(url, { method: "GET", redirect: "manual" })
      if (response.status === 302 || response.status === 301) {
        const location = response.headers.get("location")
        if (location) {
          const finalBvMatch = location.match(bvReg)
          if (finalBvMatch) {
            return finalBvMatch[0]
          }
        }
      }
    } catch (error) {
      logger.error(`[B站视频解析] 解析短链接 ${url} 失败:`, error)
      return null
    }

    return null
  }

  async handleBiliLink(e) {
    this.e = e

    try {
      const bvId = await this.dealUrl(e)

      if (!bvId) {
        return false
      }

      logger.info(`[B站视频解析] 成功解析BV号: ${bvId}`)

      const videoInfo = await this.getVideoInfo(bvId)
      if (!videoInfo) {
        return false
      }

      const comments = await this.getComments(videoInfo.aid)

      await this.sendVideoInfoCard(videoInfo, comments)

      if (videoInfo.duration > MAX_VIDEO_DURATION) {
        return false
      }

      if (this.e.isGroup) {
        const groupId = this.e.group_id
        const lastSent = cd.get(groupId)
        const cooldown = 5 * 60 * 1000

        if (lastSent && Date.now() - lastSent < cooldown) {
          return false
        }
      }

      const playUrls = await this.getPlayUrls(bvId, videoInfo.cid, videoInfo.duration)
      if (!playUrls) {
        return false
      }

      await this.processAndSendVideo(bvId, playUrls)

      if (this.e.isGroup) {
        cd.set(this.e.group_id, Date.now())
      }
    } catch (error) {
      logger.error("[B站视频解析] 处理过程中发生未知错误:", error)
    }

    return true
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
      logger.error(`[B站视频解析] API获取视频信息失败: ${json.message}`)
      return null
    } catch (error) {
      logger.error("[B站视频解析] 请求视频信息API时出错:", error)
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
      logger.warn(`[B站视频解析] 获取评论失败或没有评论: ${json.message || "返回数据为空"}`)
      return null
    } catch (error) {
      logger.error("[B站视频解析] 请求评论API时出错:", error)
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
        `播放：${formatNum(stat.view)} | 弹幕：${formatNum(stat.danmaku)}`,
        `点赞：${formatNum(stat.like)} | 投币：${formatNum(stat.coin)} | 收藏：${formatNum(
          stat.favorite,
        )}`,
        ...(desc ? [`简介：${desc.substring(0, 150)}${desc.length > 150 ? "..." : ""}`] : []),
      ].join("\n")

      await this.e.reply([segment.image(pic), infoText])

      if (comments && comments.length > 0) {
        const allComments = []
        for (const comment of comments) {
          const content = comment.content.message.replace(/\[.*?\]/g, "").trim()
          const hasPictures = comment.content.pictures && comment.content.pictures.length > 0

          if (content || hasPictures) {
            const text =
              (allComments.length > 0 ? "\n\n" : "") + `${comment.member.uname}: ${content}`
            allComments.push(text)

            if (hasPictures) {
              comment.content.pictures.forEach(p => allComments.push(segment.image(p.img_src)))
            }
          }
        }

        if (allComments.length > 0) {
          await this.e.reply(["热门评论：\n\n", ...allComments])
        }
      }
    } catch (error) {
      logger.error("[B站视频解析] 发送视频信息时出错:", error)
      await this.reply("发送B站视频信息失败，请查看后台日志。")
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

        logger.info(`[B站视频解析] 目标清晰度: ${targetQn}, 最终选择: ${selectedVideo.id}`)

        return {
          videoUrl: selectedVideo.baseUrl,
          audioUrl: dash.audio[0].baseUrl,
        }
      }
      logger.error(`[B站视频解析] API获取播放地址失败: ${json.message}`)
      return null
    } catch (error) {
      logger.error("[B站视频解析] 请求播放地址API时出错:", error)
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
      logger.info(`[B站视频解析] ${bvId} 音视频下载完成`)

      await this.mergeWithFfmpeg(videoPath, audioPath, outputPath)
      logger.info(`[B站视频解析] ${bvId} 视频合并完成`)

      await this.reply(segment.video(outputPath))
      logger.info(`[B站视频解析] ${bvId} 视频发送成功`)
    } catch (error) {
      logger.error(`[B站视频解析] 处理视频 ${bvId} 时出错:`, error.message)
      await this.reply(`处理视频时出错：${error.message}`)
    } finally {
      cleanup()
      logger.info(`[B站视频解析] ${bvId} 临时文件清理完毕`)
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
          logger.error(`[FFmpeg] 合并失败: ${stderr}`)
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
