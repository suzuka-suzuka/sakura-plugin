import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const TEMP_DIR = path.resolve('data', 'temp')

export function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }
  return TEMP_DIR
}

export async function downloadImageToTemp(imgUrl, prefix = 'image_search') {
  const dataDir = ensureTempDir()
  const tmpFile = path.join(dataDir, `${prefix}_${crypto.randomUUID()}.png`)
  const response = await fetch(imgUrl)

  if (!response.ok) {
    throw new Error(`图片下载失败: HTTP ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  fs.writeFileSync(tmpFile, Buffer.from(buffer))
  return tmpFile
}

export async function fetchImageBlob(imgUrl) {
  const response = await fetch(imgUrl)
  if (!response.ok) {
    throw new Error(`向源地址请求图片失败: HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const buffer = await response.arrayBuffer()
  return new Blob([buffer], { type: contentType })
}

export function cleanupTempFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function sanitizeGoogleAiText(text = '') {
  if (!text) return ''

  let normalized = String(text)
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // 移除开头的 "AI 概览" 或 "AI Overview"（可能带空格或换行）
  normalized = normalized.replace(/^(AI\s*概览|AI\s*Overview)\n?/i, '').trim()

  return normalized
    .replace(/\s*在 AI 模式下深入探索[\s\S]*$/u, '')
    .replace(/\s*AI 的回答未必正确无误，请注意核查[\s\S]*$/u, '')
    .trim()
}

export function truncateText(text = '', maxLength = 80) {
  const normalized = String(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

export function dedupeBy(items = [], getKey) {
  const seen = new Set()
  return items.filter(item => {
    const key = getKey(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
