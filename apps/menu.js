import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import Setting from "../lib/setting.js"
import { pluginresources } from "../lib/path.js"
import _ from "lodash"

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

  async getImageUrl() {
    const url = "https://yande.re/post.json?tags=loli+-rating:e+-nipples&limit=500"
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const jsonData = await response.json()

      if (Array.isArray(jsonData) && jsonData.length > 0) {
        const imageUrls = jsonData.map(item => item?.file_url).filter(url => url)

        if (imageUrls.length > 0) {
          return _.sample(imageUrls)
        } else {
          logger.warn("没有获取到有效的图片URL")
          return null
        }
      } else {
        logger.warn("没有获取到有效的图片数据")
        return null
      }
    } catch (error) {
      logger.error(`获取图片URL时出错:`, error)
      return null
    }
  }

  async showMenu(e) {
    let browser = null
    try {
      const menuData = Setting.getConfig("menu")
      let imageUrl = await this.getImageUrl()

      if (!imageUrl) {
        const defaultImagePath = path.join(pluginresources, "menu", "image")
        try {
          const files = fs.readdirSync(defaultImagePath)
          if (files.length > 0) {
            const randomImage = _.sample(files)
            const imagePath = path.join(defaultImagePath, randomImage)
            const imageBuffer = fs.readFileSync(imagePath)
            const base64Image = imageBuffer.toString("base64")
            const mimeType = "image/" + path.extname(imagePath).slice(1)
            imageUrl = `data:${mimeType};base64,${base64Image}`
          }
        } catch (err) {
          logger.error("读取默认菜单图片时出错:", err)
        }
      }

      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
      const page = await browser.newPage()

      await page.setViewport({ width: 960, height: 1080, deviceScaleFactor: 2 })

      const htmlPath = path.join(pluginresources, "menu", "menu.html")
      const htmlContent = fs.readFileSync(htmlPath, "utf8")

      await page.setContent(htmlContent, { waitUntil: "networkidle0" })

      await page.evaluate(
        (data, imageUrl) => {
          renderMenu(data, imageUrl)
        },
        menuData,
        imageUrl,
      )

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
