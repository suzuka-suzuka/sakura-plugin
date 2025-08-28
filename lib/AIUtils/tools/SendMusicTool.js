import { AbstractTool } from './AbstractTool.js'

export class SendMusicTool extends AbstractTool {
  name = 'sendMusic'

  parameters = {
    properties: {
      id: {
        type: 'string',
        description: '音乐的id'
      }
    },
    required: ['id']
  }
  description = '当你想要分享音乐时使用。你必须先使用searchMusic工具来获取音乐ID。'

  func = async function (opts, e) {
    let { id } = opts
    try {
      if (typeof e.group.shareMusic === 'function') {
        await e.group.shareMusic('163', id)
      } else {
        const musicMsgObject = {
          type: 'music',
          data: {
            type: '163', 
            id: id      
          }
        }
        
        await e.reply(musicMsgObject)
      }
      return `音乐已经发送`
    } catch (err) {
      return `音乐发送失败: ${err}`
    }
  }
}