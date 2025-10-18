import fs from "node:fs"

if (!global.segment) {
  global.segment = (await import("icqq")).segment
}

const files = fs.readdirSync("./plugins/sakura-plugin/apps").filter(file => file.endsWith(".js"))

let ret = []

files.forEach(file => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace(".js", "")

  if (ret[i].status != "fulfilled") {
    logger.error(`载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}
export { apps }
logger.info(logger.magenta("-----------------sakura插件-----------------"))
logger.info(logger.magenta("  ____   ____   __  __  __ __ _____   ____ "))
logger.info(logger.magenta(" (_ (_` / () \\ |  |/  /|  |  || () ) / () \\"))
logger.info(logger.magenta(".__)__)/__/\\__\\|__|\\__\\ \\___/ |_|\\_\\/__/\\__\\"))
logger.info(logger.magenta("                                            "))
logger.info(logger.magenta("-------------sakura插件加载成功-------------"))

setTimeout(() => {
  import("./webeditor.js")
    .then(module => {
      if (module.default && typeof module.default.setBot === "function") {
        module.default.setBot(global.Bot || Bot)
      }
    })
    .catch(err => {
      logger.error("[sakura-plugin] sakura面板启动失败:", err)
    })
}, 3000)
