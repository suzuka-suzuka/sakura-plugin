import adapter from "./adapter.js"
import fs from 'node:fs'
import YAML from 'yaml'
import { _path } from './path.js'

export async function makeForwardMsg(e, messagesWithSender = [], dec = "") {
  if (!Array.isArray(messagesWithSender)) {
    messagesWithSender = [
      {
        text: String(messagesWithSender),
        senderId: e.user_id,
        senderName: e.sender?.card || e.sender?.nickname || e.user_id,
      },
    ]
  }

  const messages = []
  for (const item of messagesWithSender) {
    if (!item || !item.text) {
      continue
    }

    let currentSenderId = item.senderId
    let currentSenderName = item.senderName

    if (e.isGroup && currentSenderId) {
      try {
        let info

        try {
          info = await e.group.pickMember(currentSenderId).getInfo(true)
        } catch {
          info = (await e.group.pickMember(Number(currentSenderId))).info
        }

        currentSenderName = info?.card || info?.nickname || currentSenderId
      } catch (err) {
        logger.error(`获取群成员 ${currentSenderId} 信息失败:`, err)
      }
    }

    messages.push({
      user_id: currentSenderId,
      nickname: currentSenderName,
      message: item.text,
    })
  }

  if (adapter === 0) {
    let forwardMsg = messages.map(m => ({
      user_id: m.user_id,
      nickname: m.nickname,
      message: m.message,
    }))
    try {
      if (e?.group?.makeForwardMsg) {
        forwardMsg = await e.group.makeForwardMsg(forwardMsg)
      } else if (e?.friend?.makeForwardMsg) {
        forwardMsg = await e.friend.makeForwardMsg(forwardMsg)
      } else {
        return messages.map(m => m.message).join("\n")
      }

      if (dec) {
        if (typeof forwardMsg.data === "object") {
          let detail = forwardMsg.data?.meta?.detail
          if (detail) {
            detail.news = [{ text: dec }]
          }
        } else {
          forwardMsg.data = forwardMsg.data
            .replace(/\n/g, "")
            .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, "___")
            .replace(/___+/, `<title color="#777777" size="26">${dec}</title>`)
        }
      }
      return await e.reply(forwardMsg)
    } catch (err) {}
  } else {
    const forwardData = {
      messages: messages,
      summary: "聊天记录",
      source: "喵",
      prompt: "可爱",
      news: [{ text: dec || "里面有你想要的" }],
    }

    try {
      if (e?.group?.sendForwardMsg) {
        return await e.group.sendForwardMsg(forwardData)
      } else if (e?.friend?.sendForwardMsg) {
        return await e.friend.sendForwardMsg(forwardData)
      }
    } catch (err) {
      logger.error("发送转发消息时出错:", err)
    }
  }
}

export async function getImg(e, getAvatar = false) {
  if (!e.message || !Array.isArray(e.message)) {
    return null
  }

  const directImageUrls = e.message
    .filter(segment => segment.type === "image" && segment.url)
    .map(segment => segment.url)

  if (directImageUrls.length > 0) {
    e.img = directImageUrls
    return directImageUrls
  }
  const replySegment = e.message.find(segment => segment.type === "reply")
  if (adapter === 0 && e.source) {
    let reply
    let seq = e.isGroup ? e.source.seq : e.source.time

    if (e.isGroup) {
      reply = (await e.group.getChatHistory(seq, 1)).pop()?.message
    } else {
      reply = (await e.friend.getChatHistory(seq, 1)).pop()?.message
    }
    if (reply) {
      let i = []
      for (let val of reply) {
        if (val.type === "image") {
          i.push(val.url)
        }
      }
      if (i.length > 0) {
        e.img = i
        return i
      }
    }
  } else if (replySegment?.id) {
    const message_id = replySegment.id

    try {
      const sourceMessageData = e.isGroup
        ? await e.group.getMsg(message_id)
        : await e.friend.getMsg(message_id)

      const messageSegments = sourceMessageData?.message

      if (messageSegments && Array.isArray(messageSegments)) {
        const repliedImageUrls = messageSegments
          .filter(segment => segment.type === "image" && segment.url)
          .map(segment => segment.url)

        if (repliedImageUrls.length > 0) {
          e.img = repliedImageUrls
          return repliedImageUrls
        }
      }
    } catch (error) {}
  }

  if (getAvatar) {
    const atMsg = e.message.find(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
    if (atMsg) {
      return [`https://q1.qlogo.cn/g?b=qq&s=640&nk=${atMsg.qq}`]
    }
  }

  return null
}

export function Recall(e, message_id, delay = 10) {
  if (!message_id) {
    return false
  }
  setTimeout(() => {
    const target = e.group_id ? e.bot.pickGroup(e.group_id) : e.bot.pickFriend(e.user_id)
    if (target) {
      target.recallMsg(message_id)
    }
  }, delay * 1000)
}

const otherConfigPath = `${_path}/config/config/other.yaml`

export function addBlackList(qq) {
  let config = {}
  try {
    if (fs.existsSync(otherConfigPath)) {
      const file = fs.readFileSync(otherConfigPath, 'utf8')
      config = YAML.parse(file)
    }
  } catch (error) {
    logger.error(`[sakura-plugin] 读取配置文件失败: ${otherConfigPath}`, error)
    return false
  }

  if (!config.blackUser) {
    config.blackUser = []
  }

  qq = Number(qq)
  if (isNaN(qq)) return false

  if (!config.blackUser.includes(qq)) {
    config.blackUser.push(qq)
    try {
      fs.writeFileSync(otherConfigPath, YAML.stringify(config), 'utf8')
      return true
    } catch (error) {
      logger.error(`[sakura-plugin] 写入配置文件失败: ${otherConfigPath}`, error)
      return false
    }
  }
  return true
}

export function removeBlackList(qq) {
  let config = {}
  try {
    if (fs.existsSync(otherConfigPath)) {
      const file = fs.readFileSync(otherConfigPath, 'utf8')
      config = YAML.parse(file)
    }
  } catch (error) {
    logger.error(`[sakura-plugin] 读取配置文件失败: ${otherConfigPath}`, error)
    return false
  }

  if (!config.blackUser) {
    return true
  }

  qq = Number(qq)
  if (isNaN(qq)) return false

  if (config.blackUser.includes(qq)) {
    config.blackUser = config.blackUser.filter(item => item !== qq)
    try {
      fs.writeFileSync(otherConfigPath, YAML.stringify(config), 'utf8')
      return true
    } catch (error) {
      logger.error(`[sakura-plugin] 写入配置文件失败: ${otherConfigPath}`, error)
      return false
    }
  }
  return true
}
