import cfg from "../../../lib/config/config.js"
import common from "../../../lib/common/common.js"
import moment from "moment"
import path from "path"
import { pluginresources, plugindata } from "../lib/path.js"
import { yandeimage, buildStickerMsg } from "../lib/ImageUtils/ImageUtils.js"
import Setting from "../lib/setting.js"
import _ from "lodash"
import { getAI } from "../lib/AIUtils/getAI.js"
import adapter from "../lib/adapter.js"
import fsp from "fs/promises"

export class poke extends plugin {
  constructor() {
    super({
      name: "戳一戳",
      dsc: "戳一戳机器人触发效果",
      event: "notice.group.poke",
      priority: 1135,
      rule: [
        {
          reg: ".*",
          fnc: "poke_function",
          log: false,
        },
      ],
    })
  }

  get appconfig() {
    return Setting.getConfig("poke")
  }

  get botname() {
    return this.appconfig.botname
  }

  async checkCD(key, duration) {
    const exists = await redis.get(key)
    if (exists) return true
    await redis.set(key, "1", { EX: duration })
    return false
  }

  async setIgnore(userId, duration) {
    await redis.set(`Mz:poke:ignore:${userId}`, "1", { EX: duration / 1000 })
  }

  async checkIgnore(userId) {
    return await redis.get(`Mz:poke:ignore:${userId}`)
  }

  async setShouldReply(userId, duration) {
    await redis.set(`Mz:poke:shouldReply:${userId}`, "1", { EX: duration / 1000 })
  }

  async checkShouldReply(userId) {
    return await redis.get(`Mz:poke:shouldReply:${userId}`)
  }

  async setIgnorePoke(groupId, duration) {
    await redis.set(`Mz:poke:ignorePoke:${groupId}`, "1", { EX: duration / 1000 })
  }

  async checkIgnorePoke(groupId) {
    return await redis.get(`Mz:poke:ignorePoke:${groupId}`)
  }

  async getMemberInfo(e, userId) {
    try {
      return await e.group.pickMember(userId).getInfo(true)
    } catch {
      return (await e.group.pickMember(Number(userId))).info
    }
  }

  sendImage(file) {
    if (adapter === 0) {
      return segment.image(file)
    } else {
      return buildStickerMsg(file)
    }
  }

  getPokeImagePath(filename) {
    return path.join(pluginresources, "poke", filename)
  }

  async checkAndMute(e, duration) {
    const bot = await this.getMemberInfo(e, e.self_id)
    const member = await this.getMemberInfo(e, e.operator_id)

    if (bot.role !== "admin" && bot.role !== "owner") {
      return false
    }

    if (member.role === "admin" || member.role === "owner") {
      return false
    }

    await e.group.muteMember(e.operator_id, duration)
    logger.info(`[戳一戳] 用户 ${e.operator_id} 已被禁言 ${duration} 秒。`)
    return true
  }

  async getAIReply(e, promptText) {
    const personas = this.appconfig.personas
    let systemInstruction = ""

    if (personas && personas.length > 0) {
      const personaName = _.sample(personas)

      const rolesConfig = Setting.getConfig("roles")
      const roles = rolesConfig?.roles || []
      const role = roles.find(r => r.name === personaName)

      if (role && role.prompt) {
        systemInstruction = role.prompt
      }
    } else {
      logger.warn("[戳一戳] 人设配置文件中未找到或其为空，将使用无设定的默认回复。")
    }

    const queryParts = [{ text: promptText }]
    const Channel = Setting.getConfig("AI").appschannel
    try {
      const result = await getAI(Channel, e, queryParts, systemInstruction, false, false, [])
      if (!result.text || result.text.trim() === "") {
        logger.warn("[戳一戳] AI 返回空回复")
        return false
      }
      return result.text
    } catch (error) {
      logger.error(`[戳一戳] AI 调用失败: ${error}`)
      return false
    }
  }

  async poke_function(e) {
    const pokeConfig = this.appconfig
    if (!pokeConfig) {
      logger.error("[戳一戳] 获取配置失败")
      return false
    }

    const replyKeys = [
      "masterReplies",
      "genericTextReplies",
      "pokeBackTextReplies",
      "countRepliesGroup",
      "countRepliesUser",
    ]
    for (const key of replyKeys) {
      if (typeof pokeConfig[key] === "string") {
        pokeConfig[key] = pokeConfig[key].split("\n").filter(line => line.trim() !== "")
      }
    }

    if (!pokeConfig.enable) {
      return false
    }

    logger.info(`[戳一戳] 群 ${e.group_id} 中 ${e.operator_id} 戳了戳 ${e.target_id}`)

    if (await this.checkIgnorePoke(e.group_id)) {
      return false
    }

    if (await this.checkIgnore(e.operator_id)) {
      return false
    }

    if (await this.checkShouldReply(e.operator_id)) {
      await e.reply("姑且还是理你一下吧...")
      await common.sleep(500)
      await e.reply(this.sendImage(this.getPokeImagePath("5.gif")))
      await redis.del(`Mz:poke:shouldReply:${e.operator_id}`)
      return false
    }

    if (cfg.masterQQ.includes(e.target_id)) {
      return await this.handlePokeMaster(e, pokeConfig)
    }

    if (e.target_id == e.self_id) {
      return await this.handlePokeBot(e, pokeConfig)
    }

    return false
  }

