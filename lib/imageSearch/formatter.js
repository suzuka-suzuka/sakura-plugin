import { getSearchChannelLabel } from './constants.js'
import { truncateText } from './helpers.js'

function buildGoogleAiNode(botId, botName, aiText) {
  return {
    user_id: botId,
    nickname: `${botName} · AI 概览`,
    content: [aiText],
  }
}

function buildResultLines(item, index, channelLabel) {
  const lines = [`【${channelLabel} 结果 ${index + 1}】`]

  if (item.similarity) {
    lines.push(`相似度：${item.similarity}%`)
  }

  if (item.title) {
    lines.push(`标题：${item.title}`)
  }

  if (item.author) {
    const authorSuffix = item.authorId ? ` (${item.authorId})` : ''
    lines.push(`作者：${item.author}${authorSuffix}`)
  }

  if (item.details) {
    lines.push(`详情：${item.details}`)
  }

  if (item.url) {
    lines.push(`链接：${item.url}`)
  }

  return lines.join('\n')
}

function buildResultNode(botId, botName, item, index, channelLabel) {
  const content = [buildResultLines(item, index, channelLabel)]

  if (item.thumb) {
    if (typeof item.thumb === 'string' && item.thumb.startsWith('data:image')) {
      const base64Data = item.thumb.replace(/^data:image\/\w+;base64,/, '')
      content.push(segment.image(Buffer.from(base64Data, 'base64')))
    } else {
      content.push(segment.image(item.thumb))
    }
  }

  return {
    user_id: botId,
    nickname: `${botName} · 结果 ${index + 1}`,
    content,
  }
}

export function buildSearchForwardParams(result, options = {}) {
  const {
    botId,
    botName = '搜图',
    maxResults = 3,
  } = options

  const channelLabel = getSearchChannelLabel(result.channel)
  const items = Array.isArray(result.items) ? result.items.slice(0, maxResults) : []
  const nodes = []

  if (result.aiText) {
    nodes.push(buildGoogleAiNode(botId, botName, result.aiText))
  }

  items.forEach((item, index) => {
    nodes.push(buildResultNode(botId, botName, item, index, channelLabel))
  })

  const source = `${channelLabel}搜图结果`
  const prompt = items.length > 0
    ? `${channelLabel} 找到 ${items.length} 条结果`
    : `${channelLabel} 未找到结果`

  const news = []
  news.push({ text: `渠道：${channelLabel}` })

  if (result.aiText) {
    news.push({ text: truncateText(result.aiText, 40) })
  }

  if (items[0]?.title) {
    news.push({ text: truncateText(items[0].title, 40) })
  }

  news.push({ text: `结果数：${items.length}` })

  return {
    nodes,
    source,
    prompt,
    news: news.slice(0, 4),
  }
}

export function stringifySearchResult(result, maxResults = 3) {
  const channelLabel = getSearchChannelLabel(result.channel)
  const parts = [`渠道：${channelLabel}`]

  if (result.aiText) {
    parts.push(`AI 概览：${truncateText(result.aiText, 120)}`)
  }

  const items = Array.isArray(result.items) ? result.items.slice(0, maxResults) : []
  if (!items.length) {
    parts.push('未找到匹配结果。')
    return parts.join('\n')
  }

  items.forEach((item, index) => {
    const line = [`${index + 1}. ${item.title || '未知标题'}`]
    if (item.author) line.push(`作者：${item.author}`)
    if (item.similarity) line.push(`相似度：${item.similarity}%`)
    if (item.url) line.push(`链接：${item.url}`)
    parts.push(line.join(' | '))
  })

  return parts.join('\n')
}
