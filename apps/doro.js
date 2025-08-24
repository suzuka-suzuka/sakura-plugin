export class DoroEnding extends plugin {
  constructor() {
    super({
      name: 'DoroEnding',
      dsc: 'Doro结局图片',
      event: 'message.group' ,
      priority: 1135,
      rule: [
        {
          reg: '^doro结局$',
          fnc: 'doroEnding',
		  log: false
        }
      ]
    })
  }

  async doroEnding(e) {
    try {
      const imageUrl = 'https://image.rendround.ggff.net/doroending'
      await e.reply(segment.image(imageUrl))
      return true
    } catch (error) {
      logger.error('获取Doro结局图片出错：', error)
      return false
    }
  }
}