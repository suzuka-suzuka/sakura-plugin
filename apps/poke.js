import cfg from "../../../lib/config/config.js"
import common from "../../../lib/common/common.js"
import moment from "moment"
import path from "path"
import { pluginresources } from "../lib/path.js"
import { getgif, yandeimage, buildStickerMsg } from "../lib/ImageUtils/ImageUtils.js"
import Setting from "../lib/setting.js"
import _ from "lodash"
import { getAI } from "../lib/AIUtils/getAI.js"

let CD = false
let CD_A = false
let ignoreList = {}
let shouldReply = {}
let ignorePoke = {}
let nextreply = {}

const reply_sp = 0.12
const reply_poke = 0.08
const reply_text = 0.38
const reply_num = 0.02

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

  async sendgif(e) {
    const apiUrl =
      "https://tenor.googleapis.com/v2/search?key=AIzaSyB48anIc9rAPLKYkv-asoF_GtNsZ5_ricg&q=anime&media_filter=gif&random=true&limit=1"
    const imageBuffer = await getgif(apiUrl)
    await e.reply(buildStickerMsg(imageBuffer))
  }

  getPokeImagePath(filename) {
    return path.join(pluginresources, "poke", filename)
  }

  async checkAndMute(e, duration) {
    const group = e.bot.pickGroup(e.group_id)
    const bot = await group.pickMember(e.self_id)
    const member = await group.pickMember(e.operator_id)

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
      const selectedPersona = _.sample(personas)
      systemInstruction = selectedPersona.Prompt
    } else {
      logger.warn("[戳一戳] 人设配置文件中未找到或其为空，将使用无设定的默认回复。")
    }

    const queryParts = [{ text: promptText }]
    const Channel = "2.5"
    try {
      const result = await getAI(Channel, e, queryParts, systemInstruction, false, false, [])
      return result.text || "唔...被戳的坏掉了"
    } catch (error) {
      logger.error(`[戳一戳] AI 调用失败: ${error}`)
      return "唔...被戳的坏掉了"
    }
  }

  async poke_function(e) {
    const pokeConfig = this.appconfig
    if (!pokeConfig) {
      logger.error("[戳一戳] 获取配置失败")
      return false
    }

    const replyKeys = [
      "MASTER_REPLIES",
      "GENERIC_TEXT_REPLIES",
      "COUNT_REPLIES_GROUP",
      "COUNT_REPLIES_USER",
      "POKE_BACK_TEXT_REPLIES",
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
    if (ignorePoke[e.group_id]) {
      return false
    }

    if (ignoreList[e.operator_id]) {
      return false
    }

    if (shouldReply[e.operator_id]) {
      e.reply("姑且还是理你一下吧...")
      await common.sleep(500)
      e.reply(buildStickerMsg(this.getPokeImagePath("5.gif")))
      delete shouldReply[e.operator_id]
      return false
    }

    if (cfg.masterQQ.includes(e.operator_id) && e.target_id == e.self_id) {
      let msg = await this.getAIReply(e, "(主人戳你一下)")
      await e.reply(msg)
    } else if (cfg.masterQQ.includes(e.target_id)) {
      if (CD) {
        return false
      } else {
        CD = true
        setTimeout(function () {
          CD = false
        }, 40000)
        let retype = _.random(1, 3)
        if (retype === 1) {
          let msg = _.sample(pokeConfig.MASTER_REPLIES)
          await e.reply(msg)
        } else if (retype === 2) {
          const groupId = e.group_id
          const group = e.bot.pickGroup(groupId)
          const memberMap = await group.getMemberMap(true)
          const botMember = memberMap.get(e.bot.uin)

          if (botMember && botMember.role !== "member") {
            const senderId = e.operator_id
            const senderMember = e.group.pickMember(senderId)
            await senderMember.getInfo(true)
            const Name = senderMember.card || senderMember.nickname

            const queryParts = [
              {
                text: `请把“${Name}”这个名字变得更中二病一些，请只输出一个新名字。`,
              },
            ]
            const Channel = "2.5"
            const result = await getAI(Channel, e, queryParts, null, false, false, [])
            const newCard = result.text
            await group.setCard(senderId, newCard)
          } else {
            let msg = _.sample(pokeConfig.MASTER_REPLIES)
            await e.reply(msg)
          }
        } else {
          let msg = await this.getAIReply(e, "(其他人戳一下主人)")
          const qq = e.operator_id
          const replyMsg = [segment.at(qq), msg]
          await e.reply(replyMsg)
        }
      }
      return false
    } else if (e.target_id == e.self_id) {
      if (CD_A) {
        return false
      } else {
        CD_A = true
        setTimeout(function () {
          CD_A = false
        }, 3000)

        if (nextreply[e.operator_id]) {
          e.reply("我已经理解了，你现在没有什么要做的事了，很有空闲呢。")
          delete nextreply[e.operator_id]
          return false
        }

        let count = await redis.get(`Mz:pokecount:${e.group_id}`)
        let usercount = await redis.get(`Mz:pokecount:${e.group_id}` + e.operator_id + ":")
        let time = moment(Date.now()).add(1, "days").format("YYYY-MM-DD 00:00:00")
        let exTime = Math.round((new Date(time).getTime() - new Date().getTime()) / 1000)
        if (!count) {
          await redis.set(`Mz:pokecount:${e.group_id}`, 1 * 1, { EX: exTime })
          count = 1
        } else {
          await redis.set(`Mz:pokecount:${e.group_id}`, ++count, { EX: exTime })
        }
        if (!usercount) {
          await redis.set(`Mz:pokecount:${e.group_id}` + e.operator_id + ":", 1 * 1, { EX: exTime })
          usercount = 1
        } else {
          await redis.set(`Mz:pokecount:${e.group_id}` + e.operator_id + ":", ++usercount, {
            EX: exTime,
          })
        }

        let counter = await redis.get(`Mz:pokecount_A:${e.group_id}`)
        let time_A = moment(Date.now()).add(20, "minutes").format("YYYY-MM-DD HH:mm:ss")
        let exTime_A = Math.round((new Date(time_A).getTime() - new Date().getTime()) / 1000)
        if (!counter) {
          await redis.set(`Mz:pokecount_A:${e.group_id}`, 1 * 1, { EX: exTime_A })
          counter = "1"
        } else {
          await redis.set(`Mz:pokecount_A:${e.group_id}`, ++counter, { EX: exTime_A })
          counter = String(counter)
        }

        switch (counter) {
          case "1":
            e.reply(buildStickerMsg(this.getPokeImagePath("1.gif")))
            break
          case "5":
            e.reply(buildStickerMsg(this.getPokeImagePath("2.gif")))
            await common.sleep(500)
            await this.checkAndMute(e, 60 * (usercount + 1))
            await common.sleep(1000)
            e.reply("不~")
            await common.sleep(1000)
            e.reply("准~")
            await common.sleep(1000)
            e.reply("戳~！")

            break
          case "10":
            e.reply("你好烦呀,不想理你了!")
            await common.sleep(500)
            e.reply(buildStickerMsg(this.getPokeImagePath("3.gif")))
            ignoreList[e.operator_id] = true
            const userIdToIgnore = e.operator_id
            const ignoreDuration = 60000 * (usercount + 1)
            setTimeout(() => {
              delete ignoreList[userIdToIgnore]
              shouldReply[userIdToIgnore] = true
              logger.info(`[戳一戳]  ${userIdToIgnore} 忽略结束，shouldReply 标记已设置.`)
              setTimeout(() => {
                if (shouldReply[userIdToIgnore]) {
                  delete shouldReply[userIdToIgnore]
                  logger.info(`[戳一戳]  ${userIdToIgnore} 的 shouldReply 标记已过期.`)
                }
              }, 600000)
            }, ignoreDuration)
            break
          case "15":
            e.reply(buildStickerMsg(this.getPokeImagePath("1.jpg")))
            await common.sleep(500)
            if (await this.checkAndMute(e, 60 * (usercount + 1))) {
              await common.sleep(1000)
              e.reply("别得寸进尺啊你")
            }
            break
          case "25":
            e.reply(buildStickerMsg(this.getPokeImagePath("2.jpg")))
            await common.sleep(500)
            if (await this.checkAndMute(e, 60 * (usercount + 1))) {
              await common.sleep(1000)
              e.reply("这就是欺负小叶的下场!")
            }
            break
          case "30":
            e.reply("被戳、戳晕了...")
            e.reply(buildStickerMsg(this.getPokeImagePath("4.gif")))
            ignorePoke[e.group_id] = true
            setTimeout(() => {
              ignorePoke[e.group_id] = false
            }, 600000)
            break
          case "31":
            e.reply(this.getPokeImagePath("3.jpg"))
            await common.sleep(500)
            e.reply("突然惊醒！")
            break
          case "40":
            e.reply("被戳、戳坏掉了...")
            await common.sleep(500)
            e.reply(this.getPokeImagePath("4.jpg"))
            await common.sleep(1000)
            e.reply("可能再也不会醒来了...")
            ignorePoke[e.group_id] = true
            setTimeout(() => {
              ignorePoke[e.group_id] = false
            }, 1200000)
            break

          case "41":
          case "42":
          case "43":
          case "44":
          case "45":
          case "46":
          case "47":
          case "48":
          case "49":
          case "50":
            return false
          case "51":
            e.reply("居然把我给戳醒了，接下来再戳会发生什么可不关我事哟~")
            break
          case "52":
            e.reply(this.getPokeImagePath("5.jpg"))
            break
          case "53":
            e.reply(this.getPokeImagePath("6.jpg"))
            break
          case "54":
            e.reply(this.getPokeImagePath("7.jpg"))
            break
          case "55":
            e.reply(this.getPokeImagePath("8.jpg"))
            break
          case "56":
            e.reply(this.getPokeImagePath("9.jpg"))
            break
          case "57":
            e.reply(this.getPokeImagePath("10.jpg"))
            break
          case "58":
            e.reply(this.getPokeImagePath("11.jpg"))
            break
          case "59":
            e.reply(this.getPokeImagePath("12.jpg"))
            break
          case "60":
            e.reply("小叶彻底被玩坏了...")
            await common.sleep(500)
            e.reply(this.getPokeImagePath("13.jpg"))
            await common.sleep(1000)
            e.reply("可能再也不会醒来了...")
            ignorePoke[e.group_id] = true
            setTimeout(() => {
              ignorePoke[e.group_id] = false
            }, 1200000)
            break

          default:
            let random_type = _.random(0, 1, true)
            if (random_type < reply_sp) {
              let retype = _.random(1, 9)
              switch (retype) {
                case 1:
                  e.reply("再戳小叶就用小拳拳捶你了(ꐦ°᷄д°᷅)")
                  await common.sleep(500)
                  e.reply(buildStickerMsg(this.getPokeImagePath("14.jpg")))
                  break
                case 2:
                  e.reply("救命啊，有变态>_<！！！")
                  e.reply(buildStickerMsg(this.getPokeImagePath("6.gif")))
                  break
                case 3:
                  e.reply("咳哈哈哈哈——！")
                  await common.sleep(500)
                  e.reply(buildStickerMsg(this.getPokeImagePath("7.gif")))
                  await common.sleep(500)
                  e.reply("别挠我痒痒了！")
                  await common.sleep(500)
                  e.reply("好痒啊！")
                  break
                case 4:
                  e.reply("混乱中，无法理解的行动。请不要戳我，发生故障。")
                  await common.sleep(500)
                  e.reply(buildStickerMsg(this.getPokeImagePath("8.gif")))
                  nextreply[e.operator_id] = true
                  const userIdForNextReply = e.operator_id
                  setTimeout(() => {
                    if (nextreply[userIdForNextReply]) {
                      delete nextreply[userIdForNextReply]
                      logger.info(`[戳一戳]  ${userIdForNextReply} 的 nextreply 标记已过期.`)
                    }
                  }, 300000)
                  break
                case 5:
                  e.reply("就、就算那样戳我，也不会掉落什么哦……")
                  await common.sleep(500)
                  e.reply(buildStickerMsg(this.getPokeImagePath("9.gif")))
                  await common.sleep(500)
                  e.reply("小叶又不是怪物！")
                  break
                case 6:
                  e.reply("这样几次挠我痒痒会很困扰的呢。")
                  await common.sleep(500)
                  e.reply("主人您啊，意外地喜欢恶作剧吧？")
                  break
                case 7:
                  e.reply("戳中宝藏啦！是一张涩图！")
                  const apiUrl = "https://yande.re/post.json?tags=loli+-rating:e+-nipples&limit=500"
                  const imageBuffer = await yandeimage(apiUrl)
                  await e.reply(segment.image(imageBuffer))
                  break
                case 8:
                  e.reply("把嘴张开（抬起脚）")
                  const feet_apiUrl =
                    "https://yande.re/post.json?tags=feet+-rating:e+-nipples&limit=500"
                  const feet_imageBufferr = await yandeimage(feet_apiUrl)
                  await e.reply(segment.image(feet_imageBufferr))
                  break
                case 9:
                  e.reply("在这里无意义地消耗着时间，这……")
                  await common.sleep(3000)
                  e.reply("没、没有，我并没有讨厌……")
                  break
              }
            } else if (random_type < reply_sp + reply_poke) {
              let retype = _.random(1, 6)
              switch (retype) {
                case 1:
                  e.reply("戳回去(=°ω°)ノ")
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  setTimeout(
                    function () {
                      const POKE_BACK_FOLLOW_UP_REPLIES_LOCAL = [
                        buildStickerMsg(this.getPokeImagePath("15.jpg")),
                        buildStickerMsg(this.getPokeImagePath("16.jpg")),
                        buildStickerMsg(this.getPokeImagePath("11.gif")),
                        "小叶可不是好欺负的!",
                        "哼(￢︿̫̿￢☆)",
                        "(ˉ▽￣～) 切~~",
                      ]
                      let msg = _.sample(POKE_BACK_FOLLOW_UP_REPLIES_LOCAL)
                      e.reply(msg)
                    }.bind(this),
                    500,
                  )
                  break
                case 2:
                  for (let i = 0; i < 10; i++) {
                    await e.group.pokeMember(e.operator_id)
                    await common.sleep(500)
                  }
                  await common.sleep(1000)
                  e.reply("超级加倍！让你见识一下小叶的厉害！")
                  await common.sleep(1000)
                  e.reply(buildStickerMsg(this.getPokeImagePath("10.gif")))
                  break
                case 3:
                  let msg_text = _.sample(pokeConfig.POKE_BACK_TEXT_REPLIES)
                  e.reply(msg_text)
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  break
                case 4:
                  e.reply("嗯？什么？戳戳对方的游戏？")
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  e.reply("我也不会输哦！")
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  e.reply("喝！")
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  e.reply("哈！")
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  break
                case 5:
                  e.reply("觉得我不会反击就为所欲为……做好觉悟吧！")
                  await common.sleep(500)
                  for (let i = 0; i < 11; i++) {
                    await e.group.pokeMember(e.operator_id)
                    await common.sleep(500)
                  }
                  break
                case 6:
                  e.reply("呜呜呜……这样到处摸的话……")
                  await common.sleep(500)
                  await e.group.pokeMember(e.operator_id)
                  await common.sleep(500)
                  e.reply("我也会把主人摸回来的！")
                  break
              }
            } else if (random_type < reply_sp + reply_poke + reply_text) {
              const retype = _.random(1, 3)
              if (retype === 1) {
                let msg = _.sample(pokeConfig.GENERIC_TEXT_REPLIES)
                e.reply(msg)
              } else if (retype === 2) {
                let msg = await this.getAIReply(e, "(不是主人的人戳你一下)")
                const qq = e.operator_id
                const replyMsg = [segment.at(qq), msg]
                e.reply(replyMsg)
              } else {
                try {
                  const response = await fetch("https://60s.viki.moe/v2/fabing")
                  const result = await response.json()

                  if (result && result.code === 200 && result.data && result.data.saying) {
                    const saying = result.data.saying
                    e.reply(saying)
                  } else {
                    let msg = _.sample(pokeConfig.GENERIC_TEXT_REPLIES)
                    e.reply(msg)
                  }
                } catch (error) {
                  logger.error("请求 API 时出错, 已回退:", error)
                  let msg = _.sample(pokeConfig.GENERIC_TEXT_REPLIES)
                  e.reply(msg)
                }
              }
            } else if (random_type < reply_sp + reply_poke + reply_text + reply_num) {
              let retype = _.random(1, 2)
              if (retype === 1) {
                let ciku_ = _.sample(pokeConfig.COUNT_REPLIES_GROUP)
                e.reply(ciku_.replace("_num_", count))
              } else {
                let ciku_ = _.sample(pokeConfig.COUNT_REPLIES_USER)
                e.reply(ciku_.replace("_num_", usercount))
              }
            } else {
              await this.sendgif(e)
            }
            break
        }
      }
    }
    return false
  }
}
