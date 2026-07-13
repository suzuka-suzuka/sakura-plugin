import { AbstractTool } from "./AbstractTool.js";
import Setting from "../../setting.js";
import { urlToBase64 } from "../../utils.js";
import { createToolFollowUpResult } from "../toolResultProtocol.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { plugindata } from "../../path.js";
import axios from "axios";
import https from "https";
import { logger } from "../../../../../src/utils/logger.js";
import { Storage } from "@google-cloud/storage";
import {
  createUserContent,
  createPartFromUri,
} from "@google/genai";
import { resolveRouteTarget } from "../providerRouter.js";
import {
  createGeminiClient,
  getVertexAdcFilePath,
  readJsonCredentialFile,
} from "../vertexAuth.js";

const FILE_DOWNLOAD_DIR = path.join(plugindata, "message-files");
const DEFAULT_GCS_PREFIX = "sakura-message-videos";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFileName(fileName = "") {
  const normalized = String(fileName || "").trim();
  const safeName = normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return safeName || `file_${Date.now()}`;
}

function buildDownloadPath(originalName) {
  const safeName = sanitizeFileName(originalName);
  const ext = path.extname(safeName);
  const baseName = ext ? safeName.slice(0, -ext.length) : safeName;
  return path.join(FILE_DOWNLOAD_DIR, `${baseName}_${Date.now()}${ext}`);
}

