import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AbstractTool } from "./AbstractTool.js";
import Setting from "../../setting.js";
import {
  downloadAudio,
  generateVoxCPMVoice,
  uploadReferenceAudio,
} from "../../voice/VoxCPMClient.js";

const VOXCPM_BASE_URL = "https://openbmb-voxcpm-demo.hf.space";
const VOXCPM_CFG = 2;
const VOXCPM_NORMALIZE = true;
const VOXCPM_DENOISE = false;
const VOXCPM_TIMEOUT_MS = 180000;
const MAX_TEXT_LENGTH = 180;
const DEFAULT_ROLE = {
  name: "默认",
  prompt: "年轻女性，语气自然",
  referenceAudioPath: "",
};

function cleanText(text = "") {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function mimeFromFileName(fileName = "") {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".amr") return "audio/amr";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg" || ext === ".opus") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "audio/wav";
}

function inferFileName(source, fallback = "reference.wav") {
  try {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      return path.basename(url.pathname) || fallback;
    }
  } catch {
  }

  if (typeof source === "string") {
    return path.basename(source) || fallback;
  }

  return fallback;
}

function normalizeRole(role = {}, fallback = DEFAULT_ROLE) {
  const referenceAudioPath = cleanText(role.referenceAudioPath);
  const prompt = cleanText(role.prompt);
  return {
    name: cleanText(role.name) || fallback.name,
    prompt: prompt || (referenceAudioPath ? "" : fallback.prompt),
    referenceAudioPath,
  };
}

function getRoles(config = {}) {
  return Array.isArray(config.roles)
    ? config.roles
      .map((role) => normalizeRole(role, { name: "", prompt: "", referenceAudioPath: "" }))
      .filter((role) => role.name && (role.prompt || role.referenceAudioPath))
    : [];
}

function findRole(config = {}, name = "") {
  const roleName = cleanText(name);
  if (!roleName) {
    return null;
  }

  return getRoles(config).find((role) => role.name === roleName) || null;
}

function getDefaultRole(config = {}) {
  return findRole(config, config.aiDefaultRole);
}

async function fetchBuffer(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const fileName = inferFileName(url);
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName,
      mimeType: response.headers.get("content-type") || mimeFromFileName(fileName),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadAudioSource(source, timeoutMs) {
  if (typeof source !== "string" || !source.trim()) {
    return null;
  }

  const normalized = source.trim();
  if (/^https?:\/\//i.test(normalized)) {
    return fetchBuffer(normalized, timeoutMs);
  }

  if (normalized.startsWith("base64://")) {
    return {
      buffer: Buffer.from(normalized.slice("base64://".length), "base64"),
      fileName: "reference.wav",
      mimeType: "audio/wav",
    };
  }

  let filePath = normalized;
  if (normalized.startsWith("file://")) {
    filePath = fileURLToPath(normalized);
  }

  if (path.isAbsolute(filePath) || fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    const fileName = inferFileName(filePath);
    return {
      buffer,
      fileName,
      mimeType: mimeFromFileName(fileName),
    };
  }

  return null;
}

export class VoxCPMVoiceTool extends AbstractTool {
  name = "SendVoice";

  parameters = {
    properties: {
      text: {
        type: "string",
        description: "要发送成语音的文本，长度不要超过 180 字。",
      },
    },
    required: ["text"],
  };

  description = "当你想用语音消息回复、撒娇、吐槽、表达情绪或把一段话读出来时使用。";

  func = async function (opts, e) {
    const text = cleanText(opts?.text);

    if (!text) {
      return "参数错误：请提供要发送的语音文本。";
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return `文本太长了，当前上限 ${MAX_TEXT_LENGTH} 字。`;
    }

    const config = Setting.getConfig("VoxCPMVoice") || {};
    const role = getDefaultRole(config);
    if (!role) {
      const roleName = cleanText(config.aiDefaultRole) || "未设置";
      return `AI默认语音角色「${roleName}」不存在。`;
    }

    const referenceAudioPath = cleanText(role.referenceAudioPath);
    const voicePrompt = cleanText(role.prompt) || (referenceAudioPath ? "" : DEFAULT_ROLE.prompt);
    let referenceAudio = null;

    try {
      if (referenceAudioPath) {
        try {
          const record = await loadAudioSource(referenceAudioPath, VOXCPM_TIMEOUT_MS);
          if (record) {
            referenceAudio = await uploadReferenceAudio(VOXCPM_BASE_URL, record, {
              timeoutMs: VOXCPM_TIMEOUT_MS,
            });
          }
        } catch (error) {
          logger.warn(`[VoxCPMVoiceTool] 参考语音不可用，改用声音描述生成: ${error.message}`);
        }

        if (!referenceAudio && !voicePrompt) {
          return `语音角色「${role.name}」的参考语音不可用。`;
        }
      }

      const result = await generateVoxCPMVoice({
        baseUrl: VOXCPM_BASE_URL,
        text,
        voicePrompt,
        referenceAudio,
        referenceText: "",
        ultimateClone: false,
        cfg: VOXCPM_CFG,
        normalize: VOXCPM_NORMALIZE,
        denoise: VOXCPM_DENOISE,
        timeoutMs: VOXCPM_TIMEOUT_MS,
      });

      const audioBuffer = await downloadAudio(result.audioUrl, VOXCPM_TIMEOUT_MS);
      await e.reply(segment.record(`base64://${audioBuffer.toString("base64")}`));

      return {
        success: true,
        message: "语音已发送。",
      };
    } catch (error) {
      logger.error(`[VoxCPMVoiceTool] 语音发送失败: ${error.message}`);
      return `语音发送失败：${error.message}`;
    }
  };
}
