import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import Setting from "../lib/setting.js"
import { pluginresources } from "../lib/path.js"
export class helpMenu extends plugin {
  constructor() {
    super({
      name: "菜单",
      dsc: "菜单",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^#?菜单$",
          fnc: "showMenu",
        },
      ],
    })
  }

  async showMenu(e) {
    let browser = null
    try {
    const menuData= Setting.getConfig("menu")

      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
      const page = await browser.newPage()

      await page.setViewport({ width: 960, height: 1080, deviceScaleFactor: 2 })

      const htmlPath = path.join(pluginresources, "menu", "menu.html")
      const htmlContent = fs.readFileSync(htmlPath, "utf8")

      await page.setContent(htmlContent, { waitUntil: "networkidle0" })

      await page.evaluate(data => {
        renderMenu(data)
      }, menuData)

      const element = await page.$("#capture-target")
      if (!element) {
        throw new Error("无法在页面上找到截图目标元素 #capture-target")
      }

      const img = await element.screenshot({
        type: "png",
      })

      if (img) {
        await e.reply(segment.image(img))
      } else {
        await e.reply("菜单图片生成失败，请查看后台日志。")
      }
    } catch (error) {
      console.error("生成菜单时出错:", error)
      await e.reply("生成菜单时遇到问题，请联系管理员。")
    } finally {
      if (browser) {
        await browser.close()
      }
    }

    return true
  }
}