function pickFileName(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function resolveDownloadSource(source) {
  if (typeof source !== "string" || !source.trim()) {
    return null;
  }

  const normalized = source.trim();

  if (/^https?:\/\//i.test(normalized)) {
    return { type: "remote", value: normalized };
  }

  if (normalized.startsWith("file://")) {
    try {
      return { type: "local", value: fileURLToPath(normalized) };
    } catch {
      return null;
    }
  }

  if (normalized.startsWith("base64://")) {
    return {
      type: "base64",
      value: normalized.slice("base64://".length),
    };
  }

  if (path.isAbsolute(normalized) || fs.existsSync(normalized)) {
    return { type: "local", value: normalized };
  }

  return null;
}

function resolveGcsTarget(config = {}) {
  const rawBucket = pickFileName(
    config.gcsBucket,
    config.gcs_bucket,
    config.storageBucket,
    config.bucket
  );

  if (!rawBucket) {
    throw new Error("Vertex 视频分析需要在 AI 配置中填写 gcsBucket。");
  }

  let bucketName = rawBucket.trim();
  let bucketPrefix = "";

  if (/^gs:\/\//i.test(bucketName)) {
    const withoutScheme = bucketName.replace(/^gs:\/\//i, "");
    const slashIndex = withoutScheme.indexOf("/");
    bucketName = slashIndex >= 0 ? withoutScheme.slice(0, slashIndex) : withoutScheme;
    bucketPrefix = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : "";
  }

  bucketName = bucketName.replace(/^\/+|\/+$/g, "");

  const prefix = String(
    config.gcsPrefix || config.gcs_prefix || bucketPrefix || DEFAULT_GCS_PREFIX
  )
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return {
    bucketName,
    prefix: prefix || DEFAULT_GCS_PREFIX,
  };
}

function createStorageClient(config = {}) {
  const keyFilename = getVertexAdcFilePath(config);
  const credentials = readJsonCredentialFile(keyFilename);
  const projectId =
    config.gcsProjectId ||
    config.project ||
    config.vertexProject ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    credentials?.project_id;
  const options = {};

  if (keyFilename) {
    options.keyFilename = keyFilename;
  }

  if (projectId) {
    options.projectId = projectId;
  }

  return new Storage(options);
}

async function uploadVideoToGcs(localVideoPath, config) {
  const storage = createStorageClient(config);
  const { bucketName, prefix } = resolveGcsTarget(config);
  const objectName = `${prefix}/video_${Date.now()}_${randomUUID()}.mp4`;

  await storage.bucket(bucketName).upload(localVideoPath, {
    destination: objectName,
    resumable: false,
    metadata: {
      contentType: "video/mp4",
      cacheControl: "private, max-age=0",
    },
  });

  return {
    storage,
    bucketName,
    objectName,
    uri: `gs://${bucketName}/${objectName}`,
  };
}

async function deleteGcsUpload(uploadedFile) {
  if (!uploadedFile) return;

  try {
    await uploadedFile.storage
      .bucket(uploadedFile.bucketName)
      .file(uploadedFile.objectName)
      .delete({ ignoreNotFound: true });
  } catch (error) {
    if (error?.code !== 404) {
      logger.warn(`[MessageContentAnalyzer] Failed to delete GCS temp video: ${error.message}`);
    }
  }
}

export class MessageContentAnalyzerTool extends AbstractTool {
  name = "messageContentAnalyzer";

  parameters = {
    properties: {
      seq: {
        type: "array",
        items: {
          type: "integer",
        },
        description: "需操作的消息seq",
      },
      url: {
        type: "array",
        items: {
          type: "string",
        },
        description: "图片或视频的URL",
      },
      type: {
        type: "string",
        enum: ["image", "video", "forward", "file", "recall", "essence", "unessence"],
        description:
          "需要操作的类型：image(图片), video(视频), forward(聊天记录), file(下载文件), recall(撤回消息), essence(设为精华), unessence(取消精华)",
      },
      query: {
        type: "string",
        description:
          "可选。分析图片时用于指定关注的问题，省略时使用通用图片描述；分析视频时必填",
      },
    },
    required: ["type"],
  };

  description =
    "提取或分析图片、分析视频，或通过seq下载文件/撤回/加精/取消加精消息。"
      + "调用image时提供seq或url即可，query可选；系统会自动选择将图片放入下一次AI输入或在工具内识图";

  func = async function (opts, e, executionContext = {}) {
    let { seq, url, type, query } = opts;

    if (!seq && !url) return "需提供seq或url。";
    if (seq && typeof seq === "number") seq = [seq];
    if (url && typeof url === "string") url = [url];

    const hasQuery = typeof query === "string" && query.trim().length > 0;
    if (type === "video" && !hasQuery) {
      return "分析视频需提供query。";
    }

    if (
      (type === "video" || type === "forward") &&
      ((seq && seq.length > 1) || (url && url.length > 1))
    ) {
      return `${type}仅支持单条分析。`;
    }

    if (url && url.length > 0) {
      if (type === "image") {
        return await this.processImages(url, query, executionContext);
      } else if (type === "video") {
        return await this.processVideo(url[0], query, e);
      } else {
        return "URL仅支持image/video分析。";
      }
    }

    if (["recall", "essence", "unessence"].includes(type)) {
      let successCount = 0;
      let failCount = 0;

      for (const s of seq) {
        try {
          if (type === "recall") {
            await e.recall(s);
          } else if (type === "essence") {
            await e.bot.setEssenceMsg({ message_id: s });
          } else if (type === "unessence") {
            await e.bot.deleteEssenceMsg({ message_id: s });
          }
          successCount++;
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          logger.error(`操作消息 ${s} 失败: ${err}`);
          failCount++;
        }
      }
      return `操作完成。成功${successCount},失败${failCount}。`;
    }

    let targetMsgs = [];
    for (const s of seq) {
      try {
        const msg = await e.getMsg(s);
        if (msg) {
          targetMsgs.push(msg);
        } else {
          logger.warn(`未找到 seq: ${s} 的消息`);
        }
      } catch (err) {
        logger.error(`获取消息 seq: ${s} 失败: ${err}`);
      }
    }

    if (targetMsgs.length === 0) {
      return "未找到有效消息。";
    }

    if (["image", "video", "forward","file"].includes(type)) {
      for (const msg of targetMsgs) {
        await e.react(128076, msg.message_id);
      }
    }

    let imgUrls = [];
    let videoUrl = null;
    let forwardResid = null;
    const fileEntries = [];

    for (const targetMsg of targetMsgs) {
      for (const msgPart of targetMsg.message) {
        if (type === "image" && msgPart.type === "image") {
          imgUrls.push(msgPart.data?.url);
        } else if (type === "video" && msgPart.type === "video") {
          videoUrl = msgPart.data?.url;

          if (videoUrl) break;
        } else if (type === "forward") {
          if (msgPart.type === "json") {
            try {
              const data = JSON.parse(msgPart.data?.data);
              if (data?.meta?.detail?.resid) {
                forwardResid = data.meta.detail.resid;
              }
            } catch (e) { }
          } else if (msgPart.type === "forward") {
            forwardResid = msgPart.data?.id || msgPart.data?.resid;
          }
          if (forwardResid) break;
        } else if (type === "file" && msgPart.type === "file") {
          fileEntries.push({
            fileId: msgPart.data?.file_id,
            fileName: msgPart.data?.name || "",
            size: msgPart.data?.size ?? 0,
            messageId: targetMsg.message_id || targetMsg.message_seq,
            groupId: targetMsg.group_id,
            userId: targetMsg.user_id,
          });
        }
      }
      if (
        (type === "video" && videoUrl) ||
        (type === "forward" && forwardResid)
      ) {
        break;
      }
    }

    if (type === "video") {
      if (videoUrl) return await this.processVideo(videoUrl, query, e);
      return "未找到视频。";
    }

    if (type === "image") {
      if (imgUrls.length > 0)
        return await this.processImages(imgUrls, query, executionContext);
      return "未找到图片。";
    }

    if (type === "forward") {
      if (forwardResid)
        return await this.processForwardMsg(forwardResid, query, e);
      return "未找到转发记录。";
    }

    if (type === "file") {
      if (fileEntries.length > 0) {
        return await this.processFiles(fileEntries, e);
      }
      return "未找到文件消息。";
    }

    return "未知类型。";
  };

  async processFiles(fileEntries, e) {
    ensureDir(FILE_DOWNLOAD_DIR);
    const resultLines = [];

    for (const entry of fileEntries) {
      if (!entry.fileId) {
        resultLines.push(`消息 ${entry.messageId || "未知"} 缺少 file_id，无法下载。`);
        continue;
      }

      try {
        let fileMeta = null;
        try {
          const rawMeta =
            typeof e.bot?.getFile === "function"
              ? await e.bot.getFile({ file_id: entry.fileId })
              : await e.bot?.sendRequest?.("get_file", { file_id: entry.fileId });
          fileMeta = rawMeta?.data || rawMeta || null;
        } catch (metaError) {
          logger.warn(`[MessageContentAnalyzer] 获取文件元信息失败: ${entry.fileId} ${metaError.message}`);
        }

        const resolvedFileName =
          pickFileName(
            entry.fileName,
            fileMeta?.file_name,
            fileMeta?.name,
            fileMeta?.filename
          ) || "未命名文件";

        let downloadSource = "";

        // 群文件优先走群文件下载接口，保持原有稳定行为；get_file 主要用于补文件名等元信息
        if (entry.groupId) {
          const fileUrlResp = await e.bot.getGroupFileUrl({
            group_id: entry.groupId,
            file_id: entry.fileId,
          });
          downloadSource = fileUrlResp?.url || fileUrlResp?.download_url || "";
        }

        if (!downloadSource) {
          downloadSource =
            fileMeta?.url ||
            fileMeta?.file ||
            "";
        }

        const resolvedSource = resolveDownloadSource(downloadSource);

        if (!resolvedSource) {
          resultLines.push(`文件 ${resolvedFileName} 获取下载链接失败。`);
          continue;
        }

        const localPath = buildDownloadPath(resolvedFileName);
        if (resolvedSource.type === "remote") {
          const writer = fs.createWriteStream(localPath);
          const response = await axios({
            method: "GET",
            url: resolvedSource.value,
            responseType: "stream",
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          });

          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
          });
        } else if (resolvedSource.type === "local") {
          fs.copyFileSync(resolvedSource.value, localPath);
        } else if (resolvedSource.type === "base64") {
          fs.writeFileSync(localPath, Buffer.from(resolvedSource.value, "base64"));
        }

        const stat = fs.statSync(localPath);
        resultLines.push(
          [
            "文件下载成功",
            `local_path=${localPath}`,
          ].join("\n")
        );
      } catch (error) {
        const displayName = entry.fileName || entry.fileId || "未命名文件";
        logger.error(`[MessageContentAnalyzer] 文件下载失败: ${displayName} ${error.message}`);
        resultLines.push(`文件 ${displayName} 下载失败: ${error.message}`);
      }
    }

    return resultLines.join("\n\n");
  }

  async processImages(imgUrls, question, executionContext = {}) {
    try {
      const normalizedQuestion = typeof question === "string"
        ? question.trim()
        : "";
      const analysisQuestion = normalizedQuestion
        || "请详细描述图片内容，并提取对当前对话可能有用的关键信息。";

      const imageParts = [];

      for (const imgUrl of imgUrls) {
        if (typeof imgUrl !== "string" || imgUrl.trim() === "") {
          continue;
        }

        const result = await urlToBase64(imgUrl);
        if (result) {
          imageParts.push({
            inlineData: {
              mimeType: result.mimeType,
              data: result.base64,
            },
          });
        } else {
          logger.warn(`从 URL 获取图片失败: ${imgUrl}`);
        }
      }

      if (imageParts.length === 0) {
        return "获取图片失败。";
      }

      if (executionContext.supportsImageInput === false) {
        if (typeof executionContext.analyzeImages !== "function") {
          return "当前模型不支持图片输入，且未配置可用的工具识图回调。";
        }

        const analysisResult = await executionContext.analyzeImages([
          { text: analysisQuestion },
          ...imageParts,
        ]);
        if (typeof analysisResult === "object" && analysisResult?.text) {
          return analysisResult.text;
        }
        return analysisResult;
      }

      return createToolFollowUpResult(
        {
          message:
            `已提取 ${imageParts.length} 张图片，并作为临时多模态输入放入下一次AI请求。`
            + "本工具未分析图片内容，请在下一次请求中直接查看图片后继续回答。",
        },
        imageParts
      );
    } catch (err) {
      logger.error(`提取图片失败: ${err}`);
      return `提取图片错误: ${err.message}`;
    }
  }

  async processVideo(videoTarget, query, e) {
    const aiConfig = Setting.getConfig("AI") || {};
    const resolved = resolveRouteTarget(aiConfig.toolsRoute, { selfId: e?.self_id });
    const Config = resolved?.requestConfig;

    if (!Config || Config.channelType !== "gemini" || !Config.model) {
      throw new Error(
        "配置错误：toolsRoute 必须解析到有效的 Gemini 目标。"
      );
    }

    const GEMINI_MODEL = Config.model;
    const ai = createGeminiClient(Config);

    let localVideoPath = null;
    let uploadedGcsFile = null;
    let isTempFile = false;

    try {
      const downloadDir = path.join(plugindata, "video");
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      const response = await axios({
        method: "GET",
        url: videoTarget,
        responseType: "stream",
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });

      const fileName = `video_${Date.now()}.mp4`;
      localVideoPath = path.join(downloadDir, fileName);
      const writer = fs.createWriteStream(localVideoPath);

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      isTempFile = true;

      let videoPart;

      if (Config.vertex === true) {
        uploadedGcsFile = await uploadVideoToGcs(localVideoPath, {
          ...Config,
          gcsBucket: aiConfig.gcsBucket,
          gcsPrefix: aiConfig.gcsPrefix,
        });
        videoPart = createPartFromUri(uploadedGcsFile.uri, "video/mp4");
      } else {
        const myfile = await ai.files.upload({
          file: localVideoPath,
          config: { mimeType: "video/mp4" },
        });

        await new Promise((resolve) => setTimeout(resolve, 10000));
        videoPart = createPartFromUri(myfile.uri, myfile.mimeType);
      }

      const aiResponse = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: createUserContent([videoPart, query]),
      });

      const description = aiResponse.text;
      return description ? description : "未获取到描述。";
    } catch (error) {
      logger.error("Video analysis error:", error);
      return `视频分析失败: ${error.message}`;
    } finally {
      await deleteGcsUpload(uploadedGcsFile);
      if (isTempFile && localVideoPath && fs.existsSync(localVideoPath)) {
        fs.unlinkSync(localVideoPath);
      }
    }
  }

  async processForwardMsg(resid, query, e) {
    try {
      const forwardMsg = await e.bot.getForwardMsg({ message_id: resid });

      if (!forwardMsg || !forwardMsg.messages) {
        return "无法获取转发内容。";
      }

      let contentStr = "";

      for (const msg of forwardMsg.messages) {
        const date = new Date(msg.time * 1000);
        const timeStr = date.toLocaleTimeString("zh-CN", { hour12: false });

        const nickname =
          msg.nickname ||
          msg.sender?.nickname ||
          msg.sender?.card ||
          "未知用户";
        const userId = msg.user_id || msg.sender?.user_id || 0;

        let messageHeader = `【${nickname}】(QQ:${userId}, 时间:${timeStr})`;

        let contentParts = [];
        if (Array.isArray(msg.message)) {
          for (const msgPart of msg.message) {
            switch (msgPart.type) {
              case "text":
                contentParts.push(msgPart.data?.text || "");
                break;
              case "at":
                contentParts.push(`@${msgPart.data?.qq}`);
                break;
              case "image": {
                const imageUrl = msgPart.data?.url;
                const isAnimated = msgPart.data?.sub_type === 1;
                contentParts.push(
                  isAnimated
                    ? `[动画表情URL:${imageUrl}]`
                    : `[图片URL:${imageUrl}]`
                );
                break;
              }
              case "video": {
                const vidUrl = msgPart.data?.url;
                contentParts.push(vidUrl ? `[视频URL:${vidUrl}]` : `[视频]`);
                break;
              }
              case "forward":
                contentParts.push("[聊天记录]");
                break;
              case "json":
                try {
                  const jsonData = JSON.parse(msgPart.data?.data);
                  if (
                    jsonData.desc === "[聊天记录]" ||
                    jsonData.prompt === "[聊天记录]"
                  ) {
                    contentParts.push("[聊天记录]");
                  } else {
                    contentParts.push("[JSON卡片]");
                  }
                } catch (e) {
                  contentParts.push("[JSON卡片]");
                }
                break;
            }
          }
        }
        if (contentParts.length > 0) {
          contentStr += `${messageHeader}: ${contentParts.join("")}\n`;
        }
      }

      if (
        contentStr.includes("[视频URL:") ||
        contentStr.includes("[图片URL:")
      ) {
        contentStr += "\n\n提示：分析其中图片/视频请用url参数。";
      }

      return contentStr;
    } catch (err) {
      logger.error(`处理转发消息失败: ${err}`);
      return `处理转发消息错误: ${err.message}`;
    }
  }
}
