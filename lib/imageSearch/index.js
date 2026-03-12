import Setting from '../setting.js'
import { searchAscii2d } from './ascii2d.js'
import { SEARCH_CHANNELS, SEARCH_CHANNEL_OPTIONS, normalizeSearchChannel, getSearchChannelLabel, detectForcedSearchChannel } from './constants.js'
import { searchGoogleLens } from './googleLens.js'
import { downloadImageToTemp, cleanupTempFile } from './helpers.js'
import { searchSauceNao } from './saucenao.js'
import { buildSearchForwardParams, stringifySearchResult } from './formatter.js'

export {
  SEARCH_CHANNELS,
  SEARCH_CHANNEL_OPTIONS,
  normalizeSearchChannel,
  getSearchChannelLabel,
  detectForcedSearchChannel,
  stringifySearchResult,
}

export function getSearchImageConfig() {
  return Setting.getConfig('SearchImage') || {}
}

export function getDefaultSearchChannel(config = getSearchImageConfig()) {
  return normalizeSearchChannel(config.defaultChannel)
}

export async function searchImageByUrl(imgUrl, options = {}) {
  const {
    channel,
    sauceNaoApiKey,
    googleProxy,
  } = options

  const resolvedChannel = normalizeSearchChannel(channel)

  if (resolvedChannel === SEARCH_CHANNELS.SAUCENAO) {
    return searchSauceNao(imgUrl, sauceNaoApiKey)
  }

  const tmpFile = await downloadImageToTemp(imgUrl, resolvedChannel)
  try {
    if (resolvedChannel === SEARCH_CHANNELS.GOOGLE) {
      return await searchGoogleLens(tmpFile, { proxy: googleProxy })
    }

    return await searchAscii2d(tmpFile)
  } finally {
    cleanupTempFile(tmpFile)
  }
}

export async function sendSearchResultForward(e, result, options = {}) {
  const botName = options.botName || Setting.getConfig('bot')?.botname || '搜图'
  const params = buildSearchForwardParams(result, {
    botId: e.self_id,
    botName,
    maxResults: options.maxResults || getSearchImageConfig().maxResults || 3,
  })

  if (!params.nodes.length) {
    return null
  }

  return e.sendForwardMsg(params.nodes, {
    source: params.source,
    prompt: params.prompt,
    news: params.news,
  })
}
