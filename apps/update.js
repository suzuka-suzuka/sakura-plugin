import { createRequire } from "module"
import _ from "lodash"
import { Restart } from "../../other/restart.js"

const require = createRequire(import.meta.url)
const { exec, execSync } = require("child_process")

const pluginName = "sakura-plugin"
const pluginRepo = "https://github.com/suzuka-suzuka/sakura-plugin"

let uping = false

export class Update extends plugin {
  constructor() {
    super({
      name: `更新`,
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: `^#?(sakura|樱花)(插件)?(强制)?更新$`,
          fnc: "update",
          log: false,
        },
      ],
    })
  }

  async update() {
    if (!this.e.isMaster) return false

    if (uping) {
      await this.reply("已有命令更新中..请勿重复操作")
      return
    }

    if (!(await this.checkGit())) return

    const isForce = this.e.msg.includes("强制")

    await this.runUpdate(isForce)

    if (this.isUp) {
      setTimeout(() => this.restart(), 2000)
    }
  }

  restart() {
    new Restart(this.e).restart()
  }

  async runUpdate(isForce) {
    const pluginPath = `./plugins/${pluginName}/`
    let command
    if (isForce) {
      command = `git -C ${pluginPath} fetch --all && git -C ${pluginPath} reset --hard origin/main && git -C ${pluginPath} clean -fd`
      this.e.reply("正在执行强制更新操作，将丢弃所有本地修改...")
    } else {
      command = `git -C ${pluginPath} pull --no-rebase`
      this.e.reply("正在执行更新操作，请稍等...")
    }
    this.oldCommitId = await this.getcommitId(pluginName)
    uping = true
    let ret = await this.execAsync(command)
    uping = false

    if (ret.error) {
      logger.mark(`${this.e.logFnc} 更新失败：${pluginName}`)
      this.gitErr(ret.error, ret.stdout)
      return false
    }

    let time = await this.getTime(pluginName)

    if (/(Already up[ -]to[ -]date|已经是最新的)/.test(ret.stdout)) {
      await this.reply(`${pluginName} 已经是最新版本\n最后更新时间：${time}`)
    } else {
      await this.reply(`${pluginName} 更新成功\n最后更新时间：${time}`)
      this.isUp = true
      let log = await this.getLog(pluginName)
      await this.reply(log)
    }

    logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)

    return true
  }

  async getLog(plugin = "") {
    let cm = `git -C ./plugins/${plugin}/ log -20 --oneline --pretty=format:"%h||[%cd]  %s" --date=format:"%m-%d %H:%M"`

    let logAll
    try {
      logAll = await execSync(cm, { encoding: "utf-8" })
    } catch (error) {
      logger.error(error.toString())
      this.reply(error.toString())
    }

    if (!logAll) return false

    logAll = logAll.split("\n")

    let log = []
    for (let str of logAll) {
      str = str.split("||")
      if (str[0] == this.oldCommitId) break
      if (str[1].includes("Merge branch")) continue
      log.push(str[1])
    }
    let line = log.length
    log = log.join("\n\n")

    if (log.length <= 0) return ""

    let end = `更多详细信息，请前往github查看\n${pluginRepo}`

    log = await this.makeForwardMsg(`${pluginName}更新日志，共${line}条`, log, end)

    return log
  }

  async getcommitId(plugin = "") {
    const cm = `git -C ./plugins/${plugin}/ rev-parse --short HEAD`
    try {
      const commitId = execSync(cm, { encoding: "utf-8" })
      return _.trim(commitId)
    } catch (error) {
      logger.error(`获取 ${plugin} commitId 失败:`)
      logger.error(error)
      return ""
    }
  }

  async getTime(plugin = "") {
    let cm = `git -C ./plugins/${plugin}/ log -1 --oneline --pretty=format:"%cd" --date=format:"%m-%d %H:%M"`

    let time = ""
    try {
      time = await execSync(cm, { encoding: "utf-8" })
      time = _.trim(time)
    } catch (error) {
      logger.error(error.toString())
      time = "获取时间失败"
    }
    return time
  }

  async makeForwardMsg(title, msg, end) {
    const _bot = this.e.bot
    if (!_bot) {
      logger.warn("makeForwardMsg: this.e.bot is not available.")
      return [title, msg, end].filter(Boolean).join("\n\n")
    }
    let nickname = _bot.nickname
    if (this.e.isGroup) {
      let info =
        (await _bot?.pickMember?.(this.e.group_id, _bot.uin)) ||
        (await _bot?.getGroupMemberInfo?.(this.e.group_id, _bot.uin))
      nickname = info.card || info.nickname
    }
    let userInfo = {
      user_id: _bot.uin,
      nickname,
    }

    let forwardMsg = [
      {
        ...userInfo,
        message: title,
      },
      {
        ...userInfo,
        message: msg,
      },
    ]

    if (end) {
      forwardMsg.push({
        ...userInfo,
        message: end,
      })
    }

    if (this.e.group?.makeForwardMsg) {
      forwardMsg = await this.e.group.makeForwardMsg(forwardMsg)
    } else if (this.e?.friend?.makeForwardMsg) {
      forwardMsg = await this.e.friend.makeForwardMsg(forwardMsg)
    } else {
      return msg.join("\n")
    }

    let dec = `${pluginName} 更新日志`
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

    return forwardMsg
  }

  async gitErr(err, stdout) {
    let msg = "更新失败！"
    let errMsg = err.toString()
    stdout = stdout.toString()

    if (errMsg.includes("Timed out")) {
      let remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, "")
      await this.reply(msg + `\n连接超时：${remote}`)
      return
    }

    if (/Failed to connect|unable to access/g.test(errMsg)) {
      let remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, "")
      await this.reply(msg + `\n连接失败：${remote}`)
      return
    }

    if (errMsg.includes("be overwritten by merge")) {
      await this.reply(
        msg + `存在冲突：\n${errMsg}\n` + "请解决冲突后再更新，或者执行#强制更新，放弃本地修改",
      )
      return
    }

    if (stdout.includes("CONFLICT")) {
      await this.reply([
        msg + "存在冲突\n",
        errMsg,
        stdout,
        "\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改",
      ])
      return
    }

    await this.reply([errMsg, stdout])
  }

  async execAsync(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
        resolve({ error, stdout, stderr })
      })
    })
  }

  async checkGit() {
    let ret = await execSync("git --version", { encoding: "utf-8" })
    if (!ret || !ret.includes("git version")) {
      await this.reply("请先安装git")
      return false
    }
    return true
  }
}
