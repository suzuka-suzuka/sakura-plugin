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
          reg: "^#(菜单|帮助)$",
          fnc: "showMenu",
          log: false,
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
        const imageItems = jsonData.filter(item => item?.file_url && item?.id)

        if (imageItems.length > 0) {
          const selectedItem = _.sample(imageItems)
          return { url: selectedItem.file_url, id: selectedItem.id }
        } else {
          logger.warn("没有获取到有效的图片URL和ID")
          return null
        }
      } else {
        logger.warn("没有获取到有效的图片数据")
        return null
      }
    } catch (error) {
      logger.error("获取图片URL时出错:", error)
      return null
    }
  }

  async showMenu(e) {
    let browser = null
    try {
      const menuData = Setting.getConfig("menu")
      const defaultImagePath = path.join(pluginresources, "background")
      const imageInfo = await this.getImageUrl()
      let imageUrl = imageInfo?.url

      if (imageUrl && imageUrl.startsWith("http")) {
        try {
          const response = await fetch(imageUrl)
          if (response.ok) {
            const imageBuffer = Buffer.from(await response.arrayBuffer())

            if (imageInfo?.id) {
              ;(async () => {
                try {
                  await fs.promises.mkdir(defaultImagePath, { recursive: true })
                  const extension = path.extname(new URL(imageUrl).pathname)
                  const filename = `${imageInfo.id}${extension}`
                  const savePath = path.join(defaultImagePath, filename)
                  await fs.promises.writeFile(savePath, imageBuffer)
                  logger.debug(`菜单图片已保存: ${savePath}`)
                } catch (saveError) {
                  logger.error("保存菜单图片失败:", saveError)
                }
              })()
            }

            const base64Image = imageBuffer.toString("base64")
            const mimeType = response.headers.get("content-type") || "image/jpeg"
            imageUrl = `data:${mimeType};base64,${base64Image}`
          } else {
            logger.warn(`获取菜单背景图片失败，状态码: ${response.status}, URL: ${imageUrl}`)
            imageUrl = null
          }
        } catch (err) {
          logger.error("获取菜单背景图片时网络请求出错:", err)
          imageUrl = null
        }
      }

      if (!imageUrl) {
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
        throw new Error("生成图片失败")
      }
    } catch (error) {
      logger.error("生成菜单时出错:", error)
    } finally {
      if (browser) {
        await browser.close()
      }
    }

    return true
  }
}
