import { AbstractTool } from './AbstractTool.js'
import {
  SEARCH_CHANNELS,
  getSearchImageConfig,
  searchImageByUrl,
} from '../../imageSearch/index.js'

export class ImageSearchTool extends AbstractTool {
  name = 'ImageSearch'

  description = '当你需要根据图片进行搜图时使用'

  parameters = {
    properties: {
      seq: {
        type: 'integer',
        description: '图片或动画表情的消息seq',
      },
    },
    required: ['seq'],
  }

  func = async function (opts, e) {
    const { seq } = opts || {}

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

    try {
      const searchConfig = getSearchImageConfig()
      const result = await searchImageByUrl(imageUrl, {
        channel: SEARCH_CHANNELS.GOOGLE,
        googleLogin: searchConfig.googleLogin,
      })

      if (!result.aiText) {
        return '未找到结果。'
      }

      return result.aiText
    } catch (error) {
      logger.error('[ImageSearchTool] 执行失败:', error)
      return `搜图失败: ${error.message}`
    }
  }
}
