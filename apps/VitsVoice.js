import axios from "axios"
import { randomEmojiLike, makeForwardMsg } from "../lib/utils.js"
import setting from "../lib/setting.js"

const API_URL = "https://mikusfan-vits-uma-genshin-honkai.hf.space/api/predict"
let speakersCache = []

export class VitsVoice extends plugin {
  constructor() {
    super({
      name: "VitsVoice",
      dsc: "VITS语音合成插件",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^#?(.+)?说\\s+(.*)$",
          fnc: "vitsSpeak",
          log: false,
        },
        {
          reg: "^#?搜索语音角色(.*)$",
          fnc: "searchSpeaker",
          log: false,
        },
        {
          reg: "^#?语音角色列表\\s*(\\d*)$",
          fnc: "getSpeakersList",
          log: false,
        },
        {
          reg: "^#?切换语音(.*)$",
          fnc: "changeDefaultSpeaker",
        },
      ],
    })
  }

  async vitsSpeak(e) {
    let msg = e.msg.replace(/^#/, "")
    let config = setting.getConfig("VitsVoice")
    let speaker = config.defaultSpeaker || "派蒙"
    let text = ""

    if (msg.startsWith("说")) {
      text = msg.substring(1).trim()
    } else {
      const match = msg.match(/^(.+?)说\s+(.*)$/)
      if (match) {
        speaker = match[1].trim()
        text = match[2].trim()
      } else {
        return false
      }
    }

    if (!text) return false
    if (e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
      await e.group.setMsgEmojiLike(e.message_id, "124")
    }
    let lang = "中文"
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
      lang = "日语"
    } else if (/^[a-zA-Z\s,.?!]+$/.test(text)) {
      lang = "English"
    }

    let noise_scale = 0.6
    let noise_scale_w = 0.668
    let length_scale = 1.2

    try {
      const payload = {
        fn_index: 0,
        data: [text, lang, speaker, noise_scale, noise_scale_w, length_scale],
        session_hash: Math.random().toString(36).substring(2),
      }

      const response = await axios.post(API_URL, payload)
      const data = response.data

      if (data.data && data.data[1]) {
        const audioData = data.data[1]

        if (audioData.data) {
          const base64 = audioData.data.split(",")[1]
          const buffer = Buffer.from(base64, "base64")
          await e.reply(segment.record(buffer))
        } else if (audioData.name) {
          const audioUrl = `https://mikusfan-vits-uma-genshin-honkai.hf.space/file=${audioData.name}`
          await e.reply(segment.record(audioUrl))
        } else {
          await this.reply("API 返回数据格式异常，无法获取音频。", true, { recallMsg: 10 })
          logger.warn(`[VitsVoice] API Response Error: ${JSON.stringify(data)}`)
        }
      } else {
        await this.reply("生成失败，API 未返回有效数据。可能是角色名不正确或服务繁忙。", true, {
          recallMsg: 10,
        })
        logger.warn(`[VitsVoice] API Error Response: ${JSON.stringify(data)}`)
      }
    } catch (err) {
      let errMsg = err.message
      if (err.response) {
        errMsg += ` [Status: ${err.response.status}]`
        if (err.response.data) {
          errMsg += ` [Data: ${JSON.stringify(err.response.data).substring(0, 100)}...]`
        }
      }
      logger.error(`[VitsVoice] 语音生成出错: ${errMsg}`)
      await this.reply("语音生成出错，请稍后再试。", true, { recallMsg: 10 })
    }
  }

  async searchSpeaker(e) {
    let keyword = e.msg.replace(/^#?搜索语音角色\s*/, "").trim()
    if (!keyword) {
      return false
    }
    if (e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
      await e.group.setMsgEmojiLike(e.message_id, "124")
    }
    try {
      const payload = {
        fn_index: 2,
        data: [keyword],
        session_hash: Math.random().toString(36).substring(2),
      }

      const response = await axios.post(API_URL, payload)
      const data = response.data

      if (data.data && data.data[0]) {
        const result = data.data[0]
        if (typeof result === "string") {
          await e.reply(`找到角色：${result}`)
        } else if (Array.isArray(result)) {
          await e.reply(`找到角色：${result.join(", ")}`)
        } else if (result && result.choices) {
          await e.reply(`找到角色：${result.choices.join(", ")}`)
        } else {
          await e.reply(`搜索结果：${JSON.stringify(result)}`)
        }
      } else {
        await this.reply("未找到相关角色。", true, { recallMsg: 10 })
      }
    } catch (err) {
      let errMsg = err.message
      if (err.response) {
        errMsg += ` [Status: ${err.response.status}]`
      }
      logger.error(`[VitsVoice] 搜索出错: ${errMsg}`)
      await this.reply("搜索出错，请稍后再试。", true, { recallMsg: 10 })
    }
  }

  async getSpeakersList(e) {
    if (e.isGroup && typeof e.group?.setMsgEmojiLike === "function") {
      await e.group.setMsgEmojiLike(e.message_id, "124")
    }
    if (!speakersCache || speakersCache.length === 0) {
      try {
        const response = await axios.get("https://mikusfan-vits-uma-genshin-honkai.hf.space/config")
        const component = response.data.components.find(c => c.id === 13)
        if (component && component.props && component.props.choices) {
          speakersCache = component.props.choices
        }
      } catch (err) {
        logger.error("[VitsVoice] 获取角色列表失败", err)
        return this.reply("获取角色列表失败，请稍后再试。", true, { recallMsg: 10 })
      }
    }

    if (!speakersCache || speakersCache.length === 0) {
      return this.reply("未获取到角色列表。", true, { recallMsg: 10 })
    }

    let forwardData = []
    for (let i = 0; i < speakersCache.length; i += 50) {
      const chunk = speakersCache.slice(i, i + 50)
      forwardData.push({
        text: chunk.join("，"),
        senderId: Bot.uin,
        senderName: Bot.nickname,
      })
    }

    await makeForwardMsg(e, forwardData, `语音角色列表（共${speakersCache.length}个）`)
  }

  async changeDefaultSpeaker(e) {
    let newSpeaker = e.msg.replace(/^#?切换语音\s*/, "").trim()
    if (!newSpeaker) {
      return false
    }

    setting.setConfig("VitsVoice", { defaultSpeaker: newSpeaker })
    await this.reply(`默认语音角色已切换为：${newSpeaker}`, false, { recallMsg: 10 })
  }
}
