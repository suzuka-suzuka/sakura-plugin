import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Setting from "../lib/setting.js";
import { originalPluginRoot } from "../lib/path.js";
import {
  downloadAudio,
  generateVoxCPMVoice,
  uploadReferenceAudio,
} from "../lib/voice/VoxCPMClient.js";

const COMMAND_REG = /^#?(?:(\S{1,40})?说)\s+(\S[\s\S]*)$/u;
const ADD_ROLE_REG = /^#?添加语音(?:角色)?\s*(\S{1,40})(?:\s+([\s\S]+))?$/u;
const DELETE_ROLE_REG = /^#?删除语音(?:角色)?\s*(.{1,40})$/u;
const LIST_ROLE_REG = /^#?语音角色列表$/u;
const VOXCPM_BASE_URL = "https://openbmb-voxcpm-demo.hf.space";
const VOXCPM_CFG = 2;
const VOXCPM_NORMALIZE = true;
const VOXCPM_DENOISE = false;
const VOXCPM_TIMEOUT_MS = 180000;
const MAX_TEXT_LENGTH = 180;
const MAX_REFERENCE_AUDIO_SECONDS = 30;
const DEFAULT_ROLE = {
  name: "默认",
  prompt: "年轻女性，语气自然",
  referenceAudioPath: "",
};
const ROLE_AUDIO_DIR = path.join(originalPluginRoot, "data", "voxcpm-voice", "roles");

function cleanText(text = "") {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function sanitizeRoleName(name = "") {
  return cleanText(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

function ensureRoleAudioDir() {
  if (!fs.existsSync(ROLE_AUDIO_DIR)) {
    fs.mkdirSync(ROLE_AUDIO_DIR, { recursive: true });
  }
}

function removeRoleAudioFile(filePath) {
  if (!filePath) {
    return;
  }

  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(ROLE_AUDIO_DIR);
  if (!resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
    return;
  }

  if (fs.existsSync(resolvedFile)) {
    fs.rmSync(resolvedFile, { force: true });
  }
}

function inferFileName(source, fallback = "reference.wav") {
  try {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      const name = path.basename(url.pathname);
      return name || fallback;
    }
  } catch {
  }

  if (typeof source === "string") {
    const name = path.basename(source);
    return name || fallback;
  }

  return fallback;
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

function isAudioFileName(fileName = "") {
  return /\.(amr|wav|mp3|m4a|ogg|opus|flac)$/i.test(String(fileName || ""));
}

function detectAudioExt(buffer, fallbackExt = ".wav") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return fallbackExt;
  }

  const header = buffer.subarray(0, 12).toString("ascii");
  if (header.startsWith("#!AMR")) return ".amr";
  if (header.startsWith("RIFF")) return ".wav";
  if (header.startsWith("ID3") || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return ".mp3";
  if (header.startsWith("OggS")) return ".ogg";
  if (header.startsWith("fLaC")) return ".flac";
  return fallbackExt;
}

function convertToWav(inputPath, outputPath) {
  const result = spawnSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ], {
    encoding: "utf8",
  });

  return result.status === 0 && fs.existsSync(outputPath);
}

function getAudioDurationSeconds(filePath) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return NaN;
  }

  return Number.parseFloat(String(result.stdout || "").trim());
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) {
    return "未知";
  }
  return `${value.toFixed(1).replace(/\.0$/, "")} 秒`;
}

function escapeConcatPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/").replace(/'/g, "'\\''");
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

export class VoxCPMVoice extends plugin {
  constructor() {
    super({
      name: "VoxCPM语音生成",
      event: "message",
      priority: 1135,
      configWatch: "VoxCPMVoice",
    });
  }

  get config() {
    return Setting.getConfig("VoxCPMVoice") || {};
  }

  get roles() {
    return Array.isArray(this.config.roles)
      ? this.config.roles.filter((role) =>
        cleanText(role?.name) &&
        (cleanText(role?.prompt) || cleanText(role?.referenceAudioPath))
      )
      : [];
  }

  get defaultRole() {
    return this.findRole(this.config.defaultRole);
  }

  get aiDefaultRole() {
    return this.findRole(this.config.aiDefaultRole);
  }

  findRole(name) {
    const roleName = cleanText(name);
    if (!roleName) {
      return null;
    }

    return this.roles.find((role) => cleanText(role.name) === roleName) || null;
  }

  saveRoles(roles) {
    const currentConfig = this.config;
    return Setting.setConfig("VoxCPMVoice", {
      ...currentConfig,
      roles,
    });
  }

