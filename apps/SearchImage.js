import Setting from '../lib/setting.js'
import { getImg } from '../lib/utils.js'
import {
  SEARCH_CHANNELS,
  detectForcedSearchChannel,
  getDefaultSearchChannel,
  getSearchChannelLabel,
  searchImageByUrl,
  sendSearchResultForward,
} from '../lib/imageSearch/index.js'

export class SearchImage extends plugin {
  constructor() {
    super({
      name: '搜图',
      dsc: '统一搜图入口',
      event: 'message',
      priority: 1000,
    })
  }

  get appconfig() {
    return Setting.getConfig('SearchImage') || {}
  }

  imageSearch = Command(/^#?(?:(?:谷歌|google|googlelens|lens|as|ascii|ascii2d|sa|sauce|saucenao)\s*)?(?:搜图|以图搜图|二次元搜图)$/i, async (e) => {
    const imgs = await getImg(e, true)
    if (!imgs || imgs.length === 0) {
      return false
    }

    const forcedChannel = detectForcedSearchChannel(e.msg)
    const channel = forcedChannel || getDefaultSearchChannel(this.appconfig)
    const channelLabel = getSearchChannelLabel(channel)

    if (channel === SEARCH_CHANNELS.SAUCENAO && !this.appconfig.sauceNaoApiKey) {
      await e.reply('SauceNAO 搜图需要配置 API Key，请在配置文件中设置 sauceNaoApiKey。', 10, true)
      return true
    }

    await e.react(124)

    try {
      const result = await searchImageByUrl(imgs[0], {
        channel,
        sauceNaoApiKey: this.appconfig.sauceNaoApiKey,
      })

      const hasResults = Boolean(result.aiText) || (Array.isArray(result.items) && result.items.length > 0)
      if (!hasResults) {
        await e.reply(`未能在 ${channelLabel} 找到相关结果。`, 10, true)
        return true
      }

      const sendResult = await sendSearchResultForward(e, result, {
        maxResults: this.appconfig.maxResults,
      })

      if (!sendResult?.message_id) {
        await e.reply(`已获取 ${channelLabel} 结果，但转发发送失败。`,10, true)
      }
    } catch (error) {
      logger.error('[SearchImage] 搜图失败:', error)
      await e.reply(`${channelLabel} 搜图失败: ${error.message}`, 10,true)
    }

    return true
  })
}
