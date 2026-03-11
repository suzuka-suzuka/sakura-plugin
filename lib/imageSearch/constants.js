export const SEARCH_CHANNELS = Object.freeze({
  ASCII2D: 'ascii2d',
  GOOGLE: 'google',
  SAUCENAO: 'saucenao',
})

export const SEARCH_CHANNEL_OPTIONS = [
  SEARCH_CHANNELS.ASCII2D,
  SEARCH_CHANNELS.GOOGLE,
  SEARCH_CHANNELS.SAUCENAO,
]

export const SEARCH_CHANNEL_LABELS = Object.freeze({
  [SEARCH_CHANNELS.ASCII2D]: 'Ascii2d',
  [SEARCH_CHANNELS.GOOGLE]: 'Google Lens',
  [SEARCH_CHANNELS.SAUCENAO]: 'SauceNAO',
})

const CHANNEL_ALIASES = new Map([
  ['ascii2d', SEARCH_CHANNELS.ASCII2D],
  ['ascii', SEARCH_CHANNELS.ASCII2D],
  ['as', SEARCH_CHANNELS.ASCII2D],
  ['google', SEARCH_CHANNELS.GOOGLE],
  ['谷歌', SEARCH_CHANNELS.GOOGLE],
  ['googlelens', SEARCH_CHANNELS.GOOGLE],
  ['lens', SEARCH_CHANNELS.GOOGLE],
  ['saucenao', SEARCH_CHANNELS.SAUCENAO],
  ['sauce', SEARCH_CHANNELS.SAUCENAO],
  ['sa', SEARCH_CHANNELS.SAUCENAO],
])

export function normalizeSearchChannel(channel) {
  if (!channel) return SEARCH_CHANNELS.ASCII2D
  const normalized = String(channel).trim().toLowerCase().replace(/\s+/g, '')
  return CHANNEL_ALIASES.get(normalized) || SEARCH_CHANNELS.ASCII2D
}

export function getSearchChannelLabel(channel) {
  return SEARCH_CHANNEL_LABELS[normalizeSearchChannel(channel)] || '搜图'
}

export function detectForcedSearchChannel(message = '') {
  const normalized = String(message).trim().replace(/^#/, '').replace(/\s+/g, '').toLowerCase()

  if (/^(谷歌|google|googlelens|lens)/i.test(normalized)) {
    return SEARCH_CHANNELS.GOOGLE
  }

  if (/^(ascii2d|ascii|as)/i.test(normalized)) {
    return SEARCH_CHANNELS.ASCII2D
  }

  if (/^(saucenao|sauce|sa)/i.test(normalized)) {
    return SEARCH_CHANNELS.SAUCENAO
  }

  return null
}
