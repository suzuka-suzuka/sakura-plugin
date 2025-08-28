import _ from "lodash"

import Setting from "../lib/setting.js";
let raw 

export class summary extends plugin {
  constructor() {
    super({
      name: '图片外显文本',
      dsc: '在图片消息中添加自定义或随机外显文本',
    })

    this.lint()
  }


  get appconfig() {
    return Setting.getConfig("summary"); 
  }

 
  lint() {
   
    if (!raw) {
      raw = segment.image
    }

    segment.image = (file, name) => {
      const config = this.appconfig
      if (config && config.enable && Array.isArray(config.Summaries) && config.Summaries.length > 0) {
        
        const summaryText = _.sample(config.Summaries)
        return {
          type: "image",
          file,
          name,
          summary: summaryText
        }
      } else {
          return raw(file, name)
      }
    }
    
  }

}