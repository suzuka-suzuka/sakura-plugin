import express from "express"
import YAML from "yaml"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import lodash from "lodash"
import setting from "./lib/setting.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class WebEditor {
  constructor(bot = null) {
    this.app = express()
    this.bot = bot || global.Bot

    const configPath = path.join(__dirname, "config", "webeditor.yaml")
    const defConfigPath = path.join(__dirname, "defSet", "webeditor.yaml")

    let config = { port: 3456 }

    try {
      if (fs.existsSync(configPath)) {
        const userConfig = YAML.parse(fs.readFileSync(configPath, "utf8"))
        config = { ...config, ...userConfig }
      } else if (fs.existsSync(defConfigPath)) {
        const defConfig = YAML.parse(fs.readFileSync(defConfigPath, "utf8"))
        config = { ...config, ...defConfig }
        fs.copyFileSync(defConfigPath, configPath)
      }
    } catch (err) {}

    this.port = config.port || 3456
    this.host = "0.0.0.0"
    this.configPath = path.join(__dirname, "config")
    this.defPath = path.join(__dirname, "defSet")

    this.setupMiddleware()
    this.setupRoutes()
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: "10mb" }))
    this.app.use(express.static(path.join(__dirname, "resources/webeditor")))

    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*")
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
      res.header("Access-Control-Allow-Headers", "Content-Type")
      next()
    })
  }

  setupRoutes() {
    this.app.get("/api/groups", (req, res) => {
      try {
        const groups = []
        const bot = this.bot || global.Bot

        if (bot && bot.gl) {
          for (const [groupId, groupInfo] of bot.gl) {
            groups.push({
              id: String(groupId),
              name: groupInfo.group_name || groupInfo.name || `群${groupId}`,
            })
          }
        }

        groups.sort((a, b) => Number(a.id) - Number(b.id))

        res.json({ success: true, data: groups })
      } catch (error) {
        console.error("[sakura] 获取群列表失败:", error)
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

        const config = setting.getConfig(name)
        const rawConfig = setting._getRawConfig(name)
        const defConfig = setting.getdefSet(name)

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
        const { data } = req.body

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

        YAML.parse(content)

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
      log.info(`[sakura-plugin] 配置编辑器已启动: http://localhost:${this.port}`)
      log.info(`[sakura-plugin] 外网访问: http://${ip}:${this.port}`)
    })
  }

  setBot(bot) {
    this.bot = bot
  }

  getLocalIP() {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address
        }
      }
    }
    return "localhost"
  }
}

let editor = null
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || global.Bot) {
  editor = new WebEditor()
  editor.start()
}

export default editor || WebEditor
