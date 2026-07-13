import Setting from "../lib/setting.js"
import { findProfileByPrefix } from "../lib/AIUtils/profileTriggers.js"
export class profileManager extends plugin {
  constructor() {
    super({
      name: "设定管理器",
      event: "message",
      priority: 1135,
    })
  }

  // 命令注册
  addProfile = Command(/^#设定(增加|添加)$/, "master", async (e) => {
    await this.startAddProfile(e)
  });

  deleteProfile = Command(/^#设定(删除|移除)$/, "master", async (e) => {
    await this.startDeleteProfile(e)
  });

  addRole = Command(/^#人设(增加|添加)$/, async (e) => {
    await this.startAddRoleSetting(e)
  });

  deleteRole = Command(/^#人设(删除|移除)$/, "master", async (e) => {
    await this.startDeleteRoleSetting(e)
  });

  listRoles = Command(/^#列出人设$/, "master", async (e) => {
    await this.listRoleSettings(e)
  });

  listAiSettingsCmd = Command(/^#列出AI设定$/i, async (e) => {
    await this.listAiSettings(e)
  });

  listRouteCmd = Command(/^#列出路由$/, "master", async (e) => {
    await this.listRoutes(e)
  });

  cancelCmd = Command(/^#取消$/, async (e) => {
    await this.cancelInteraction(e)
  });

  get appconfig() {
    return Setting.getConfig("AI")
  }

  saveConfig(data) {
    return Setting.setConfig("AI", data)
  }

  getAllRoutes() {
    return Setting.getConfig("Routes")?.routes || []
  }

  getToolGroupNames() {
    const toolGroups = this.appconfig?.toolGroups
    if (!Array.isArray(toolGroups)) {
      return []
    }

    return toolGroups
      .map(group => group?.name)
      .filter(name => typeof name === "string" && name.trim())
  }

  async startAddRoleSetting(e) {
    const data = {
      step: "role_awaiting_name",
      data: {},
    }
    this.setContext("handleRoleSettingAdd", !!e.group_id, 60, true, data)
    await e.reply("请输入要新增的人设【名字】，输入“#取消”可退出")
  }

  async handleRoleSettingAdd() {
    const e = this.e
    const context = this.getContext("handleRoleSettingAdd", !!e.group_id)
    if (!context || !context.data) {
      this.finish("handleRoleSettingAdd", !!e.group_id)
      return
    }
    const state = context.data
    const userInput = e.raw_message?.trim()

    if (userInput === "#取消") {
      return this.cancelInteraction(e)
    }

    switch (state.step) {
      case "role_awaiting_name":
        const rolesConfig = Setting.getConfig("roles")
        const roles = rolesConfig?.roles || []

        if (roles.some(r => r.name === userInput)) {
          await e.reply(`人设 "${userInput}" 已存在，将覆盖原有设定。请输入新的【设定】`)
        } else {
          await e.reply(`人设名字已设定为：${userInput}\n现在，请输入【设定】`)
        }

        state.data.name = userInput
        state.step = "role_awaiting_prompt"
        break

      case "role_awaiting_prompt":
        state.data.prompt = userInput

        let currentRolesConfig = Setting.getConfig("roles")
        let currentRoles = currentRolesConfig?.roles || []

        currentRoles = currentRoles.filter(r => r.name !== state.data.name)
        currentRoles.push(state.data)

        Setting.setConfig("roles", { roles: currentRoles })

        await e.reply(`🎉 人设【${state.data.name}】已保存！`)
        this.finish("handleRoleSettingAdd", !!e.group_id)
        break
    }
  }

  async startDeleteRoleSetting(e) {
    const data = {
      step: "role_delete_awaiting_name",
    }
    this.setContext("handleRoleSettingDelete", !!e.group_id, 60, true, data)
    await e.reply("请输入要删除的人设【名字】，输入“#取消”可退出")
  }

  async handleRoleSettingDelete() {
    const e = this.e
    const context = this.getContext("handleRoleSettingDelete", !!e.group_id)
    if (!context || !context.data) {
      this.finish("handleRoleSettingDelete", !!e.group_id)
      return
    }
    const state = context.data
    const userInput = e.raw_message?.trim()

    if (userInput === "#取消") {
      this.finish("handleRoleSettingDelete", !!e.group_id)
      await e.reply("操作已取消。")
      return
    }

    const rolesConfig = Setting.getConfig("roles")
    let roles = rolesConfig?.roles || []
    const roleIndex = roles.findIndex(r => r.name === userInput)

    if (roleIndex === -1) {
      await e.reply(`人设 "${userInput}" 不存在，请重新输入，可以发送 #列出人设 查看现有列表。`)
      return
    }

    const deletedName = roles[roleIndex].name
    roles.splice(roleIndex, 1)
    Setting.setConfig("roles", { roles: roles })

    await e.reply(`人设【${deletedName}】已成功删除。`)
    this.finish("handleRoleSettingDelete", !!e.group_id)
  }

  async listRoleSettings(e) {
    const rolesConfig = Setting.getConfig("roles")
    const roles = rolesConfig?.roles || []

    if (roles.length === 0) {
      await e.reply("当前没有任何人设预设。")
      return
    }

    const nodes = roles.map((role, index) => ({
      user_id: e.bot.self_id,
      nickname: e.bot.nickname,
      content: `${index + 1}. ${role.name}\n设定预览: ${role.prompt.substring(0, 500)}${role.prompt.length > 500 ? "..." : ""}`,
    }))

    await e.sendForwardMsg(nodes, {
      source: "当前可用人设列表",
      prompt: "好多有趣的人设呀~",
    })
  }

  async startAddProfile(e) {
    const data = {
      step: "awaiting_prefix",
      data: {},
    }
    this.setContext("handleProfileAdd", !!e.group_id, 60, true, data)
    await e.reply("请输入一个或多个【前缀】，多个前缀使用英文或中文逗号分隔，输入“#取消”可退出")
  }

  async handleProfileAdd() {
    const e = this.e
    const context = this.getContext("handleProfileAdd", !!e.group_id)
    if (!context || !context.data) {
      this.finish("handleProfileAdd", !!e.group_id)
      return
    }
    const state = context.data
    const userInput = e.raw_message?.trim()

    if (userInput === "#取消") {
      return this.cancelInteraction(e)
    }

    switch (state.step) {
      case "awaiting_prefix":
        const prefixes = userInput.split(/[,，]/).map(item => item.trim()).filter(Boolean)
        const config = this.appconfig
        if (prefixes.length === 0) {
          await e.reply("至少需要输入一个非空前缀")
          return
        }
        if (prefixes.some(prefix => prefix.startsWith("#"))) {
          await e.reply('前缀不能以 "#" 开头，请重新输入')
          return
        }
        const uniquePrefixes = new Set(prefixes)
        const configuredPrefixes = new Set((config?.profiles || []).flatMap(profile => profile.prefixes))
        if (uniquePrefixes.size !== prefixes.length || prefixes.some(prefix => configuredPrefixes.has(prefix))) {
          await e.reply("前缀不能为空或重复，请重新输入")
          return
        }
        state.data.prefixes = prefixes
        state.step = "awaiting_role_name"
        await e.reply(`前缀已设定为：${state.data.prefixes.join("、")}\n现在，请输入【人设名字】`)
        break

      case "awaiting_role_name":
        const rolesConfig = Setting.getConfig("roles")
        const roles = rolesConfig?.roles || []
        const role = roles.find(r => r.name === userInput)

        if (!role) {
          await e.reply(
            `人设 "${userInput}" 不存在，请先使用 #人设添加 添加该人设，可以发送 #列出人设 查看现有列表。`,
          )
          return
        }

        state.data.name = role.name
        state.step = "awaiting_route"
        await e.reply(`已选择人设：${state.data.name}\n现在，请输入模型路由`)
        break

      case "awaiting_route":
        const routes = this.getAllRoutes()
        if (!routes.some(item => item.id === userInput)) {
          await e.reply(`路由 "${userInput}" 无效，请重新输入，可以发送 #列出路由 获取可用路由`)
          return
        }

        state.data.route = userInput
        state.step = "awaiting_settings"
        const toolGroupNames = this.getToolGroupNames()
        const toolGroupText = toolGroupNames.length > 0
          ? `\n当前可用工具组：${toolGroupNames.join("、")}`
          : "\n当前没有配置工具组，如不使用工具请填 0。"
        await e.reply(
          `路由已设定为：${state.data.route}\n现在，请一次性输入以下设置，用空格隔开：\n1. 是否【启用群聊上下文】（1为是，0为否）\n2. 是否【启用历史记录】（1为是，0为否）\n3. 【工具组名称】（不使用工具填 0）${toolGroupText}\n\n例如：1 1 默认工具组`,
        )
        break

      case "awaiting_settings":
        const settings = userInput.split(/\s+/).filter(s => s)
        if (
          settings.length !== 3 ||
          settings[0] !== "1" && settings[0] !== "0" ||
          settings[1] !== "1" && settings[1] !== "0"
        ) {
          await e.reply("输入格式不正确，请输入三项设置：群上下文 历史记录 工具组。\n例如: 1 1 默认工具组\n不使用工具组请将第三项填 0。")
          return
        }

        const noToolValues = new Set(["0", "无", "不启用", "关闭", "空", "-"])
        const toolGroupName = noToolValues.has(settings[2]) ? "" : settings[2]
        const toolGroupNamesForValidate = this.getToolGroupNames()
        if (toolGroupName && !toolGroupNamesForValidate.includes(toolGroupName)) {
          const availableText = toolGroupNamesForValidate.length > 0
            ? `当前可用工具组：${toolGroupNamesForValidate.join("、")}`
            : "当前没有配置工具组。"
          await e.reply(`工具组 "${toolGroupName}" 不存在，请重新输入。\n${availableText}\n不使用工具组请填 0。`)
          return
        }

        state.data.groupContext = settings[0] === "1"
        state.data.history = settings[1] === "1"
        state.data.toolGroup = toolGroupName

        this.finish("handleProfileAdd", !!e.group_id)
        const finalConfig = this.appconfig
        if (!finalConfig) {
          await e.reply("配置文件读取失败，无法添加新设定。")
        } else {
          finalConfig.profiles.push(state.data)
          if (this.saveConfig(finalConfig)) {
            await e.reply(`🎉 设定添加成功！\n前缀：${state.data.prefixes.join("、")}\n人设：${state.data.name}`)
          } else {
            await e.reply("写入配置文件时出错，添加失败。")
          }
        }
        break
    }
  }

  async listRoutes(e) {
    const routes = this.getAllRoutes()

    if (routes.length === 0) {
      await e.reply("当前没有配置任何模型路由。")
      return
    }

    const nodes = routes.map(route => ({
      user_id: e.bot.self_id,
      nickname: e.bot.nickname,
      content: `${route.id}${route.name ? `（${route.name}）` : ""}`,
    }))

    await e.sendForwardMsg(nodes, {
      source: "当前可用模型路由",
      prompt: "查看可用模型路由",
    })
  }

  async listAiSettings(e) {
    const config = this.appconfig
    const profiles = config?.profiles || []

    if (profiles.length === 0) {
      await e.reply("当前没有任何 AI 设定。")
      return
    }

    const nodes = profiles.map(profile => ({
      user_id: e.bot.self_id,
      nickname: e.bot.nickname,
      content: `前缀：${profile.prefixes.join("、")}\n绑定角色：${profile.name || "未设置"}\n模型路由：${profile.route}`,
    }))

    await e.sendForwardMsg(nodes, {
      source: "AI设定列表",
      prompt: "查看前缀绑定角色",
    })
  }

  async startDeleteProfile(e) {
    const config = this.appconfig
    if (!config || !config.profiles || config.profiles.length === 0) {
      await e.reply("当前没有任何设定可以删除。")
      return
    }

    let replyMsg = "当前有以下设定：\n"
    config.profiles.forEach((p, index) => {
      replyMsg += `${index + 1}. 人设: ${p.name}, 前缀: ${p.prefixes.join("、")}\n`
    })
    replyMsg += "\n请输入要删除的设定的【前缀】，输入“#取消”可退出。"

    const data = {
      step: "awaiting_delete_prefix",
    }
    this.setContext("deleteByPrefix", !!e.group_id, 30, true, data)
    await e.reply(replyMsg)
  }

  async deleteByPrefix() {
    const e = this.e
    const context = this.getContext("deleteByPrefix", !!e.group_id)
    const userInput = e.raw_message?.trim()

    if (!context || !context.data || context.data.step !== "awaiting_delete_prefix") {
      this.finish("deleteByPrefix", !!e.group_id)
      return
    }

    if (userInput === "#取消") {
      this.finish("deleteByPrefix", !!e.group_id)
      await e.reply("操作已取消。")
      return
    }

    const prefixToDelete = userInput
    const config = this.appconfig

    const profile = findProfileByPrefix(config.profiles, prefixToDelete)
    const profileIndex = profile ? config.profiles.indexOf(profile) : -1

    if (profileIndex === -1) {
      await e.reply(`未找到前缀为 "${prefixToDelete}" 的设定，请检查输入。`)
    } else {
      const deletedProfileName = config.profiles[profileIndex].name
      config.profiles.splice(profileIndex, 1)

      if (this.saveConfig(config)) {
        await e.reply(`前缀: ${prefixToDelete}\n人设：【${deletedProfileName}】\n已成功删除`)
      } else {
        await e.reply("写入配置文件时出错，删除失败。")
      }
    }

    this.finish("deleteByPrefix", !!e.group_id)
  }

  async cancelInteraction(e) {
    const isGroup = !!e.group_id
    let cancelled = false

    const methods = ["handleProfileAdd", "handleRoleSettingAdd", "handleRoleSettingDelete", "deleteByPrefix"];

    for (const method of methods) {
      if (this.getContext(method, isGroup)) {
        this.finish(method, isGroup)
        cancelled = true
      }
    }

    if (cancelled) {
      await e.reply("操作已取消。")
    }
  }
}