  upsertRole(nextRole) {
    const roleName = cleanText(nextRole.name);
    const previousRole = this.findRole(roleName);
    const previousAudioPath = cleanText(previousRole?.referenceAudioPath);
    const nextAudioPath = cleanText(nextRole.referenceAudioPath);
    const roles = this.roles.filter((role) => cleanText(role.name) !== roleName);
    roles.push({
      name: roleName,
      prompt: cleanText(nextRole.prompt),
      referenceAudioPath: nextAudioPath,
    });
    const saved = this.saveRoles(roles);

    if (
      saved &&
      previousAudioPath &&
      previousAudioPath !== nextAudioPath
    ) {
      removeRoleAudioFile(previousAudioPath);
    }

    return saved;
  }

  parseRequest(e) {
    const commandMatch = COMMAND_REG.exec(e.msg || "");
    let voicePrompt = "";
    let text = "";
    let hasReferenceAudio = false;
    let roleName = "";
    let referenceAudioPath = "";

    if (!commandMatch) {
      return null;
    }

    const requestedRoleName = cleanText(commandMatch[1]);
    text = cleanText(commandMatch[2]);

    if (requestedRoleName) {
      const role = this.findRole(requestedRoleName);
      if (!role) {
        return null;
      }
      roleName = cleanText(role.name);
      referenceAudioPath = cleanText(role.referenceAudioPath);
      hasReferenceAudio = Boolean(referenceAudioPath);
      voicePrompt = cleanText(role.prompt) || (hasReferenceAudio ? "" : DEFAULT_ROLE.prompt);
    } else {
      const role = this.defaultRole;
      if (!role) {
        return null;
      }
      roleName = cleanText(role.name);
      referenceAudioPath = cleanText(role.referenceAudioPath);
      hasReferenceAudio = Boolean(referenceAudioPath);
      voicePrompt = cleanText(role.prompt) || (hasReferenceAudio ? "" : DEFAULT_ROLE.prompt);
    }

    return {
      text,
      roleName,
      voicePrompt,
      hasReferenceAudio,
      referenceAudioPath,
      tooLong: text.length > MAX_TEXT_LENGTH,
      maxTextLength: MAX_TEXT_LENGTH,
    };
  }

  preflightGenerateVoice(e) {
    const request = this.parseRequest(e);
    if (!request || !request.text) {
      return false;
    }

    e._voxCPMRequest = request;
    return {
      accepted: true,
      command: "语音生成",
      charge: !request.tooLong,
      refundOnFalse: true,
    };
  }

