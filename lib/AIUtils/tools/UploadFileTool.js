import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { AbstractTool } from './AbstractTool.js'
import { projectRoot } from '../../path.js'

const ALLOWED_ROOT = path.resolve(projectRoot)

function isWithinAllowedRoot(targetPath) {
  const relative = path.relative(ALLOWED_ROOT, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveLocalFilePath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { error: '你必须提供要发送的本地文件路径。' }
  }

  let normalizedPath = inputPath.trim()

  if (normalizedPath.startsWith('file://')) {
    try {
      normalizedPath = fileURLToPath(normalizedPath)
    } catch {
      return { error: '无法解析 file:// 格式的本地文件路径。' }
    }
  }

  const resolvedPath = path.isAbsolute(normalizedPath)
    ? path.resolve(normalizedPath)
    : path.resolve(ALLOWED_ROOT, normalizedPath)

  if (!isWithinAllowedRoot(resolvedPath)) {
    return { error: `只允许发送项目目录内的文件：${ALLOWED_ROOT}` }
  }

  if (!fs.existsSync(resolvedPath)) {
    return { error: `文件不存在：${resolvedPath}` }
  }

  const stat = fs.statSync(resolvedPath)
  if (!stat.isFile()) {
    return { error: `目标不是文件：${resolvedPath}` }
  }

  return { resolvedPath, stat }
}

export class UploadFileTool extends AbstractTool {
  name = 'UploadFile'

  description = '当你需要发送本地文件时使用。'

  parameters = {
    properties: {
      filePath: {
        type: 'string',
        description: '要发送的本地文件路径。支持项目根目录下的相对路径，或项目目录内的绝对路径。',
      },
    },
    required: ['filePath'],
  }

  func = async function (opts = {}, e = null) {
    if (!e?.bot) {
      return { error: '当前上下文不可用，无法执行文件发送。' }
    }

    const { filePath } = opts
    const resolved = resolveLocalFilePath(filePath)
    if (resolved.error) {
      return { error: resolved.error }
    }

    let sender = null
    let targetType = null
    let targetId = null

    if (e.group?.uploadFile) {
      sender = e.group
      targetType = 'group'
      targetId = e.group_id
    } else if (e.friend?.uploadFile) {
      sender = e.friend
      targetType = 'private'
      targetId = e.user_id
    } else {
      return { error: '当前不是群聊或私聊消息上下文，无法确定发送目标。' }
    }

    const fileName = path.basename(resolved.resolvedPath)

    try {
      await sender.uploadFile(resolved.resolvedPath, fileName)

      return {
        message: `文件已发送到${targetType === 'group' ? '群' : '私聊'} ${targetId}: ${fileName}`,
      }
    } catch (error) {
      return {
        error: `文件发送失败: ${error.message || error}`,
      }
    }
  }
}