  async handlePokeMaster(e, pokeConfig) {
    if (await this.checkCD(`Mz:poke:cd:master:${e.group_id}`, 60)) {
      return false
    }

    const retype = _.random(1, 2)
    let success = false

    if (retype === 1) {
      const msg = await this.getAIReply(e, "(其他人戳一下主人)")
      if (msg !== false) {
        const replyMsg = [segment.at(e.operator_id), msg]
        await e.reply(replyMsg)
        success = true
      }
    } else {
      const bot = await this.getMemberInfo(e, e.self_id)

      if (bot && bot.role !== "member") {
        const member = await this.getMemberInfo(e, e.operator_id)
        const Name = member?.card || member?.nickname || member.user_id

        const queryParts = [
          {
            text: `请把"${Name}"这个名字变得更中二病一些，请只输出一个新名字。`,
          },
        ]
        const Channel = Setting.getConfig("AI").appschannel
        try {
          const result = await getAI(Channel, e, queryParts, null, false, false, [])
          if (result.text && result.text.trim() !== "") {
            const newCard = result.text
            await e.group.setCard(e.operator_id, newCard)
            success = true
          } else {
            logger.warn("[戳一戳] AI 返回空名字")
          }
        } catch (error) {
          logger.error(`[戳一戳] 改名 AI 调用失败: ${error}`)
        }
      }
    }

    if (!success) {
      const msg = _.sample(pokeConfig.masterReplies)
      await e.reply(msg)
    }

    return false
  }

