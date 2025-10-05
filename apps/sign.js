import plugin from "../../../lib/plugins/plugin.js"
import { createCanvas, loadImage, registerFont } from "canvas"
import path from "node:path"
import fs from "node:fs"
import _ from "lodash"
import { plugindata, pluginresources } from "../../lib/path.js"

const fontPathMain = path.join(pluginresources, "sign", "font", "FZFWZhuZiAYuanJWD.ttf")
const fontPathKaomoji = path.join(pluginresources, "sign", "font", "MotoyaMaruStd-W5.otf")
const mozeImagePath = path.join(pluginresources, "sign", "img", "moze_sig.png")

registerFont(fontPathMain, { family: "ZhuZiAYuan" })
registerFont(fontPathKaomoji, { family: "MotoyaMaru" })

const dataPath = path.join(plugindata, "sign")
if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true })
}

class SignData {
  constructor() {
    this.file = path.join(dataPath, "sign.json")
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, "{}")
    }
    this.data = JSON.parse(fs.readFileSync(this.file, "utf8"))
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  getUserData(groupId, userId) {
    if (!this.data[groupId]) {
      this.data[groupId] = {}
    }
    if (!this.data[groupId][userId]) {
      this.data[groupId][userId] = {
        lastSign: "",
        lastingTimes: 0,
        totalCoins: 0,
        totalExperience: 0,
      }
    }
    return this.data[groupId][userId]
  }

  getGroupSignRank(groupId) {
    const today = new Date().toLocaleDateString()
    let rank = 0
    if (this.data[groupId]) {
      for (const userId in this.data[groupId]) {
        if (this.data[groupId][userId].lastSign === today) {
          rank++
        }
      }
    }
    return rank + 1
  }
}

export default class DailySign extends plugin {
  constructor() {
    super({
      name: "每日签到图",
      dsc: "生成每日签到图",
      event: "message",
      priority: 100,
      rule: [
        {
          reg: "^#?签到$",
          fnc: "signIn",
        },
      ],
    })
  }

  async signIn(e) {
    this.e = e
    const groupId = e.group_id
    const userId = e.user_id
    const today = new Date().toLocaleDateString()

    const signData = new SignData()
    const userData = signData.getUserData(groupId, userId)

    if (userData.lastSign === today) {
      await this.e.reply("你今天已经签到过了哦~", true)
      return true
    }

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    if (userData.lastSign === yesterday.toLocaleDateString()) {
      userData.lastingTimes++
    } else {
      userData.lastingTimes = 1
    }

    userData.lastSign = today
    const signRanking = signData.getGroupSignRank(groupId)

    const newCoins = _.random(50, 200)
    const newExperience = _.random(10, 50)
    userData.totalCoins += newCoins
    userData.totalExperience += newExperience

    const currentLevel = Math.floor(Math.sqrt(userData.totalExperience / 100)) + 1
    const currentLevelExp = 100 * (currentLevel - 1) ** 2
    const nextLevelExp = 100 * currentLevel ** 2
    const totalExperienceInLevel = userData.totalExperience - currentLevelExp
    const nextLevelRequiredExp = nextLevelExp - currentLevelExp

    const displayData = {
      signRanking: signRanking,
      lastingTimes: userData.lastingTimes,
      newCoins: newCoins,
      totalCoins: userData.totalCoins,
      currentLevel: currentLevel,
      newExperience: newExperience,
      totalExperience: totalExperienceInLevel,
      nextLevelRequiredExp: nextLevelRequiredExp,
      currentLevelExpRange: totalExperienceInLevel / nextLevelRequiredExp,
      fortune: this.getFortune(),
      sentence: this.getSentence(),
    }

    signData.save()

    try {
      const imageBuffer = await this.generateSignImage(displayData)
      await this.e.reply(segment.image(imageBuffer))
    } catch (error) {
      logger.error("签到图生成失败:", error)
      await this.e.reply("签到图生成失败，请查看日志。")
    }

    return true
  }

  getFortune() {
    const fortunes = [
      { description: "大吉", argb: 0xfff89b59 },
      { description: "中吉", argb: 0xffa1c88a },
      { description: "小吉", argb: 0xff8ec7d2 },
      { description: "吉", argb: 0xfff1c4cd },
      { description: "末吉", argb: 0xffc8b2d3 },
      { description: "凶", argb: 0xff9e9e9e },
      { description: "大凶", argb: 0xff666666 },
    ]
    return _.sample(fortunes)
  }

  getSentence() {
    const sentences = [
      "心想事成，万事如意！",
      "今天也是元气满满的一天！",
      "愿你的每一天都充满阳光。",
      "保持好心情，好事自然来。",
      "又是努力向上的一天呢！",
    ]
    return _.sample(sentences)
  }

  async generateSignImage(data) {
    const width = 1280
    const height = 720

    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext("2d")

    const hour = new Date().getHours()
    const isNightly = hour < 6 || hour > 19

    if (isNightly) {
      this.drawNightlyBackground(ctx, width, height)
    } else {
      this.drawDaytimeBackground(ctx, width, height)
    }

    const mozeImg = await loadImage(mozeImagePath)
    this.drawMozeIllustration(ctx, mozeImg)

    this.drawTitle(ctx, isNightly)

    this.drawInfoText(ctx, data, isNightly)

    return canvas.toBuffer("image/png")
  }

