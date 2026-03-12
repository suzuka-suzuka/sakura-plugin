import path from 'path'
import { connect } from 'puppeteer-real-browser'
import Setting from '../setting.js'
import { SEARCH_CHANNELS } from './constants.js'
import { delay, dedupeBy, sanitizeGoogleAiText } from './helpers.js'

function parseCookieString(raw, domain = '.google.com') {
  if (!raw || !raw.trim()) return []
  return raw.split(';').map(pair => {
    const idx = pair.indexOf('=')
    if (idx === -1) return null
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    return { name, value, domain, path: '/', url: 'https://www.google.com' }
  }).filter(c => c !== null)
}

export async function searchGoogleLens(imagePath) {
  const config = Setting.getConfig('SearchImage') || {}
  const cookieStr = config.googleCookie || ''
  const parsedCookies = parseCookieString(cookieStr)

  const { browser, page } = await connect({
    headless: false,
    turnstile: false,
    args: [],
    connectOption: { defaultViewport: null },
  })

  try {
    if (parsedCookies.length > 0) {
      await browser.setCookie(...parsedCookies)
    }

    await page.goto('https://images.google.com/', { waitUntil: 'networkidle2' })

    const lensIcon = await page.$('.nDcEnd, .Gdd5U, div[aria-label="Search by image"], div[aria-label="按图片搜索"]')
    if (!lensIcon) {
      throw new Error('无法在谷歌页面中找到 Lens 上传入口。')
    }

    await lensIcon.click()
    await delay(3000)

    const fileInputs = await page.$$('input[type="file"]')
    if (!fileInputs.length) {
      throw new Error('弹出区域内没有找到文件上传控件。')
    }

    const absoluteImagePath = path.resolve(imagePath)
    await fileInputs[0].uploadFile(absoluteImagePath)

    const urlBeforeUpload = page.url()
    try {
      await page.waitForFunction(
        (prevUrl) => window.location.href !== prevUrl && (
          window.location.href.includes('/search') || window.location.href.includes('lens.google')
        ),
        { timeout: 30000 },
        urlBeforeUpload
      )
    } catch {
    }

    try {
      await page.waitForFunction(
        () => document.querySelectorAll('a[href]:not([href*="google.com"])').length > 3,
        { timeout: 15000 }
      )
    } catch {
    }

    const scrapedData = await page.evaluate(() => {
      let aiText = ''
      try {
        const possibleHeaders = Array.from(document.querySelectorAll('h1, h2, h3, span, div')).filter(el => {
          if (!el.innerText) return false
          const text = el.innerText.trim()
          return text === 'AI 概览' || text === 'AI Overview' || text.endsWith('AI 概览') || text.endsWith('AI Overview')
        })

        if (possibleHeaders.length > 0) {
          let header = possibleHeaders[possibleHeaders.length - 1]
          let container = header.parentElement

          for (let index = 0; index < 6; index += 1) {
            if (container && container.innerText && container.innerText.length > header.innerText.length + 30) {
              aiText = container.innerText
              break
            }
            if (container) container = container.parentElement
          }
        }
      } catch {}

      const links = Array.from(document.querySelectorAll('a'))
        .filter(a => a.href && !a.href.includes('google.com') && a.innerText.trim().length > 0)

      const results = links.map(a => {
        let parent = a
        for (let index = 0; index < 3 && parent; index += 1) {
          parent = parent.parentElement
        }

        let thumb = null
        if (parent) {
          const imgs = Array.from(parent.querySelectorAll('img'))
          imgs.sort((img1, img2) => (img2.width * img2.height) - (img1.width * img1.height))
          if (imgs.length > 0 && imgs[0].width > 30) {
            thumb = imgs[0].src
          }
        }

        if (!thumb) {
          const img = a.querySelector('img')
          thumb = img ? img.src : null
        }

        return {
          title: a.innerText.replace(/\n /g, ' ').trim(),
          url: a.href,
          thumb,
        }
      }).filter(item => item.thumb)

      return { aiText, results }
    })

    return {
      channel: SEARCH_CHANNELS.GOOGLE,
      aiText: sanitizeGoogleAiText(scrapedData.aiText),
      items: dedupeBy(scrapedData.results, item => `${item.url}|${item.title}`),
    }
  } catch (error) {
    logger.error('[ImageSearch][GoogleLens] 执行过程遭遇异常:', error)
    throw error
  } finally {
    await browser.close()
  }
}