  async handlePokeBot(e, pokeConfig) {
    if (await this.checkCD(`Mz:poke:cd:bot:${e.group_id}`, 3)) {
      return false
    }

    let time = moment(Date.now()).add(1, "days").format("YYYY-MM-DD 00:00:00")
    let exTime = Math.round((new Date(time).getTime() - new Date().getTime()) / 1000)

    let count = await redis.get(`Mz:pokecount:${e.group_id}`)
    count = count ? parseInt(count) + 1 : 1
    await redis.set(`Mz:pokecount:${e.group_id}`, count, { EX: exTime })

    let usercount = await redis.get(`Mz:pokecount:${e.group_id}:${e.operator_id}`)
    usercount = usercount ? parseInt(usercount) + 1 : 1
    await redis.set(`Mz:pokecount:${e.group_id}:${e.operator_id}`, usercount, { EX: exTime })

    let time_A = moment(Date.now()).add(20, "minutes").format("YYYY-MM-DD HH:mm:ss")
    let exTime_A = Math.round((new Date(time_A).getTime() - new Date().getTime()) / 1000)

    let counter = await redis.get(`Mz:pokecount_A:${e.group_id}`)
    counter = counter ? parseInt(counter) + 1 : 1
    await redis.set(`Mz:pokecount_A:${e.group_id}`, counter, { EX: exTime_A })

    switch (counter) {
      case 1:
        const type = _.random(1, 2)
        if (type === 1) {
          await e.reply(this.sendImage(this.getPokeImagePath("1.gif")))
        } else {
          await e.reply(this.sendImage(this.getPokeImagePath("2.gif")))
        }
        return false
      case 5:
        await e.reply(this.sendImage(this.getPokeImagePath("3.gif")))
        await common.sleep(500)
        await this.checkAndMute(e, 60 * usercount)
        await common.sleep(1000)
        await e.reply("不~")
        await common.sleep(1000)
        await e.reply("准~")
        await common.sleep(1000)
        await e.reply("戳~！")
        return false

      case 10:
        await e.reply("你好烦呀,不想理你了!")
        await common.sleep(500)
        await e.reply(this.sendImage(this.getPokeImagePath("4.gif")))

        const ignoreDuration = 60000 * usercount
        await this.setIgnore(e.operator_id, ignoreDuration)
        await this.setShouldReply(e.operator_id, ignoreDuration + 600000)

        return false

      case 20:
        const muteSuccess = await this.checkAndMute(e, 60 * usercount)
        if (muteSuccess) {
          await e.reply(`这就是欺负${this.botname}的下场!`)
          await common.sleep(500)
          await e.reply(this.sendImage(this.getPokeImagePath("6.gif")))
        } else {
          const bot = await this.getMemberInfo(e, e.self_id)

          if (bot && bot.role !== "member") {
            const member = await this.getMemberInfo(e, e.operator_id)
            const currentName = member?.card || member?.nickname || member.user_id

            const queryParts = [
              {
                text: `请把"${currentName}"这个名字变得更笨、更傻、更蠢一些，要带有贬义和嘲讽意味，请只输出一个新名字。`,
              },
            ]
            const Channel = Setting.getConfig("AI").appschannel
            try {
              const result = await getAI(Channel, e, queryParts, null, false, false, [])
              if (result.text && result.text.trim() !== "") {
                const newCard = result.text.trim()
                await e.group.setCard(e.operator_id, newCard)
                await e.reply(`这就是欺负${this.botname}的下场！`)
                await common.sleep(500)
                await e.reply(this.sendImage(this.getPokeImagePath("6.gif")))
              } else {
                logger.warn("[戳一戳] AI 返回空名字，回退到文本回复")
                await this.replyWithText(e, pokeConfig, count, usercount)
              }
            } catch (error) {
              logger.error(`[戳一戳] 改名 AI 调用失败: ${error}，回退到文本回复`)
              await this.replyWithText(e, pokeConfig, count, usercount)
            }
          } else {
            await this.replyWithText(e, pokeConfig, count, usercount)
          }
        }

        return false

      case 30:
        await e.reply("被戳、戳晕了...")
        await e.reply(this.sendImage(this.getPokeImagePath("7.gif")))
        await this.setIgnorePoke(e.group_id, 600000)
        return false

      case 31:
        await e.reply("突然惊醒！")
        await common.sleep(500)
        await e.reply(this.sendImage(this.getPokeImagePath("8.gif")))
        return false

      case 40:
        await e.reply("被戳、戳坏掉了...")
        await common.sleep(500)
        await e.reply("可能再也不会醒来了...")
        await common.sleep(500)
        await e.reply(this.sendImage(this.getPokeImagePath("9.gif")))
        return false

      case 41:
      case 42:
      case 43:
      case 44:
      case 45:
      case 46:
      case 47:
      case 48:
      case 49:
      case 50:
        return false

      case 51:
        await e.reply("居然把我给戳醒了，接下来再戳会发生什么可不关我事哟~")
        return false

      case 60:
        await e.reply(`${this.botname}彻底被玩坏了...`)
        await common.sleep(500)
        await e.reply("可能永远都不会醒来了...")
        await this.setIgnorePoke(e.group_id, 1200000)
        return false
    }

    const random = _.random(1, 100)

    if (random <= 40) {
      await this.replyWithText(e, pokeConfig, count, usercount)
    } else if (random <= 70) {
      await this.replyWithImage(e, pokeConfig, count, usercount)
    } else if (random <= 80) {
      await this.replyWithPokeBack(e, pokeConfig)
    } else {
      await this.replyWithSpecialEasterEgg(e)
    }

    return false
  }

  async replyWithText(e, pokeConfig, count, usercount) {
    const retype = _.random(1, 4)

    if (retype === 1) {
      const msg = _.sample(pokeConfig.genericTextReplies)
      await e.reply(msg.replace(/_botname_/g, this.botname))
    } else if (retype === 2) {
      const promptText = cfg.masterQQ.includes(e.operator_id)
        ? "(主人戳你一下)"
        : "(其他人戳你一下)"
      const msg = await this.getAIReply(e, promptText)
      if (msg !== false) {
        const replyMsg = [segment.at(e.operator_id), msg]
        await e.reply(replyMsg)
      } else {
        await e.reply(this.sendImage(this.getPokeImagePath("12.gif")))
      }
    } else if (retype === 3) {
      try {
        const response = await fetch("https://60s.viki.moe/v2/fabing")
        const result = await response.json()

        if (result && result.code === 200 && result.data && result.data.saying) {
          await e.reply(result.data.saying)
        } else {
          const msg = _.sample(pokeConfig.genericTextReplies)
          await e.reply(msg.replace(/_botname_/g, this.botname))
        }
      } catch (error) {
        logger.error("请求 API 时出错, 已回退:", error)
        const msg = _.sample(pokeConfig.genericTextReplies)
        await e.reply(msg.replace(/_botname_/g, this.botname))
      }
    } else {
      const countType = _.random(1, 2)
      if (countType === 1) {
        const msg = _.sample(pokeConfig.countRepliesGroup)
        await e.reply(msg.replace("_num_", count).replace(/_botname_/g, this.botname))
      } else {
        const msg = _.sample(pokeConfig.countRepliesUser)
        await e.reply(msg.replace("_num_", usercount).replace(/_botname_/g, this.botname))
      }
    }
  }