  drawDaytimeBackground(ctx, width, height) {
    ctx.fillStyle = "#74AEDC"
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = "#E7EADE"
    ctx.beginPath()
    ctx.arc(1215, 45, 205, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#F1C93A"
    ctx.beginPath()
    ctx.arc(850, 1200, 565, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#F3A6BE"
    ctx.beginPath()
    ctx.arc(1300, 1250, 660, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#2594B9"
    ctx.beginPath()
    ctx.moveTo(0, 720)
    ctx.lineTo(0, 550)
    ctx.lineTo(460, 720)
    ctx.closePath()
    ctx.fill()
  }

  drawNightlyBackground(ctx, width, height) {
    ctx.fillStyle = "#22396B"
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = "#FFFAC6"
    ctx.beginPath()
    ctx.arc(1215, 45, 205, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#182D58"
    ctx.beginPath()
    ctx.moveTo(0, 720)
    ctx.lineTo(0, 550)
    ctx.lineTo(460, 720)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = "#C7CEB9"
    ctx.beginPath()
    ctx.arc(875, 1125, 450, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(1050, 1055, 400, 0, Math.PI * 2)
    ctx.fill()
  }

  drawMozeIllustration(ctx, image) {
    ctx.drawImage(image, 0, 400)
  }

  drawTitle(ctx, isNightly) {
    const hour = new Date().getHours()
    let greetingText = ""
    if (hour >= 5 && hour <= 11) greetingText = "早上好。"
    else if (hour >= 12 && hour <= 14) greetingText = "中午好。"
    else if (hour >= 15 && hour <= 19) greetingText = "下午好。"
    else greetingText = "晚上好。"

    ctx.font = "67px ZhuZiAYuan"
    ctx.fillStyle = "#E1E4DC"
    ctx.fillText(greetingText, 105, 155)

    const cuteKaomoji = [
      "ヾ(≧∇≦*)ゝ",
      "( •̀ ω •́ )*",
      "( *︾▽︾)",
      "♪(´▽｀)",
      "( •̀ ω •́ )/",
      "ヾ(^▽^*)",
      "ヾ(^∀^)ﾉ",
      "(☆▽☆)",
    ]
    const kaomoji = cuteKaomoji[Math.floor(Math.random() * cuteKaomoji.length)]

    ctx.font = "30px MotoyaMaru"
    const kaomojiWidth = ctx.measureText(kaomoji).width

    ctx.fillStyle = isNightly ? "rgba(202, 118, 133, 0.44)" : "rgba(229, 166, 191, 0.44)"
    ctx.beginPath()
    ctx.roundRect(340, 125, kaomojiWidth + 15, 45, 15)
    ctx.fill()

    ctx.fillStyle = isNightly ? "#E9A4C3" : "#FDBBD6"
    ctx.fillText(kaomoji, 345, 155)
  }

  drawInfoText(ctx, data, isNightly) {
    ctx.font = "25px ZhuZiAYuan"
    ctx.fillStyle = "#E1E4DC"
    ctx.fillText(`您今天是第       个签到的，已连续签到 ${data.lastingTimes} 天！`, 107, 203)
    ctx.fillText(`获得 ${data.newCoins} 个樱花币，现在有 ${data.totalCoins} 个樱花币。`, 107, 240)
    ctx.font = "29px ZhuZiAYuan"
    ctx.fillText(`${data.signRanking}`, 239.5, 204)

    ctx.font = "27px ZhuZiAYuan"
    ctx.fillStyle = "#E1E4DC"
    ctx.fillText(`Lv. ${data.currentLevel}`, 107, 320)

    ctx.font = "23px ZhuZiAYuan"
    ctx.fillStyle = isNightly ? "#058EC0" : "#E9B6D3"
    ctx.fillText(`经验值 + ${data.newExperience}`, 190, 320)

    ctx.fillStyle = isNightly ? "#534697" : "#E5E1D9"
    ctx.beginPath()
    ctx.roundRect(107, 335, 480 - 107, 25, 5)
    ctx.fill()

    const barWidth = (480 - 107) * data.currentLevelExpRange
    ctx.fillStyle = isNightly ? "#BEA3D5" : "#CFBBF2"
    ctx.beginPath()
    ctx.roundRect(107, 335, barWidth, 25, 5)
    ctx.fill()

    ctx.font = "25px ZhuZiAYuan"
    ctx.fillStyle = isNightly ? "#534697" : "#E5E1D9"
    ctx.fillText(`${data.totalExperience} / ${data.nextLevelRequiredExp}`, 490, 355)

    ctx.font = "25px ZhuZiAYuan"
    ctx.fillStyle = "#E1E4DC"
    ctx.fillText("今日运势", 410, 505)

    ctx.font = "53.5px ZhuZiAYuan"
    const fortuneColor = "#" + (data.fortune.argb & 0x00ffffff).toString(16).padStart(6, "0")
    ctx.fillStyle = fortuneColor
    ctx.fillText(data.fortune.description, 410, 560)

    ctx.font = "27px ZhuZiAYuan"
    const sentenceWidth = ctx.measureText(data.sentence).width
    ctx.fillStyle = isNightly ? "rgba(153, 156, 149, 0.44)" : "rgba(205, 208, 200, 0.44)"
    ctx.beginPath()
    ctx.roundRect(400, 575, sentenceWidth + 20, 35, 15)
    ctx.fill()
    ctx.fillStyle = "#E1E4DC"
    ctx.fillText(data.sentence, 410, 600)

    const now = new Date()
    const formattedDate = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`

    ctx.font = "30px ZhuZiAYuan"
    ctx.fillStyle = "#E1E4DC"
    ctx.fillText(formattedDate, 920, 545)

    ctx.font = "16px ZhuZiAYuan"
    const footerText = "Generated By MozeBot"
    const footerWidth = ctx.measureText(footerText).width
    const dateWidth = ctx.measureText(formattedDate).width
    const startX = 920 + dateWidth - footerWidth
    ctx.fillText(footerText, startX, 571.3)
  }
}
