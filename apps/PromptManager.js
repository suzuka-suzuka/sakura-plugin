import Setting from '../lib/setting.js'
import { makeForwardMsg } from '../lib/utils.js';
const conversationState = {}

export class profileManager extends plugin {
  constructor () {
    super({
      name: '设定管理器',
      dsc: '通过命令增加或删除config.yaml中的设定',
      event: 'message',
      priority: 1135,
      rule: [
        {
          reg: '^#设定(增加|添加)$',
          fnc: 'startAddProfile',
          log: false
        },
        {
          reg: '^#设定(删除|移除)$',
          fnc: 'startDeleteProfile',
          log: false
        },
        {
          reg: '^#列出渠道$',
          fnc: 'listChannels',
          log: false
        },
        {
          reg: '^#取消$',
          fnc: 'cancelInteraction',
          log: false
        }
      ]
    })
  }

  get appconfig () {
    return Setting.getConfig('AI')
  }

  saveConfig (data) {
    return Setting.setConfig('AI', data)
  }
  
  getAllChannels() {
    const channelsConfig = Setting.getConfig('Channels');
    if (!channelsConfig || typeof channelsConfig !== 'object') {
        return [];
    }

    let allChannels = [];
    for (const channelTypeArray of Object.values(channelsConfig)) {
        if (Array.isArray(channelTypeArray)) {
            allChannels = allChannels.concat(channelTypeArray);
        }
    }
    return allChannels;
  }

  async startAddProfile (e) {
    conversationState[e.user_id] = {
      step: 'awaiting_name',
      data: {}
    }
    this.setContext('handleProfileAdd', e.isGroup, 60)
    await e.reply('请输入设定的【名字】，输入“#取消”可退出')
  }

  async handleProfileAdd () {
    const e = this.e
    const state = conversationState[e.user_id]
    const userInput = e.raw_message?.trim()

    if (!state) {
      this.finish('handleProfileAdd', e.isGroup)
      return
    }

    if (userInput === '#取消') {
      return this.cancelInteraction()
    }

    switch (state.step) {
      case 'awaiting_name':
        const configForNameCheck = this.appconfig
        if (configForNameCheck && configForNameCheck.profiles.some(p => p.name === userInput)) {
          await e.reply(`设定名字 "${userInput}" 已经存在了，请重新输入名字`)
          return
        }
        state.data.name = userInput
        state.step = 'awaiting_prefix'
        await e.reply(`名字已设定为：${state.data.name}\n现在，请输入【前缀】`)
        break

      case 'awaiting_prefix':
        const prefix = userInput
        const config = this.appconfig
        if (prefix.startsWith('#')) {
          await e.reply('前缀不能以 "#" 开头，请重新输入')
          return
        }
        if (config) {
          const isInvalidPrefix = config.profiles.some(p => p.prefix.includes(prefix) || prefix.includes(p.prefix))
          if (isInvalidPrefix) {
            await e.reply(`前缀 "${prefix}" 与现有前缀互为包含关系或完全相同，请重新输入前缀`)
            return
          }
        }
        state.data.prefix = prefix
        state.step = 'awaiting_channel'
        await e.reply(`前缀已设定为：${state.data.prefix}\n现在，请输入渠道`)
        break

      case 'awaiting_channel':
        const channels = this.getAllChannels();
        if (!channels.some(c => c.name === userInput)) {
          await e.reply(`渠道 "${userInput}" 无效，请重新输入，可以发送#列出渠道获取可用渠道`)
          return
        }

        state.data.Channel = userInput
        state.step = 'awaiting_prompt'
        await e.reply(`渠道已设定为：${state.data.Channel}\n现在，请输入【设定】`)
        break

      case 'awaiting_prompt':
        state.data.Prompt = userInput
        state.step = 'awaiting_settings'
        await e.reply('设定已设定。\n现在，请一次性输入以下三个功能的开关（1为是，0为否），用空格隔开：\n1. 是否【启用群聊上下文】\n2. 是否【启用历史记录】\n3. 是否【启用工具】\n\n例如，输入 "1 1 0" 表示开启前两项，关闭第三项。')
        break
      
      case 'awaiting_settings':
        const settings = userInput.split(/\s+/).filter(s => s)
        if (settings.length !== 3 || settings.some(s => s !== '1' && s !== '0')) {
          await e.reply('输入格式不正确，请输入三个由空格隔开的1或0。\n例如: 1 1 0\n请重新输入。')
          return
        }

        state.data.GroupContext = (settings[0] === '1')
        state.data.History = (settings[1] === '1')
        state.data.Tool = (settings[2] === '1')

        this.finish('handleProfileAdd', e.isGroup)
        const finalConfig = this.appconfig
        if (!finalConfig) {
          await e.reply('配置文件读取失败，无法添加新设定。')
        } else {
          finalConfig.profiles.push(state.data)
          if (this.saveConfig(finalConfig)) {
            await e.reply(`🎉 设定【${state.data.name}】添加成功！`)
          } else {
            await e.reply('写入配置文件时出错，添加失败。')
          }
        }
        delete conversationState[e.user_id]
        break
    }
  }

  async listChannels (e) {
    const channels = this.getAllChannels();

    if (!channels || channels.length === 0) {
      await e.reply('当前没有配置任何渠道，或配置格式不正确。')
      return
    }

    const messages = channels.map(channel => ({
      text: channel.name,
      senderId: e.bot.uin,
      senderName: e.bot.nickname
    }))

    await makeForwardMsg(e, messages, '当前可用渠道列表')
  }

  async startDeleteProfile (e) {
    const config = this.appconfig
    if (!config || !config.profiles || config.profiles.length === 0) {
      await e.reply('当前没有任何设定可以删除。')
      return
    }

    let replyMsg = '当前有以下设定：\n'
    config.profiles.forEach((p, index) => {
      replyMsg += `${index + 1}. 名字: ${p.name}, 前缀: ${p.prefix}\n`
    })
    replyMsg += '\n请输入要删除的设定的【前缀】，输入“#取消”可退出。'

    this.setContext('deleteByPrefix', e.isGroup, 30)
    await e.reply(replyMsg)
  }

  async deleteByPrefix () {
    const e = this.e
    const userInput = e.raw_message?.trim()
    if (userInput === '#取消') {
      this.finish('deleteByPrefix', e.isGroup)
      await e.reply('操作已取消。')
      return
    }

    const prefixToDelete = userInput
    const config = this.appconfig

    const profileIndex = config.profiles.findIndex(p => p.prefix === prefixToDelete)

    if (profileIndex === -1) {
      await e.reply(`未找到前缀为 "${prefixToDelete}" 的设定，请检查输入。`)
    } else {
      const deletedProfileName = config.profiles[profileIndex].name
      config.profiles.splice(profileIndex, 1)

      if (this.saveConfig(config)) {
        await e.reply(`设定【${deletedProfileName}】(前缀: ${prefixToDelete}) 已成功删除。`)
      } else {
        await e.reply('写入配置文件时出错，删除失败。')
      }
    }

    this.finish('deleteByPrefix', e.isGroup)
  }

  async cancelInteraction () {
    const e = this.e
    const userId = e.user_id
    const isGroup = e.isGroup
    let cancelled = false

    if (conversationState[userId]) {
      this.finish('handleProfileAdd', isGroup)
      delete conversationState[userId]
      cancelled = true
    }

    const deleteContext = this.getContext('deleteByPrefix', isGroup)
    if (deleteContext && deleteContext.user_id === userId) {
      this.finish('deleteByPrefix', isGroup)
      cancelled = true
    }

    if (cancelled) {
      await e.reply('操作已取消。')
    }
  }
}
