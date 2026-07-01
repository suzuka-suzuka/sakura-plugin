import { AbstractTool } from "./AbstractTool.js"
import fs from "node:fs"
import path from "node:path"

// segment 类型 → 参数名列表（按 Yunzai segment API 参数顺序）
const SEGMENT_ARGS = {
  text: ["text"],
  image: ["file"],
  at: ["qq"],
  face: ["id"],
  file: ["file", "name"],
  video: ["file"],
  record: ["file"],
  reply: ["id"],
  dice: [],
  rps: [],
  location: ["lat", "lng", "title", "address"],
  markdown: ["content"],
  xml: ["data"],
  json: ["data"],
}

// 带文件参数的段类型
const FILE_SEGMENTS = new Set(["image", "file", "video", "record"])

// 判断是否为本地路径（非 http/https/base64）
function isLocalPath(p) {
  if (typeof p !== "string") return false
  return !/^(https?:\/\/|base64:\/\/)/i.test(p)
}

// 将本地文件转换为 HTTP URL（通过 Bot.fileToUrl）
async function resolveLocalFile(filePath, fileName) {
  const resolved = filePath.replace(/^file:\/\//, "")
  if (!fs.existsSync(resolved)) {
    throw new Error(`文件不存在: ${resolved}`)
  }
  const stat = fs.statSync(resolved)
  if (stat.size > 100 * 1024 * 1024) {
    throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(2)}MB)，不能超过100MB`)
  }
  const buffer = fs.readFileSync(resolved)
  const url = await Bot.fileToUrl(buffer, {
    name: fileName || path.basename(resolved),
    time: 600000,
  })
  return url.toString()
}

// 构建单个段（异步）
async function buildSegment(seg) {
  if (typeof seg === "string") return seg
  if (!seg || !seg.type) return null

  if (seg.type === "text") return seg.text || ""

  const argNames = SEGMENT_ARGS[seg.type]
  if (!argNames) return null

  const s = { ...seg }

  if (FILE_SEGMENTS.has(seg.type)) {
    const filePath = s.file || s.path
    if (!filePath) return null

    if (isLocalPath(filePath)) {
      try {
        s.file = await resolveLocalFile(filePath, s.name)
        if (!s.name) s.name = path.basename(filePath)
      } catch (err) {
        return { type: "text", text: `[文件处理失败: ${err.message}]` }
      }
    } else {
      s.file = filePath
    }
    delete s.path
  }

  return { type: seg.type, ...s }
}

// 检查发送结果是否包含错误
function checkReplyError(replyResult) {
  const items = Array.isArray(replyResult) ? replyResult : [replyResult]
  for (const item of items) {
    if (item && typeof item === "object") {
      if (item.error) {
        const errMsg = Array.isArray(item.error)
          ? item.error.map(e => e.message || String(e)).join("; ")
          : String(item.error)
        return `转发失败：${errMsg}`
      }
      if (item.message === "发送消息错误") {
        return `转发失败：${item.message}`
      }
    }
  }
  return null
}

export class ForwardMessageTool extends AbstractTool {
  name = "sendForwardMessage"

  parameters = {
    type: "object",
    properties: {
      messages: {
        type: "array",
        description: "要合并转发的消息列表，1~100条",
        items: {
          type: "object",
          properties: {
            content: {
              type: "array",
              description:
                "消息段数组。支持类型：" +
                Object.keys(SEGMENT_ARGS).join(" / ") +
                "。每段为 {type, ...对应参数}。纯文本可简写为字符串。\n" +
                "对于文件段，请使用 file 或 path 字段传入本地路径，工具会自动转换为临时 URL，无需手动上传。",
            },
            senderId: {
              type: "string",
              description: "发送者QQ号（可选）",
            },
            senderName: {
              type: "string",
              description: "发送者昵称（可选）",
            },
          },
          required: ["content"],
        },
      },
      summary: {
        type: "string",
        description: "合并转发消息的标题/摘要（可选）",
      },
    },
    required: ["messages"],
  }

  description =
    "将多条消息打包为合并转发消息（多选消息框）一次性发送。" +
    "每条消息的 content 为段数组，支持 text/image/at/face/file/video/record/reply 等全类型。" +
    "最多100条。本地文件会自动转换为临时 URL，无需提前使用其他上传工具。"

  func = async function (opts, e) {
    const { messages, summary } = opts

    if (!messages || !Array.isArray(messages)) {
      return "转发失败：消息列表为空或格式错误"
    }
    if (messages.length === 0) {
      return "转发失败：消息列表为空"
    }
    if (messages.length > 100) {
      return `转发失败：消息数量（${messages.length}）超过上限100条`
    }

    const forwardMsg = []
    if (summary) forwardMsg.push({ message: summary })

    for (const item of messages) {
      const { content, senderId, senderName } = item

      let message
      try {
        if (typeof content === "string") {
          message = content
        } else if (Array.isArray(content)) {
          const parts = (await Promise.all(content.map(buildSegment))).filter(p => p !== null)
          if (parts.length === 0) continue
          message = parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts
        } else {
          continue
        }
      } catch (err) {
        return `转发失败：处理消息内容时出错 - ${err.message}`
      }

      const node = { message }
      if (senderId) node.user_id = senderId
      if (senderName) node.nickname = senderName
      forwardMsg.push(node)
    }

    if (forwardMsg.length === 0) {
      return "转发失败：没有有效的消息内容"
    }

    const maker = e?.group || e?.friend || Bot
    let forwardSegment
    try {
      forwardSegment = maker.makeForwardMsg(forwardMsg)
    } catch (err) {
      return `转发失败：生成合并转发消息段失败 - ${err.message}`
    }

    let replyResult
    try {
      replyResult = await e.reply(forwardSegment)
    } catch (err) {
      return `转发失败：发送合并转发消息时异常 - ${err.message || String(err)}`
    }

    const errorMsg = checkReplyError(replyResult)
    if (errorMsg) return errorMsg

    return `已成功发送 ${messages.length} 条合并转发消息`
  }
}