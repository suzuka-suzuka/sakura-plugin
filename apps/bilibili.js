import { exec } from "child_process"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import { finished } from "stream/promises"

const BILI_COOKIE = "buvid3=C642B912-5524-5C85-DB35-E8786F3B5FEC55480infoc; b_nut=1755593855; _uuid=8A1C56D3-337C-1F22-B49B-378E4D39AB4653228infoc; bmg_af_switch=1; bmg_src_def_domain=i1.hdslb.com; enable_web_push=DISABLE; buvid_fp=f040d38af3cd27f9568a301e2435b2d0; buvid4=7F76E544-B7C3-292A-12B4-146F70B5082156809-025081916-btpHqvv0d6UVqCmxSBn9Dg%3D%3D; DedeUserID=146086607; DedeUserID__ckMd5=446cc222e0fc12e4; theme-tip-show=SHOWED; theme-avatar-tip-show=SHOWED; rpdid=|(um~J~l~~k|0J'u~lllmJmuu; CURRENT_QUALITY=80; CURRENT_FNVAL=2000; b_lsid=87324D7F_198F37003F8; share_source_origin=QQ; bsource=share_source_qqchat; bili_ticket=eyJhbGciOiJIUzI1NiIsImtpZCI6InMwMyIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NTY2OTAwNjMsImlhdCI6MTc1NjQzMDgwMywicGx0IjotMX0.hfGy-l0sOI9tVBO8m767gTLC_qvFC39JMciy4JMfO7U; bili_ticket_expires=1756690003; bili_jct=3b210a645f1d976a66b17c97b4e3f024; sid=gzu8vqld; home_feed_column=4; browser_resolution=930-748; bp_t_offset_146086607=1106368856596676608"

const FFMPEG_PATH = "ffmpeg"

const MAX_VIDEO_DURATION = 600

const TEMP_DIR = path.join(process.cwd(), "data", "bilibili_temp")

export class bilibili extends plugin {
  constructor() {
    super({
      name: "Bilibili视频解析",
      dsc: "自动解析B站链接并发送视频",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: /(b23.tv|bilibili.com|BV[a-zA-Z0-9]{10})|\[CQ:json,data=.*(bilibili\.com|b23\.tv).*\]/i,
          fnc: "handleBiliLink",
        },
      ],
    })

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
  }

  async handleBiliLink(e) {
    this.e = e

    try {
      let bvId = null

      const bvMatch = e.msg.match(/BV([a-zA-Z0-9]{10})/i)
      if (bvMatch) {
        bvId = `BV${bvMatch[1]}`
        logger.info(`[B站视频解析] 直接从消息中匹配到BV号: ${bvId}`)
      } else {
        let url = null
        if (e.json) {
          try {
            const jsonData = JSON.parse(e.json)
            url = jsonData?.meta?.detail_1?.qqdocurl
          } catch (error) {
            logger.debug("[B站视频解析] JSON解析失败，尝试从原始JSON字符串中正则匹配URL")
            const urlMatchInJson = e.json.match(/"(https?:\\?\/\\?\/[^"]*bilibili\.com[^"]*)"/)
            if (urlMatchInJson && urlMatchInJson[1]) {
              url = urlMatchInJson[1].replace(/\\/g, "")
            }
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

        logger.info(`[B站视频解析] 检测到链接: ${url}`)
        bvId = await this.getBvIdFromUrl(url)
      }

      if (!bvId) {
        logger.warn("[B站视频解析] 未能从链接中提取到有效的BV号")
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

      const playUrls = await this.getPlayUrls(bvId, videoInfo.cid, videoInfo.duration)
      if (!playUrls) {
        return false
      }

      await this.processAndSendVideo(bvId, playUrls)
    } catch (error) {
      logger.error("[B站视频解析] 处理过程中发生未知错误:", error)
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
        logger.error(`[B站视频解析] 解析短链接 ${url} 失败:`, error)
        return null
      }
    }

    return null
  }

  async getVideoInfo(bvId) {
    const url = `http://api.bilibili.com/x/web-interface/view?bvid=${bvId}`
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

  async getComments(aid, count = 3) {
    // 新版评论接口, mode=3 表示按点赞数排序（热门）
    const url = `http://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3`
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
    const formatNum = num => (num > 10000 ? `${(num / 10000).toFixed(1)}万` : num);

    const processedComments = comments ? comments.map(reply => {
        const content = reply.content.message.replace(/\[.*?\]/g, "").trim();
        const pictures = reply.content.pictures ? reply.content.pictures.map(p => p.img_src) : [];
        return {
            uname: reply.member.uname,
            avatar: reply.member.avatar,
            content: content,
            pictures: pictures,
            like: formatNum(reply.like),
        };
    }).filter(c => c.content || c.pictures.length > 0) : [];

    const data = {
        tplFile: path.join(process.cwd(), 'plugins', 'sakura-plugin', 'resources', 'bilibili', 'info.html'),
        pluResPath: path.join(process.cwd(), 'plugins', 'sakura-plugin', 'resources'),
        videoInfo: {
            ...videoInfo,
            stat: {
                view: formatNum(videoInfo.stat.view),
                danmaku: formatNum(videoInfo.stat.danmaku),
                like: formatNum(videoInfo.stat.like),
                coin: formatNum(videoInfo.stat.coin),
                favorite: formatNum(videoInfo.stat.favorite),
            }
        },
        comments: processedComments,
    };

    const img = await puppeteer.screenshot("sakura-plugin-bilibili", data);
    await this.reply(img);
  }

  autoQuality(duration) {
    if (duration <= 180) {
      return 112
    } else if (duration <= 300) {
      return 80
    } else if (duration <= 600) {
      return 64
    } else {
      return 32
    }
  }

  async getPlayUrls(bvId, cid, duration) {
    const targetQn = this.autoQuality(duration)
    logger.info(`[B站视频解析] 根据时长 ${duration}s 自动选择画质代码: ${targetQn}`)
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

        let selectedVideo = availableVideos.find(v => v.id === targetQn)

        if (!selectedVideo) {
          const availableQns = [...new Set(availableVideos.map(v => v.id))].sort((a, b) => b - a)
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

      exec(command, (error, stdout, stderr) => {
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
