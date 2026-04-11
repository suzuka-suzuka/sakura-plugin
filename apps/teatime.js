import { connect } from "puppeteer-real-browser"
import schedule from "node-schedule"
import Setting from "../lib/setting.js"
import _ from "lodash"
import pluginConfigManager from "../../../src/core/pluginConfig.js"
import { getBots } from "../../../src/api/client.js"

export class teatime extends plugin {
  constructor() {
    super({
      name: "teatime",
      priority: 1135,
      configWatch: "teatime",
    })
  }

  getScopeIds() {
    const configuredIds = pluginConfigManager.getConfiguredSelfIds("sakura-plugin")
    const onlineIds = getBots()
      .map((currentBot) => Number(currentBot.self_id))
      .filter((selfId) => Number.isFinite(selfId))
    return [...new Set([...configuredIds, ...onlineIds])]
  }

  async init() {
    for (const selfId of this.getScopeIds()) {
      const config = Setting.getConfig("teatime", { selfId })
      const groups = Array.isArray(config?.Groups) ? config.Groups : []
      if (!groups.length) {
        continue
      }

      const cronExpression = String(config?.cron || "0 15 * * *").trim()
      try {
        const job = schedule.scheduleJob(cronExpression, async () => {
          await this.runForSelf(selfId)
        })
        if (job) {
          this.jobs.push(job)
        }
      } catch (error) {
        logger.warn(`[teatime] 跳过无效 cron 配置: ${selfId} -> ${cronExpression} (${error.message})`)
      }
    }
  }

  async runForSelf(selfId) {
    const config = Setting.getConfig("teatime", { selfId })
    const groups = Array.isArray(config?.Groups) ? config.Groups : []
    if (!groups.length) {
      return
    }

    const currentBot = this.getBot(selfId)
    if (!currentBot) {
      return
    }

    for (const groupId of groups) {
      await currentBot.pickGroup(groupId).sendMsg("下午茶时间到，来点萝莉")

      let browser

      try {
        const { page, browser: realBrowser } = await connect({
          headless: false,
          turnstile: true,
        })
        browser = realBrowser
        await page.goto("https://konachan.com/post.json?tags=loli+-rating:e+-nipples&limit=500", {
          waitUntil: "networkidle2",
          timeout: 20000,
        })
        await new Promise(resolve => setTimeout(resolve, 20000))
        const jsonText = await page.evaluate(() => document.body.innerText)

        let jsonData
        try {
          jsonData = JSON.parse(jsonText)
        } catch (parseError) {
          logger.error(`[teatime]群 ${groupId} JSON 解析失败:`, parseError)
          if (browser) {
            await browser.close()
          }
          continue
        }

        if (Array.isArray(jsonData) && jsonData.length > 0) {
          if (browser) {
            await browser.close()
            browser = null
          }

          const imageUrls = jsonData.map(item => item?.file_url).filter(url => url)

          if (imageUrls.length > 0) {
            const selectedUrls = _.sampleSize(imageUrls, 5)
            for (const imageUrl of selectedUrls) {
              try {
                await currentBot.pickGroup(groupId).sendMsg(segment.image(imageUrl))
                await new Promise(resolve => setTimeout(resolve, 1000))
              } catch (sendError) {
                logger.error(`[teatime]向群 ${groupId} 发送图片消息失败: ${imageUrl}`, sendError)
              }
            }
          } else {
            logger.warn(`[teatime]群 ${groupId} 获取到的图片URL列表为空。`)
          }
        } else {
          logger.error(`[teatime]群 ${groupId} 获取到 API 数据，但数据为空或格式不正确。`, jsonData)
          if (browser) {
            await browser.close()
          }
        }
      } catch (error) {
        logger.error(`[teatime]群 ${groupId} 整体处理流程出错:`, error)
      } finally {
        if (browser) {
          await browser.close()
        }
      }
    }
  }
}