  async replyWithImage(e, pokeConfig, count, usercount) {
    try {
      const emojiRootDir = path.join(plugindata, "EmojiThief")
      let emojiPath

      const groupDirs = (await fsp.readdir(emojiRootDir, { withFileTypes: true }))
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)

      if (groupDirs.length > 0) {
        const randomGroupDir = groupDirs[_.random(0, groupDirs.length - 1)]
        const groupDirPath = path.join(emojiRootDir, randomGroupDir)
        const files = await fsp.readdir(groupDirPath)
        if (files.length > 0) {
          const randomIndex = _.random(0, files.length - 1)
          emojiPath = path.join(groupDirPath, files[randomIndex])
        }
      }

      if (emojiPath) {
        await e.reply(this.sendImage(emojiPath))
      } else {
        await this.replyWithText(e, pokeConfig, count, usercount)
      }
    } catch (error) {
      await this.replyWithText(e, pokeConfig, count, usercount)
    }
  }

  async replyWithPokeBack(e, pokeConfig) {
    const retype = _.random(1, 6)

    switch (retype) {
      case 1:
        await e.reply("戳回去(=°ω°)ノ")
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        setTimeout(() => {
          const followUpReplies = [`${this.botname}可不是好欺负的!`, "哼(￢︿̫̿￢☆)", "(ˉ▽￣～) 切~~"]
          const msg = _.sample(followUpReplies)
          e.reply(msg)
        }, 500)
        break

      case 2:
        const msg_text = _.sample(pokeConfig.pokeBackTextReplies)
        await e.reply(msg_text.replace(/_botname_/g, this.botname))
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        break

      case 3:
        await e.reply("呜呜呜……这样到处摸的话……")
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.reply("我也会把你摸回来的！")
        break
    }
  }

  async replyWithSpecialEasterEgg(e) {
    const retype = _.random(1, 7)

    switch (retype) {
      case 1:
        await e.reply("救命啊，有变态>_<！！！")
        await common.sleep(500)
        await e.reply(this.sendImage(this.getPokeImagePath("10.gif")))
        break
      case 2:
        await e.reply("咳哈哈哈哈——！")
        await common.sleep(500)
        await e.reply(this.sendImage(this.getPokeImagePath("11.gif")))
        await common.sleep(500)
        await e.reply("别挠我痒痒了！")
        await common.sleep(500)
        await e.reply("好痒啊！")
        break
      case 3:
        await e.reply("就、就算那样戳我，也不会掉落什么哦……")
        await common.sleep(500)
        await e.reply(`${this.botname}又不是怪物！`)
        break
      case 4:
        await e.reply("这样几次挠我痒痒会很困扰的呢。")
        await common.sleep(500)
        await e.reply("你啊，意外地喜欢恶作剧吧？")
        break
      case 5:
        await e.reply("戳中宝藏啦！是一张涩图！")
        const apiUrl = "https://yande.re/post.json?tags=loli+-rating:e+-nipples&limit=500"
        const imageUrl = await yandeimage(apiUrl)
        if (imageUrl) {
          const result = await e.reply(segment.image(imageUrl))
          if (!result?.message_id) {
            await e.reply("嘻嘻，骗你的，其实根本没有涩图~")
          }
        }
        break
      case 6:
        await e.reply("把嘴张开（抬起脚）")
        const feet_apiUrl = "https://yande.re/post.json?tags=feet+-rating:e+-nipples&limit=500"
        const feet_imageUrl = await yandeimage(feet_apiUrl)
        if (feet_imageUrl) {
          const result = await e.reply(segment.image(feet_imageUrl))
          if (!result?.message_id) {
            await e.reply("你还真张嘴了啊（收起脚），想得美~")
          }
        }
        break
      case 7:
        await e.reply("在这里无意义地消耗着时间，这……")
        await common.sleep(5000)
        await e.reply("没、没有，我并没有讨厌……")
        break
      case 8:
        for (let i = 0; i < 10; i++) {
          await e.group.pokeMember(e.operator_id)
          await common.sleep(500)
        }
        await e.reply(`超级加倍！让你见识一下${this.botname}的厉害！`)
        await common.sleep(1000)
        break
      case 9:
        await e.reply("嗯？什么？戳戳对方的游戏？")
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.reply("我也不会输哦！")
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.reply("喝！")
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.reply("哈！")
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        await common.sleep(500)
        await e.group.pokeMember(e.operator_id)
        break
      case 10:
        await e.reply("觉得我不会反击就为所欲为……做好觉悟吧！")
        await common.sleep(500)
        for (let i = 0; i < 11; i++) {
          await e.group.pokeMember(e.operator_id)
          await common.sleep(500)
        }
        break
    }
  }
}