  generateVoice = Command(COMMAND_REG, {
    economy: {
      command: "语音生成",
      preflight: "preflightGenerateVoice",
      refundOnFalse: true,
    },
  }, async (e) => {
    const request = e._voxCPMRequest || this.parseRequest(e);
    if (!request || !request.text) {
      return false;
    }

    if (request.tooLong) {
      await e.reply(`文本太长了，当前上限 ${request.maxTextLength} 字。`, 10, false);
      return true;
    }

    await e.react(124);

    try {
      let referenceAudio = null;
      if (request.hasReferenceAudio) {
        try {
          const record = request.referenceAudioPath
            ? await this.loadAudioSource(request.referenceAudioPath, VOXCPM_TIMEOUT_MS)
            : null;
          if (record) {
            referenceAudio = await uploadReferenceAudio(VOXCPM_BASE_URL, record, {
              timeoutMs: VOXCPM_TIMEOUT_MS,
            });
          }
        } catch (error) {
          logger.warn(`[VoxCPMVoice] 参考语音不可用，改用声音描述生成: ${error.message}`);
        }
      }

      const result = await generateVoxCPMVoice({
        baseUrl: VOXCPM_BASE_URL,
        text: request.text,
        voicePrompt: request.voicePrompt,
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
    } catch (error) {
      logger.error(`[VoxCPMVoice] 语音生成失败: ${error.message}`);
      await e.reply(`语音生成失败: ${error.message}`, 10, true);
    }

    return true;
  });

  addVoiceRole = Command(ADD_ROLE_REG, async (e) => {
    const match = ADD_ROLE_REG.exec(e.msg || "");
    const roleName = cleanText(match?.[1]);
    const prompt = cleanText(match?.[2]);
    if (!roleName) {
      return false;
    }

    this.setContext("handleAddVoiceRole", !!e.group_id, 60, true, {
      roleName,
      prompt,
      audioParts: [],
      totalDuration: 0,
    });

    await e.reply(
      prompt
        ? `已收到「${roleName}」的声音描述。可连续发送多条语音/音频文件，发送「完成」保存；不需要参考语音发送「跳过」。`
        : `请连续发送一条或多条语音/音频文件作为「${roleName}」的固定参考音色，发送「完成」保存；发送「跳过」取消。`,
      60,
      false
    );
    return true;
  });

  handleAddVoiceRole = async (e) => {
    if (e.post_type !== "message") {
      return;
    }

    const context = this.getContext("handleAddVoiceRole", !!e.group_id);
    const data = context?.data || {};
    const roleName = cleanText(data.roleName);

    if (!roleName) {
      this.finish("handleAddVoiceRole", !!e.group_id);
      return;
    }

    const existingPrompt = cleanText(data.prompt);
    const hasExistingPrompt = Boolean(existingPrompt);
    const audioParts = Array.isArray(data.audioParts) ? data.audioParts : [];
    const totalDuration = Number(data.totalDuration) || 0;
    const incomingText = cleanText(e.msg);
    const skip = /^(跳过|无|不用|不需要|no)$/i.test(incomingText);
    const finish = /^(完成|保存|done|finish)$/i.test(incomingText);
    const prompt = existingPrompt;

    if (skip) {
      this.finish("handleAddVoiceRole", !!e.group_id);
      if (!hasExistingPrompt) {
        await e.reply(`已取消添加语音角色「${roleName}」。`, 10, true);
        return;
      }

      await this.finalizeVoiceRole(e, {
        roleName,
        prompt,
        audioParts: [],
      });
      return;
    }

    if (finish) {
      if (audioParts.length === 0 && !hasExistingPrompt) {
        this.setContext("handleAddVoiceRole", !!e.group_id, 60, true, data);
        await e.reply("还没有收到参考语音，请先发送语音/音频文件，或发送「跳过」取消。", 20, true);
        return;
      }

      this.finish("handleAddVoiceRole", !!e.group_id);
      await this.finalizeVoiceRole(e, {
        roleName,
        prompt,
        audioParts,
      });
      return;
    }

    const record = await this.getReferenceRecord(e, VOXCPM_TIMEOUT_MS);
    if (!record) {
      this.setContext("handleAddVoiceRole", !!e.group_id, 60, true, data);
      await e.reply("请发送语音/音频文件；可以连续发送多条，发送「完成」保存，发送「跳过」取消。", 20, true);
      return;
    }

    let part;
    try {
      part = this.prepareRoleAudioPart(roleName, record, audioParts.length + 1);
    } catch (error) {
      this.setContext("handleAddVoiceRole", !!e.group_id, 60, true, data);
      await e.reply(`参考语音处理失败：${error.message}`, 20, true);
      return;
    }

    const nextTotalDuration = totalDuration + part.duration;
    if (nextTotalDuration > MAX_REFERENCE_AUDIO_SECONDS) {
      this.finish("handleAddVoiceRole", !!e.group_id);
      await e.reply(
        `添加语音角色「${roleName}」失败：参考语音总长度 ${formatDuration(nextTotalDuration)}，超过 ${MAX_REFERENCE_AUDIO_SECONDS} 秒限制。`,
        20,
        true
      );
      return;
    }

    const nextData = {
      ...data,
      audioParts: [...audioParts, part],
      totalDuration: nextTotalDuration,
    };
    this.setContext("handleAddVoiceRole", !!e.group_id, 60, true, nextData);
    await e.reply(
      `已收到第 ${nextData.audioParts.length} 条参考语音，当前总长 ${formatDuration(nextTotalDuration)}。可继续发送，或发送「完成」保存。`,
      20,
      true
    );
  };

  async finalizeVoiceRole(e, { roleName, prompt, audioParts }) {
    let referenceAudioPath = "";
    try {
      if (audioParts.length > 0) {
        referenceAudioPath = this.mergeRoleAudioParts(roleName, audioParts);
      }
    } catch (error) {
      await e.reply(`语音角色「${roleName}」保存失败：${error.message}`, 20, true);
      return;
    }

    const saved = this.upsertRole({
      name: roleName,
      prompt,
      referenceAudioPath,
    });

    if (!saved) {
      removeRoleAudioFile(referenceAudioPath);
      await e.reply(`语音角色「${roleName}」保存失败。`, 10, true);
      return;
    }

    const audioText = referenceAudioPath
      ? `，已合并 ${audioParts.length} 条参考语音（总长 ${formatDuration(audioParts.reduce((sum, item) => sum + (Number(item.duration) || 0), 0))}）`
      : "";
    await e.reply(`语音角色「${roleName}」已保存${audioText}。`, 20, true);
  }

  listVoiceRoles = Command(LIST_ROLE_REG, async (e) => {
    const roles = this.roles;
    const botId = e.bot?.self_id || e.self_id;
    const botName = e.bot?.nickname || "VoxCPM";
    const defaultRoleName = cleanText(this.config.defaultRole) || "未设置";
    const defaultRole = this.defaultRole;
    const defaultPrompt = defaultRole ? (cleanText(defaultRole.prompt) || "未设置") : "角色不存在";
    const defaultHasAudio = defaultRole
      ? (cleanText(defaultRole.referenceAudioPath) ? "已绑定" : "未绑定")
      : "角色不存在";
    const aiDefaultRoleName = cleanText(this.config.aiDefaultRole) || "未设置";
    const aiDefaultRole = this.aiDefaultRole;
    const aiDefaultPrompt = aiDefaultRole ? (cleanText(aiDefaultRole.prompt) || "未设置") : "角色不存在";
    const aiDefaultHasAudio = aiDefaultRole
      ? (cleanText(aiDefaultRole.referenceAudioPath) ? "已绑定" : "未绑定")
      : "角色不存在";
    const nodes = [
      {
        user_id: botId,
        nickname: botName,
        content: `默认角色 + AI默认角色 + ${roles.length} 个自定义角色\n使用：角色名说 文本\n普通默认：说 文本\nAI默认：AI工具固定使用`,
      },
      {
        user_id: botId,
        nickname: botName,
        content: `普通默认角色：${defaultRoleName}\n声音描述：${defaultPrompt}\n参考语音：${defaultHasAudio}`,
      },
      {
        user_id: botId,
        nickname: botName,
        content: `AI默认角色：${aiDefaultRoleName}\n声音描述：${aiDefaultPrompt}\n参考语音：${aiDefaultHasAudio}`,
      },
      ...roles.map((role, index) => {
        const prompt = cleanText(role.prompt) || "未设置";
        const hasAudio = cleanText(role.referenceAudioPath) ? "已绑定" : "未绑定";
        return {
          user_id: botId,
          nickname: botName,
          content: `${index + 1}. ${role.name}\n声音描述：${prompt}\n参考语音：${hasAudio}`,
        };
      }),
    ];

    await e.sendForwardMsg(nodes, {
      source: "语音角色列表",
      prompt: `默认角色 + AI默认角色 + ${roles.length} 个自定义角色`,
      news: [{ text: `语音角色列表（${roles.length}）` }],
    });
    return true;
  });

  deleteVoiceRole = Command(DELETE_ROLE_REG, async (e) => {
    const match = DELETE_ROLE_REG.exec(e.msg || "");
    const roleName = cleanText(match?.[1]);
    if (!roleName) {
      return false;
    }

    const role = this.findRole(roleName);
    if (!role) {
      await e.reply(`语音角色「${roleName}」不存在。`, 10, true);
      return true;
    }

    const roles = this.roles.filter((item) => cleanText(item.name) !== roleName);
    const saved = this.saveRoles(roles);
    if (saved && role.referenceAudioPath) {
      removeRoleAudioFile(role.referenceAudioPath);
    }

    await e.reply(saved ? `语音角色「${roleName}」已删除。` : `语音角色「${roleName}」删除失败。`, 10, true);
    return true;
  });

  findRecordSegment(message) {
    if (!Array.isArray(message)) {
      return null;
    }

    return message.find((item) => item?.type === "record" && (item.data?.url || item.data?.file));
  }

  findFileSegment(message) {
    if (!Array.isArray(message)) {
      return null;
    }

    return message.find((item) => {
      if (item?.type !== "file") {
        return false;
      }

      const fileName = item.data?.name || item.data?.file_name || "";
      return isAudioFileName(fileName) || Boolean(item.data?.url || item.data?.file);
    });
  }

  async getReferenceRecord(e, timeoutMs) {
    let record = this.findRecordSegment(e.message);

    if (!record && e.reply_id) {
      const replyMsg = await e.getReplyMsg();
      record = this.findRecordSegment(replyMsg?.message);
    }

    if (!record) {
      return this.getReferenceFile(e, timeoutMs);
    }

    const source = record.data?.url || record.data?.file;
    return this.loadAudioSource(source, timeoutMs);
  }

  async getReferenceFile(e, timeoutMs) {
    let fileSeg = this.findFileSegment(e.message);

    if (!fileSeg && e.reply_id) {
      const replyMsg = await e.getReplyMsg();
      fileSeg = this.findFileSegment(replyMsg?.message);
    }

    if (!fileSeg) {
      return null;
    }

    const fileName = fileSeg.data?.name || fileSeg.data?.file_name || "reference.wav";
    const directSource = fileSeg.data?.url || fileSeg.data?.file;

    if (directSource) {
      const loaded = await this.loadAudioSource(directSource, timeoutMs);
      if (loaded) {
        return {
          ...loaded,
          fileName: fileName || loaded.fileName,
          mimeType: loaded.mimeType || mimeFromFileName(fileName),
        };
      }
    }

    const fileId = fileSeg.data?.file_id;
    if (!fileId) {
      return null;
    }

    let fileMeta = null;
    try {
      const rawMeta =
        typeof e.bot?.getFile === "function"
          ? await e.bot.getFile({ file_id: fileId })
          : await e.bot?.sendRequest?.("get_file", { file_id: fileId });
      fileMeta = rawMeta?.data || rawMeta || null;
    } catch (error) {
      logger.warn(`[VoxCPMVoice] 获取群文件元信息失败: ${error.message}`);
    }

    let downloadSource = "";
    if (e.group_id) {
      const fileUrlResp = await e.bot.getGroupFileUrl({
        group_id: e.group_id,
        file_id: fileId,
      });
      downloadSource = fileUrlResp?.url || fileUrlResp?.download_url || "";
    }

    if (!downloadSource) {
      downloadSource = fileMeta?.url || fileMeta?.file || "";
    }

    if (!downloadSource) {
      return null;
    }

    const loaded = await this.loadAudioSource(downloadSource, timeoutMs);
    if (!loaded) {
      return null;
    }

    const resolvedFileName =
      fileName ||
      fileMeta?.file_name ||
      fileMeta?.name ||
      fileMeta?.filename ||
      loaded.fileName;

    return {
      ...loaded,
      fileName: resolvedFileName,
      mimeType: loaded.mimeType || mimeFromFileName(resolvedFileName),
    };
  }

  prepareRoleAudioPart(roleName, audio, index) {
    ensureRoleAudioDir();
    const ext = detectAudioExt(audio.buffer, path.extname(audio.fileName || "") || ".wav");
    const random = Math.random().toString(36).slice(2, 8);
    const baseName = `${sanitizeRoleName(roleName)}_${Date.now()}_${index}_${random}`;
    const sourcePath = path.join(ROLE_AUDIO_DIR, `${baseName}_source${ext}`);
    const wavPath = path.join(ROLE_AUDIO_DIR, `${baseName}.wav`);
    fs.writeFileSync(sourcePath, audio.buffer);

    try {
      if (!convertToWav(sourcePath, wavPath)) {
        throw new Error("音频格式转换失败");
      }

      const duration = getAudioDurationSeconds(wavPath);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("无法读取音频时长");
      }

      return {
        buffer: fs.readFileSync(wavPath),
        duration,
      };
    } finally {
      removeRoleAudioFile(sourcePath);
      removeRoleAudioFile(wavPath);
    }
  }

  mergeRoleAudioParts(roleName, audioParts) {
    ensureRoleAudioDir();
    if (!Array.isArray(audioParts) || audioParts.length === 0) {
      return "";
    }

    const baseName = `${sanitizeRoleName(roleName)}_${Date.now()}`;
    const outputPath = path.join(ROLE_AUDIO_DIR, `${baseName}.wav`);

    if (audioParts.length === 1) {
      fs.writeFileSync(outputPath, audioParts[0].buffer);
      return outputPath;
    }

    const partPaths = audioParts.map((part, index) => {
      const partPath = path.join(ROLE_AUDIO_DIR, `${baseName}_part${index + 1}.wav`);
      fs.writeFileSync(partPath, part.buffer);
      return partPath;
    });
    const listPath = path.join(ROLE_AUDIO_DIR, `${baseName}_concat.txt`);
    fs.writeFileSync(
      listPath,
      partPaths.map((item) => `file '${escapeConcatPath(item)}'`).join("\n"),
      "utf8"
    );

    let merged = false;
    try {
      const result = spawnSync("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        outputPath,
      ], {
        encoding: "utf8",
      });

      if (result.status !== 0 || !fs.existsSync(outputPath)) {
        throw new Error("参考语音合并失败");
      }

      merged = true;
      return outputPath;
    } finally {
      if (!merged) {
        removeRoleAudioFile(outputPath);
      }
      removeRoleAudioFile(listPath);
      for (const partPath of partPaths) {
        removeRoleAudioFile(partPath);
      }
    }
  }

  async loadAudioSource(source, timeoutMs) {
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
}
