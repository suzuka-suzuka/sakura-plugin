import { getImg } from "../lib/utils.js"
import Setting from "../lib/setting.js"
import cfg from "../../../lib/config/config.js"
import { PermissionManager } from "../lib/PermissionManager.js"
import {
  fetchImageForGeneration,
  generateImageWithConfig,
} from "../lib/AIUtils/ImageGenerationProvider.js"

export class EditImage extends plugin {
  constructor() {
    super({
      name: "AI图像编辑",
      dsc: "使用AI模型修改或生成图片",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: ".*",
          fnc: "dispatchHandler",
          log: false,
        },
      ],
    })
    this.task = Setting.getConfig("EditImage")
  }

  checkPermission(e) {
    if (!this.task?.requirePermission) {
      return true
    }

    const masterQQs = Array.isArray(cfg.masterQQ) ? cfg.masterQQ : [cfg.masterQQ]

    if (!e.group_id) {
      return masterQQs.includes(e.sender.user_id)
    }

    return PermissionManager.hasPermission(e.group_id, e.sender.user_id)
  }

  async dispatchHandler(e) {
    if (!e.msg) return false

    if (!this.checkPermission(e)) {
      return false
    }

    if (/^#i/.test(e.msg)) {
      return this.editImageHandler(e)
    }

    const tasks = this.task?.tasks || (Array.isArray(this.task) ? this.task : [])
    if (tasks && Array.isArray(tasks)) {
      for (const task of tasks) {
        if (task.trigger) {
          try {
            const reg = new RegExp(task.trigger)
            const match = reg.exec(e.msg)
            if (match && match.index === 0) {
              return this.dynamicImageHandler(e, task, match)
            }
          } catch (error) {
            logger.error(`正则匹配出错: ${task.trigger}`, error)
          }
        }
      }
    }

    return false
  }

  parseArgs(msg) {
    let aspectRatio = null
    let imageSize = null
    let promptText = msg

    promptText = promptText.replace(/：/g, ":")

    const validRatios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
    const ratioRegex = new RegExp(`(${validRatios.join("|")})`)

    const ratioMatch = promptText.match(ratioRegex)
    if (ratioMatch) {
      aspectRatio = ratioMatch[1]
      promptText = promptText.replace(ratioMatch[0], "").trim()
    }

    const sizeRegex = /([124])k/i
    const sizeMatch = promptText.match(sizeRegex)
    if (sizeMatch) {
      imageSize = sizeMatch[0].toUpperCase()
      promptText = promptText.replace(sizeMatch[0], "").trim()
    }

    return { aspectRatio, imageSize, promptText }
  }

  async dynamicImageHandler(e, matchedTask, match) {
    let imageUrls = await getImg(e, true)

    if (!imageUrls || imageUrls.length === 0) {
      return false
    }

    const matchedStr = match[0]
    const remainingMsg = e.msg.slice(matchedStr.length).trim()

    let {
      aspectRatio: userRatio,
      imageSize: userSize,
      promptText: userPrompt,
    } = this.parseArgs(remainingMsg)

    if ((!userRatio || !userSize) && match.length > 1) {
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          const { aspectRatio: groupRatio, imageSize: groupSize } = this.parseArgs(match[i])
          if (groupRatio && !userRatio) {
            userRatio = groupRatio
          }
          if (groupSize && !userSize) {
            userSize = groupSize
          }
        }
      }
    }

    let aspectRatio = userRatio || matchedTask.aspectRatio
    const validRatios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]

    if (aspectRatio && !validRatios.includes(aspectRatio)) {
      aspectRatio = null
    }

    const imageSize = userSize || "1K"

    let finalPrompt = matchedTask.prompt || ""

    if (finalPrompt && match) {
      finalPrompt = finalPrompt.replace(/\$(\d+)/g, (_, index) => match[index] || "")
    }

    if (userPrompt) {
      finalPrompt = finalPrompt ? `${finalPrompt} ${userPrompt}` : userPrompt
    }

    return this._processAndCallAPI(e, finalPrompt, imageUrls, { aspectRatio, imageSize })
  }

  async editImageHandler(e) {
    let msg = e.msg.replace(/^#i/, "").trim()
    let imageUrls = await getImg(e, true)

    const { aspectRatio, imageSize: parsedSize, promptText } = this.parseArgs(msg)

    const imageSize = parsedSize || "1K"

    if (!promptText) {
      await this.reply("请告诉我你想如何修改图片哦~ ", true, {
        recallMsg: 10,
      })
      return true
    }

    return this._processAndCallAPI(e, promptText, imageUrls, { aspectRatio, imageSize })
  }

  async _processAndCallAPI(e, promptText, imageUrls, options = {}) {
    if (e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
      await e.group.setMsgEmojiLike(e.message_id, "124")
    } else {
      await this.reply("🎨 正在进行创作, 请稍候...", false, { recallMsg: 10 })
    }

    const { aspectRatio, imageSize = "1K" } = options
    const imageInputs = []
    const hasImage = imageUrls && imageUrls.length > 0

    if (hasImage) {
      for (const imageUrl of imageUrls) {
        try {
          imageInputs.push(await fetchImageForGeneration(imageUrl))
        } catch (error) {
          logger.error("处理其中一张图片时出错:", error)
          await this.reply("处理图片时失败，请重试", true, {
            recallMsg: 10,
          })
          return true
        }
      }
    }

    try {
      const imageConfig = this.task

      const result = await generateImageWithConfig({
        imageConfig,
        prompt: promptText,
        imageInputs,
        aspectRatio,
        imageSize,
        allowVertexFallback: true,
      })

      if (result.imageBase64) {
        await this.reply(segment.image(`base64://${result.imageBase64}`))
      } else if (result.imageUrl) {
        await this.reply(segment.image(result.imageUrl))
      } else {
        await this.reply(`${result.text || "请求被拦截，请更换提示词或图片"}`, true, {
          recallMsg: 10,
        })
      }
    } catch (error) {
      logger.error(`调用图片生成 API 失败:`, error)
      await this.reply("创作失败，可能是网络问题或请求超额", true, { recallMsg: 10 })
    }

    return true
  }
}
