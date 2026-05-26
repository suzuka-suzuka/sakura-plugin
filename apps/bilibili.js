import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import setting from "../lib/setting.js";
import { plugindata } from "../lib/path.js";

const FFMPEG_PATH = "ffmpeg";

const MAX_VIDEO_DURATION = 600;
const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";

function getFileSize(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function parseContentRange(header) {
  if (!header) return null;

  const rangeMatch = String(header).match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (rangeMatch) {
    return {
      start: Number(rangeMatch[1]),
      end: Number(rangeMatch[2]),
      total: rangeMatch[3] === "*" ? null : Number(rangeMatch[3]),
    };
  }

  const unsatisfiedMatch = String(header).match(/^bytes\s+\*\/(\d+)$/i);
  if (unsatisfiedMatch) {
    return {
      unsatisfied: true,
      total: Number(unsatisfiedMatch[1]),
    };
  }

  return null;
}

function parseContentLength(header) {
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const TEMP_DIR = path.join(plugindata, "bilibili_temp");

let lastVideoSentTimestamp = 0;

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export class bilibili extends plugin {
  constructor() {
    super({
      name: "Bilibili视频解析",
      event: "message",
      priority: 1135,
    });
  }
  get appconfig() {
    return setting.getConfig("bilicookie");
  }

  handleBiliLink = OnEvent("message", async (e) => {
    if (
      !/(b23.tv|bilibili.com|BV[a-zA-Z0-9]{10})|^#?(b|B站解析)$/i.test(e.msg) &&
      !e.message?.some((s) => s.type === "json")
    ) {
      return false;
    }
      const isCommand = /^#?(b|B站解析)$/i.test(e.msg);
      const autoResolve = this.appconfig.autoResolve !== false;

      if (!isCommand && !autoResolve) {
        return false;
      }

      try {
        let bvId = null;

        if (isCommand) {
          if (e.reply_id) {
            try {
              const msgData = await e.getMsg(e.reply_id);
              const tempE = {
                message: msgData.message,
                msg: msgData.message
                  .filter((s) => s.type === "text")
                  .map((s) => s.data.text)
                  .join(""),
              };
              bvId = await this.extractBvId(tempE);
            } catch (err) {
              logger.warn("获取引用消息失败", err);
            }
          }
        } else {
          bvId = await this.extractBvId(e);
        }

        if (!bvId) {
          return false;
        }

        const videoInfo = await this.getVideoInfo(bvId);
        if (!videoInfo) {
          return false;
        }

        const comments = await this.getComments(videoInfo.aid);

        await this.sendVideoInfoCard(videoInfo, comments, e);

        if (videoInfo.duration > MAX_VIDEO_DURATION) {
          logger.info(
            `视频时长 ${videoInfo.duration} 超过最大限制 ${MAX_VIDEO_DURATION}，跳过发送视频`
          );
          return false;
        }

        const cooldown = 5 * 60 * 1000;
        if (Date.now() - lastVideoSentTimestamp < cooldown) {
          logger.info("视频解析处于冷却中，跳过发送视频。");
          return false;
        }

        const playUrls = await this.getPlayUrls(
          bvId,
          videoInfo.cid,
          videoInfo.duration
        );
        if (!playUrls) {
          logger.warn("获取播放URL失败");
          return false;
        }
        await this.processAndSendVideo(bvId, playUrls, e);
        lastVideoSentTimestamp = Date.now();
      } catch (error) {
        logger.error("处理过程中发生未知错误:", error);
      }

      return true;
    }
  );

  async extractBvId(e) {
    const bvMatch = e.msg.match(/BV([a-zA-Z0-9]{10})/i);
    if (bvMatch) {
      return `BV${bvMatch[1]}`;
    }

    let url = null;
    if (Array.isArray(e.message)) {
      const jsonMessage = e.message.find(
        (msg) => msg.type === "json" && msg.data
      );
      if (jsonMessage) {
        try {
          let jsonData = jsonMessage.data;
          if (typeof jsonData === "object" && jsonData.data) {
            jsonData = jsonData.data;
          }
          const innerJsonData =
            typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;

          const rawUrl = innerJsonData?.meta?.detail_1?.qqdocurl;
          if (rawUrl) {
            url = rawUrl.replace(/\\/g, "");
            logger.info(`从JSON消息提取到URL: ${url}`);
          }
        } catch (error) {
          logger.error("解析JSON消息失败:", error);
        }
      }

      if (!url) {
        for (const msg of e.message) {
          if (msg.type === "text" && msg.text) {
            const genericMatches = msg.text.match(/https?:\/\/\S+/g);
            if (genericMatches && genericMatches.length > 0) {
              for (const candidate of genericMatches) {
                if (
                  candidate.includes("b23.tv") ||
                  candidate.includes("bilibili.com")
                ) {
                  url = candidate;
                  break;
                }
              }
              if (url) break;
            }
          }
        }
      }
    }

    if (!url && e.msg) {
      const genericMatches = e.msg.match(/https?:\/\/\S+/g);
      if (genericMatches && genericMatches.length > 0) {
        for (const candidate of genericMatches) {
          if (
            candidate.includes("b23.tv") ||
            candidate.includes("bilibili.com")
          ) {
            url = candidate;
            break;
          }
        }
      }
    }

    if (!url) {
      return null;
    }

    return await this.getBvIdFromUrl(url);
  }

  async getBvIdFromUrl(url) {
    let bvMatch = url.match(/BV([a-zA-Z0-9]{10})/i);
    if (bvMatch) {
      return `BV${bvMatch[1]}`;
    }

    if (url.includes("b23.tv")) {
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "manual",
        });
        if (response.status === 302 || response.status === 301) {
          const location = response.headers.get("location");
          if (location) {
            return await this.getBvIdFromUrl(location);
          }
        }
      } catch (error) {
        logger.error(`解析短链接 ${url} 失败:`, error);
        return null;
      }
    }

    return null;
  }

  async getVideoInfo(bvId) {
    const BILI_COOKIE = this.appconfig.cookie || "";
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`;
    try {
      const response = await fetch(url, {
        headers: {
          Cookie: BILI_COOKIE,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
          Referer: `https://www.bilibili.com/video/${bvId}`,
        },
      });
      const json = await response.json();
      if (json.code === 0) {
        return json.data;
      }
      logger.error(`API获取视频信息失败: ${json.message}`);
      return null;
    } catch (error) {
      logger.error("请求视频信息API时出错:", error);
      return null;
    }
  }

  async getComments(aid, count = 5) {
    const BILI_COOKIE = this.appconfig.cookie || "";
    const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3`;
    try {
      const response = await fetch(url, { headers: { Cookie: BILI_COOKIE } });
      const json = await response.json();
      if (
        json.code === 0 &&
        json.data.replies &&
        json.data.replies.length > 0
      ) {
        return json.data.replies.slice(0, count);
      }
      logger.warn(`获取评论失败或没有评论: ${json.message || "返回数据为空"}`);
      return null;
    } catch (error) {
      logger.error("请求评论API时出错:", error);
      return null;
    }
  }

  async sendVideoInfoCard(videoInfo, comments, e) {
    try {
      const formatNum = (num) =>
        num > 10000 ? `${(num / 10000).toFixed(1)}万` : num;

      const { title, owner, stat, pic, desc } = videoInfo;

      const infoText = desc
        ? `${desc.substring(0, 200)}${desc.length > 200 ? "..." : ""}`
        : "暂无简介";

      const messages = [];
      const nickname =
        e.sender?.card || e.sender?.nickname || e.user_id.toString();

      messages.push({
        user_id: e.user_id,
        nickname: nickname,
        content: [segment.image(pic), segment.text(infoText)],
      });

      if (comments && comments.length > 0) {
        for (const comment of comments) {
          const content = comment.content.message
            .replace(/\[.*?\]/g, "")
            .trim();
          const hasPictures =
            comment.content.pictures && comment.content.pictures.length > 0;

          if (content || hasPictures) {
            const messageParts = [];
            if (content) {
              messageParts.push(segment.text(content));
            }
            if (hasPictures) {
              comment.content.pictures.forEach((p) =>
                messageParts.push(segment.image(p.img_src))
              );
            }

            if (messageParts.length > 0) {
              messages.push({
                user_id: e.user_id,
                nickname: nickname,
                content: messageParts,
              });
            }
          }
        }
      }

      await e.sendForwardMsg(messages, {
        source: title,
        prompt: "点击查看视频详情",
        news: [
          { text: `UP主: ${owner.name}` },
          { text: `播放: ${formatNum(stat.view)}  弹幕: ${formatNum(stat.danmaku)}` },
          { text: `评论: ${formatNum(stat.reply)}  点赞: ${formatNum(stat.like)}` },
          { text: `投币: ${formatNum(stat.coin)}  收藏: ${formatNum(stat.favorite)}` },
        ],
      });
    } catch (error) {
      logger.error("发送视频信息时出错:", error);
    }
  }

  autoQuality(duration) {
    if (duration <= 120) {
      return 120;
    } else if (duration <= 180) {
      return 112;
    } else if (duration <= 300) {
      return 80;
    } else if (duration <= 480) {
      return 64;
    } else {
      return 32;
    }
  }

  async getPlayUrls(bvId, cid, duration) {
    const BILI_COOKIE = this.appconfig.cookie || "";
    const targetQn = this.autoQuality(duration);
    const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvId}&cid=${cid}&fnval=80`;
    try {
      const response = await fetch(url, {
        headers: {
          Cookie: BILI_COOKIE,
          "User-Agent": USER_AGENT,
          Referer: `https://www.bilibili.com/video/${bvId}`,
          Origin: "https://www.bilibili.com",
          Accept: "application/json, text/plain, */*",
        },
      });

      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        logger.error(
          `API获取播放地址返回非JSON: status=${response.status}, content-type=${response.headers.get("content-type")}, body=${text.slice(0, 300)}`
        );
        return null;
      }

      if (json.code === 0) {
        const dash = json.data?.dash;
        const availableVideos = dash?.video || [];
        const availableAudios = dash?.audio || [];

        if (availableVideos.length === 0 || availableAudios.length === 0) {
          logger.error("API播放地址数据不完整，缺少视频流或音频流");
          return null;
        }

        const availableQns = [
          ...new Set(availableVideos.map((v) => v.id)),
        ].sort((a, b) => b - a);
        let selectedVideo = availableVideos.find((v) => v.id === targetQn);

        if (!selectedVideo) {
          const fallbackQn = availableQns.find((qn) => qn <= targetQn);

          if (fallbackQn) {
            selectedVideo = availableVideos.find((v) => v.id === fallbackQn);
          } else {
            selectedVideo = availableVideos[0];
          }
        }

        if (!selectedVideo?.baseUrl && !selectedVideo?.base_url) {
          logger.error("API播放地址数据不完整，视频流缺少 baseUrl");
          return null;
        }

        const selectedAudio = availableAudios[0];
        if (!selectedAudio?.baseUrl && !selectedAudio?.base_url) {
          logger.error("API播放地址数据不完整，音频流缺少 baseUrl");
          return null;
        }

        logger.info(`目标清晰度: ${targetQn}, 最终选择: ${selectedVideo.id}`);

        return {
          videoUrl: selectedVideo.baseUrl || selectedVideo.base_url,
          audioUrl: selectedAudio.baseUrl || selectedAudio.base_url,
        };
      }
      logger.error(`API获取播放地址失败: code=${json.code}, message=${json.message}`);
      return null;
    } catch (error) {
      logger.error("请求播放地址API时出错:", error);
      return null;
    }
  }

  async processAndSendVideo(bvId, urls, e) {
    const taskId = `${bvId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const videoPath = path.join(TEMP_DIR, `${taskId}_video.m4s`);
    const audioPath = path.join(TEMP_DIR, `${taskId}_audio.m4s`);
    const outputPath = path.join(TEMP_DIR, `${taskId}.mp4`);

    const cleanup = () => {
      [videoPath, audioPath, outputPath].forEach((file) => {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (err) {
          logger.warn(`清理临时文件失败 ${file}: ${err.message || err}`);
        }
      });
    };

    try {
      const downloadResults = await Promise.allSettled([
        this.downloadFile(urls.videoUrl, videoPath, "视频流"),
        this.downloadFile(urls.audioUrl, audioPath, "音频流"),
      ]);

      const failedDownload = downloadResults.find((result) => result.status === "rejected");
      if (failedDownload) {
        throw failedDownload.reason;
      }

      await this.mergeWithFfmpeg(videoPath, audioPath, outputPath);

      await e.reply(segment.video(outputPath));

      // 某些协议端会在 send_group_msg 返回后才继续读取本地文件，
      // 立即删除可能导致视频上传失败，因此延迟清理。
      setTimeout(cleanup, 60_000);
    } catch (error) {
      logger.error(`处理视频 ${bvId} 时出错:`, error);
      try {
        await e.reply("视频下载失败，可能是 B站 CDN 断开、网络波动或 Cookie 失效。", true);
      } catch {
      }
      cleanup();
    }
  }

  async downloadFile(url, destPath, label = "文件") {
    const BILI_COOKIE = this.appconfig.cookie || "";
    let lastError = null;

    for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      let resumeFrom = getFileSize(destPath);

      try {
        const headers = {
          Cookie: BILI_COOKIE,
          "User-Agent": USER_AGENT,
          Referer: "https://www.bilibili.com",
          Origin: "https://www.bilibili.com",
          Accept: "*/*",
          "Accept-Encoding": "identity",
        };

        if (resumeFrom > 0) {
          headers.Range = `bytes=${resumeFrom}-`;
          logger.info(`${label}尝试断点续传: 已下载 ${resumeFrom} bytes`);
        }

        const response = await fetch(url, {
          signal: controller.signal,
          headers,
        });

        if (response.status === 416 && resumeFrom > 0) {
          const contentRange = parseContentRange(response.headers.get("content-range"));
          if (contentRange?.unsatisfied && contentRange.total != null && resumeFrom === contentRange.total) {
            logger.info(`${label}本地临时文件已完整: ${resumeFrom}/${contentRange.total} bytes`);
            return;
          }

          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          } catch {
          }
          throw new Error("断点续传位置无效，已清理临时文件并准备重下");
        }

        if (resumeFrom > 0 && response.status === 200) {
          // 服务器/CDN 忽略 Range 时只能从头重下，否则 append 会得到坏文件。
          logger.warn(`${label}服务器未支持断点续传，本次改为从头下载`);
          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          } catch {
          }
          resumeFrom = 0;
        }

        if (!response.ok) {
          throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("下载失败: 响应体为空");
        }

        const isResume = resumeFrom > 0 && response.status === 206;
        let expectedTotal = null;

        if (isResume) {
          const contentRange = parseContentRange(response.headers.get("content-range"));
          if (!contentRange || contentRange.unsatisfied) {
            throw new Error("断点续传失败: 响应缺少有效 Content-Range");
          }

          if (contentRange.start !== resumeFrom) {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch {
            }
            throw new Error(
              `断点续传位置不匹配: 本地=${resumeFrom}, 服务端=${contentRange.start}`
            );
          }

          expectedTotal = contentRange.total;
        } else {
          const contentLength = parseContentLength(response.headers.get("content-length"));
          expectedTotal = contentLength;
        }

        const readable = Readable.fromWeb(response.body);
        const fileStream = fs.createWriteStream(destPath, {
          flags: isResume ? "a" : "w",
        });

        // pipeline 会监听源/目标流的 error。B站 CDN 断流时，undici 抛出的
        // TypeError: terminated / ECONNRESET 会变成 Promise reject，进入重试逻辑。
        await pipeline(readable, fileStream);

        const finalSize = getFileSize(destPath);
        if (expectedTotal != null && finalSize < expectedTotal) {
          throw new Error(`下载不完整: ${finalSize}/${expectedTotal} bytes`);
        }

        if (isResume) {
          logger.info(`${label}断点续传完成: ${finalSize}${expectedTotal != null ? `/${expectedTotal}` : ""} bytes`);
        }

        return;
      } catch (error) {
        lastError = error;
        const isAbort = error?.name === "AbortError";
        const causeCode = error?.cause?.code;
        const currentSize = getFileSize(destPath);
        logger.warn(
          `${label}下载失败，第 ${attempt}/${DOWNLOAD_RETRIES} 次: ${error?.message || error}${causeCode ? ` (${causeCode})` : ""}，已保留 ${currentSize} bytes 用于续传`
        );

        if (attempt >= DOWNLOAD_RETRIES) {
          throw new Error(
            `${label}下载失败，已重试 ${DOWNLOAD_RETRIES} 次: ${isAbort ? "下载超时" : (error?.message || error)}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error(`${label}下载失败`);
  }

  mergeWithFfmpeg(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
      const command = `"${FFMPEG_PATH}" -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a copy "${outputPath}" -y`;

      exec(command, (error, _, stderr) => {
        if (error) {
          logger.error(`合并失败: ${stderr}`);
          if (stderr.includes("not found") || error.code === 127) {
            return reject(new Error("FFmpeg未找到，请检查路径配置是否正确。"));
          }
          return reject(new Error("视频合并失败，请查看后台日志。"));
        }
        resolve();
      });
    });
  }
}
