import path from 'path'
import { connect } from 'puppeteer-real-browser'
import { delay, dedupeBy } from './helpers.js'
import { SEARCH_CHANNELS } from './constants.js'

export async function searchAscii2d(imagePath) {

  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    connectOption: { defaultViewport: null },
  })

  try {
    await page.goto('https://ascii2d.net/', { waitUntil: 'networkidle2' })
    const absoluteImagePath = path.resolve(imagePath)

    const fileInput = await page.$('input#file-form')
    if (!fileInput) {
      throw new Error('无法在页面中找到上传表单，可能网站结构已更改')
    }

    await fileInput.uploadFile(absoluteImagePath)

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      page.click('#file_upload button[type="submit"]'),
    ])

    let isLoaded = false
    for (let index = 0; index < 45; index += 1) {
      try {
        const url = page.url()
        const title = await page.title()
        const isResultPage = url.includes('/search/color/') || url.includes('/search/bovw/')
        const isNotCloudflare = title.includes('二次元画像詳細検索') && !url.endsWith('ascii2d.net/')

        if (isResultPage || isNotCloudflare) {
          isLoaded = true
          break
        }
      } catch {
      }
      await delay(1000)
    }

    if (!isLoaded) {
      const finalTitle = await page.title().catch(() => '未知(获取失败)')
      logger.warn('[ImageSearch][Ascii2d] 等待搜索结果页面超时，当前标题:', finalTitle)
    }

    const results = await page.evaluate(() => {
      const items = document.querySelectorAll('.detail-box')
      const data = []

      items.forEach(item => {
        const row = item.closest('.row')
        const imgEl = row ? row.querySelector('.image-box img') : null
        const imgSrc = imgEl ? imgEl.src : null
        const aLabels = item.querySelectorAll('h6 a')
        const pText = item.querySelector('.text-muted') ? item.querySelector('.text-muted').innerText.trim() : ''

        if (aLabels.length >= 2) {
          data.push({
            title: aLabels[0].innerText,
            url: aLabels[0].href,
            author: aLabels[1].innerText,
            authorUrl: aLabels[1].href,
            details: pText,
            thumb: imgSrc,
          })
        }
      })

      return data
    })

    return {
      channel: SEARCH_CHANNELS.ASCII2D,
      items: dedupeBy(results, item => `${item.url}|${item.authorUrl || ''}`),
    }
  } catch (error) {
    logger.error('[ImageSearch][Ascii2d] 执行过程遭遇异常:', error)
    throw error
  } finally {
    await browser.close()
  }
}
