import express from "express"
import YAML from "js-yaml"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import setting from "./lib/setting.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class WebEditor {
  constructor(bot = null) {
    this.app = express()
    this.bot = bot || global.bot

    const configPath = path.join(__dirname, "config", "webeditor.yaml")
    const defConfigPath = path.join(__dirname, "defSet", "webeditor.yaml")

    let config = { port: 3456, password: "1135" }

    try {
      if (fs.existsSync(configPath)) {
        const userConfig = YAML.load(fs.readFileSync(configPath, "utf8"))
        config = { ...config, ...userConfig }
      } else if (fs.existsSync(defConfigPath)) {
        const defConfig = YAML.load(fs.readFileSync(defConfigPath, "utf8"))
        config = { ...config, ...defConfig }
        fs.copyFileSync(defConfigPath, configPath)
      }
    } catch (err) {}

    this.port = config.port || 1135
    this.password = config.password || "1135"
    this.host = "0.0.0.0"
    this.configPath = path.join(__dirname, "config")
    this.defPath = path.join(__dirname, "defSet")
    this.isLoggedIn = false

    this.setupMiddleware()
    this.setupRoutes()
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: "10mb" }))

    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*")
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
      res.header("Access-Control-Allow-Headers", "Content-Type")
      next()
    })

    this.app.get("/login", (req, res) => {
      res.sendFile(path.join(__dirname, "resources/webeditor/login.html"))
    })

    this.app.post("/api/login", (req, res) => {
      const { password } = req.body
      if (password === this.password) {
        this.isLoggedIn = true
        const token = Buffer.from(this.password).toString('base64')
        res.json({ success: true, message: "登录成功", token })
      } else {
        res.json({ success: false, message: "密码错误" })
      }
    })

    this.app.get("/api/check-login", (req, res) => {
      const authHeader = req.headers.authorization
      if (authHeader) {
        const token = authHeader.split(' ')[1]
        if (token === Buffer.from(this.password).toString('base64')) {
          return res.json({ loggedIn: true })
        }
      }
      res.json({ loggedIn: this.isLoggedIn })
    })

    this.app.use(express.static(path.join(__dirname, "resources/webeditor")))

    this.app.use((req, res, next) => {
      const authHeader = req.headers.authorization
      let tokenValid = false
      if (authHeader) {
        const token = authHeader.split(' ')[1]
        if (token === Buffer.from(this.password).toString('base64')) {
          tokenValid = true
        }
      }

      if (
        !this.isLoggedIn &&
        !tokenValid &&
        !req.path.startsWith("/api/login") &&
        !req.path.startsWith("/api/check-login")
      ) {
        if (req.path.startsWith("/api/")) {
          return res.status(401).json({ success: false, error: "未登录" })
        }
        return res.redirect("/login")
      }
      next()
    })
  }

  setupRoutes() {
    this.app.get("/api/groups", async (req, res) => {
      try {
        const groups = []
        // 动态获取 bot，因为启动时可能还未连接
        const bot = global.bot
        const log = global.logger || console
        log.info("[sakura] /api/groups 被调用, global.bot =", bot ? `存在 (self_id: ${bot.self_id})` : "null")

        if (!bot) {
          log.warn("[sakura] Bot 未连接，无法获取群列表")
          return res.json({ success: true, data: [], error: "Bot 未连接" })
        }

        if (bot.getGroupList) {
          log.info("[sakura] 正在调用 bot.getGroupList()...")
          try {
            const groupList = await bot.getGroupList()
            log.info("[sakura] getGroupList 返回数据类型:", typeof groupList, "是否数组:", Array.isArray(groupList))
            
            if (Array.isArray(groupList)) {
              for (const g of groupList) {
                groups.push({
                  id: String(g.group_id),
                  name: g.group_name || `群${g.group_id}`,
                })
              }
              log.info("[sakura] 成功解析群列表:", groups.length, "个群")
            } else if (groupList && typeof groupList === 'object') {
              // 某些实现可能返回 { data: [...] } 格式
              const list = groupList.data || groupList
              if (Array.isArray(list)) {
                for (const g of list) {
                  groups.push({
                    id: String(g.group_id),
                    name: g.group_name || `群${g.group_id}`,
                  })
                }
                log.info("[sakura] 从 object.data 解析群列表:", groups.length, "个群")
              } else {
                log.warn("[sakura] getGroupList 返回了非数组数据:", JSON.stringify(groupList)?.substring(0, 200))
              }
            } else {
              log.warn("[sakura] getGroupList 返回 null 或 undefined")
            }
          } catch (err) {
            log.error("[sakura] getGroupList 调用失败:", err.message)
          }
        } else {
          log.warn("[sakura] bot.getGroupList 方法不存在")
        }

        groups.sort((a, b) => Number(a.id) - Number(b.id))
        res.json({ success: true, data: groups })
      } catch (error) {
        const log = global.logger || console
        log.error("[sakura] 获取群列表失败:", error)
        res.json({ success: true, data: [], error: error.message })
      }
    })

    this.app.get("/api/configs", (req, res) => {
      try {
        const defFiles = fs
          .readdirSync(this.defPath)
          .filter(file => file.endsWith(".yaml"))
          .map(file => file.replace(".yaml", ""))

        defFiles.forEach(name => {
          const configFile = path.join(this.configPath, `${name}.yaml`)
          const defFile = path.join(this.defPath, `${name}.yaml`)

          if (!fs.existsSync(configFile) && fs.existsSync(defFile)) {
            fs.copyFileSync(defFile, configFile)
            console.log(`[sakura] 已从 defSet 复制配置文件: ${name}.yaml`)
          }
        })

        const files = fs
          .readdirSync(this.configPath)
          .filter(file => file.endsWith(".yaml"))
          .map(file => file.replace(".yaml", ""))
        res.json({ success: true, data: files })
      } catch (error) {
        res.json({ success: false, error: error.message })
      }
    })

    this.app.get("/api/config/:name", (req, res) => {
      try {
        const { name } = req.params

        let config = setting.getConfig(name)
        const rawConfig = setting._getRawConfig(name)
        const defConfig = setting.getdefSet(name)

        if (name === 'EmojiLike') {
          const transformGroups = (cfg) => {
            if (cfg && cfg.groups && !Array.isArray(cfg.groups)) {
              const groupsArray = []
              for (const [groupId, groupCfg] of Object.entries(cfg.groups)) {
                const usersArray = []
                if (groupCfg.users && !Array.isArray(groupCfg.users)) {
                  for (const [userId, emojiId] of Object.entries(groupCfg.users)) {
                    usersArray.push({ userId, emojiId })
                  }
                }
                groupsArray.push({
                  groupId: String(groupId),
                  replyAll: groupCfg.replyAll,
                  default: groupCfg.default,
                  users: usersArray
                })
              }
              return { ...cfg, groups: groupsArray }
            }
            return cfg
          }
          config = transformGroups(config)
        }

        res.json({
          success: true,
          data: {
            config: config,
            raw: rawConfig,
            default: defConfig,
          },
        })
      } catch (error) {
        res.json({ success: false, error: error.message })
      }
    })

    this.app.post("/api/config/:name", (req, res) => {
      try {
        const { name } = req.params
        let { data } = req.body


        const success = setting.setConfig(name, data)

        if (success === false) {
          res.json({ success: true, message: "配置未变更" })
        } else {
          res.json({ success: true, message: "保存成功" })
        }
      } catch (error) {
        res.json({ success: false, error: error.message })
      }
    })

    this.app.post("/api/config/:name/reset", (req, res) => {
      try {
        const { name } = req.params
        const defConfig = setting.getdefSet(name)

        if (Object.keys(defConfig).length === 0) {
          res.json({ success: false, error: "默认配置不存在" })
          return
        }

        setting.setConfig(name, defConfig)
        res.json({ success: true, message: "重置成功" })
      } catch (error) {
        res.json({ success: false, error: error.message })
      }
    })

    this.app.get("/api/config/:name/raw", (req, res) => {
      try {
        const { name } = req.params
        const configFile = path.join(this.configPath, `${name}.yaml`)

        if (fs.existsSync(configFile)) {
          const content = fs.readFileSync(configFile, "utf8")
          res.json({ success: true, data: content })
        } else {
          res.json({ success: false, error: "配置文件不存在" })
        }
      } catch (error) {
        res.json({ success: false, error: error.message })
      }
    })

    this.app.post("/api/config/:name/raw", (req, res) => {
      try {
        const { name } = req.params
        const { content } = req.body
        const configFile = path.join(this.configPath, `${name}.yaml`)

        YAML.load(content)

        fs.writeFileSync(configFile, content, "utf8")

        res.json({ success: true, message: "保存成功" })
      } catch (error) {
        res.json({ success: false, error: `YAML格式错误: ${error.message}` })
      }
    })
  }

  start() {
    this.app.listen(this.port, this.host, () => {
      const ip = this.getLocalIP()
      const log = global.logger || console
      log.info(`[sakura-plugin] sakura面板已启动: http://localhost:${this.port}`)
      log.info(`[sakura-plugin] 外网访问: http://${ip}:${this.port}`)
    })
  }

  setBot(bot) {
    this.bot = bot
  }

  getLocalIP() {
    try {
      const nets = os.networkInterfaces()
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === "IPv4" && !net.internal) {
            return net.address
          }
        }
      }
    } catch (err) {
      const log = global.logger || console
      log.warn(`[sakura-plugin] 无法获取本地IP地址: ${err.message}，将使用localhost`)
    }
    return "localhost"
  }
}

let editor = null
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || global.bot) {
  editor = new WebEditor()
  editor.start()
}

export default editor || WebEditor
