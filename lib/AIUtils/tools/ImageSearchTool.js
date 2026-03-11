import { AbstractTool } from './AbstractTool.js'
import Setting from '../../setting.js'
import {
  SEARCH_CHANNEL_OPTIONS,
  getDefaultSearchChannel,
  getSearchChannelLabel,
  normalizeSearchChannel,
  searchImageByUrl,
  sendSearchResultForward,
  stringifySearchResult,
} from '../../imageSearch/index.js'

export class ImageSearchTool extends AbstractTool {
  name = 'ImageSearch'

  description = '当你需要根据图片进行搜图时使用，默认使用插件配置中的默认搜图渠道'

  parameters = {
    properties: {
      seq: {
        type: 'integer',
        description: '图片或动画表情的消息seq',
      },
      channel: {
        type: 'string',
        enum: SEARCH_CHANNEL_OPTIONS,
        description: '可选的搜图渠道，不传时使用插件配置中的默认渠道',
      },
    },
    required: ['seq'],
  }

  func = async function (opts, e) {
    const { seq, channel: rawChannel } = opts || {}

    if (!seq) {
      return '你必须提供包含图片的消息 seq。'
    }

    let imageUrl
    try {
      const targetMsg = await e.getMsg(seq)
      const image = targetMsg?.message?.find((m) => m.type === 'image')
      if (!image?.data?.url) {
        return '未能从该消息中提取到图片。'
      }
      imageUrl = image.data.url
      await e.react(128076, seq)
    } catch (err) {
      logger.error(`[ImageSearchTool] 获取消息 seq: ${seq} 失败:`, err)
      return `获取消息失败: ${err.message}`
    }

    const config = Setting.getConfig('SearchImage') || {}
    const channel = rawChannel
      ? normalizeSearchChannel(rawChannel)
      : getDefaultSearchChannel(config)
    const maxResults = config.maxResults || 3

    try {
      const result = await searchImageByUrl(imageUrl, {
        channel,
        sauceNaoApiKey: config.sauceNaoApiKey,
      })

      if (e?.sendForwardMsg) {
        await sendSearchResultForward(e, result, { maxResults })
      }

      const hasResults = Boolean(result.aiText) || (Array.isArray(result.items) && result.items.length > 0)
      if (!hasResults) {
        return `${getSearchChannelLabel(channel)} 未找到匹配结果。`
      }

      return stringifySearchResult(result, maxResults)
    } catch (error) {
      logger.error('[ImageSearchTool] 执行失败:', error)
      return `${getSearchChannelLabel(channel)} 搜图失败: ${error.message}`
    }
  }
}
