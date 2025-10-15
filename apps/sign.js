import plugin from "../../../lib/plugins/plugin.js"
import path from "node:path"
import fs from "node:fs"
import _ from "lodash"
import { plugindata } from "../lib/path.js"
import ImageGenerator from "../lib/sign/ImageGenerator.js"

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

  getTodaySignCount(groupId) {
    const today = new Date().toLocaleDateString()
    let count = 0
    if (this.data[groupId]) {
      for (const userId in this.data[groupId]) {
        if (this.data[groupId][userId].lastSign === today) {
          count++
        }
      }
    }
    return count
  }
}

export default class DailySign extends plugin {
  constructor() {
    super({
      name: "每日签到图",
      dsc: "生成每日签到图",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^#?签到$",
          fnc: "signIn",
          log: false,
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

    const signedInCount = signData.getTodaySignCount(groupId)
    const signRanking = signedInCount + 1

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    if (userData.lastSign === yesterday.toLocaleDateString()) {
      userData.lastingTimes++
    } else {
      userData.lastingTimes = 1
    }

    userData.lastSign = today

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
      sentence: await this.getSentence(),
    }

    signData.save()

    try {
      const imageGenerator = new ImageGenerator()
      const imageBuffer = await imageGenerator.generateSignImage(displayData)
      await this.e.reply(segment.image(imageBuffer))
    } catch (error) {
      logger.error("签到图生成失败:", error)
      await this.e.reply("签到失败~")
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

  async getSentence() {
    try {
      const response = await fetch('https://international.v1.hitokoto.cn/')
      const data = await response.json()
      return data.hitokoto
    } catch (error) {
      logger.warn("获取一言失败，使用本地句子:", error)
      const sentences = [
        "心想事成，万事如意！",
        "今天也是元气满满的一天！",
        "愿你的每一天都充满阳光。",
        "保持好心情，好事自然来。",
        "又是努力向上的一天呢！",
      ]
      return _.sample(sentences)
    }
  }
}
