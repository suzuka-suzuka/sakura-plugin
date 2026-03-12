import fs from 'fs'
import path from 'path'
import { connect } from 'puppeteer-real-browser'
import { SEARCH_CHANNELS } from './constants.js'
import { delay, dedupeBy, sanitizeGoogleAiText } from './helpers.js'

const DEBUG_DIR = path.resolve('data', 'debug', 'google-lens')

function ensureDebugDir() {
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true })
  }
}

async function saveDebugSnapshot(page, label) {
  try {
    ensureDebugDir()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const base = path.join(DEBUG_DIR, `${ts}_${label}`)
    await page.screenshot({ path: `${base}.png`, fullPage: true })
    const html = await page.content()
    fs.writeFileSync(`${base}.html`, html, 'utf-8')
    logger.warn(`[ImageSearch][GoogleLens] 调试快照已保存: ${base}.png / .html`)
  } catch (snapshotErr) {
    logger.warn('[ImageSearch][GoogleLens] 保存调试快照失败:', snapshotErr.message)
  }
}

function detectBlockedPage(url = '', title = '') {
  const u = url.toLowerCase()
  const t = title.toLowerCase()
  if (u.includes('/sorry/') || u.includes('google.com/sorry')) return 'unusual-traffic (sorry页)'
  if (u.includes('consent.google')) return 'consent同意页'
  if (u.includes('accounts.google')) return '登录页'
  if (t.includes('before you continue') || t.includes('继续之前')) return 'consent同意页'
  if (t.includes('unusual traffic') || t.includes('异常流量')) return 'unusual-traffic'
  if (t.includes('captcha') || t.includes('robot') || t.includes('人机验证')) return '验证码页'
  return null
}

export async function searchGoogleLens(imagePath) {

  logger.info('[ImageSearch][GoogleLens] 启动浏览器...')
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    connectOption: { defaultViewport: null },
  })

  try {
    logger.info('[ImageSearch][GoogleLens] 正在打开 images.google.com ...')
    await page.goto('https://images.google.com/', { waitUntil: 'networkidle2' })
    await delay(2000)

    const urlAfterLoad = page.url()
    const titleAfterLoad = await page.title().catch(() => '(获取失败)')
    logger.info(`[ImageSearch][GoogleLens] 页面加载完成 — URL: ${urlAfterLoad} | Title: ${titleAfterLoad}`)

    const blocked = detectBlockedPage(urlAfterLoad, titleAfterLoad)
    if (blocked) {
      await saveDebugSnapshot(page, 'blocked-on-load')
      throw new Error(`Google 首页被拦截 (${blocked})，无法继续搜图。服务器 IP 可能需要走代理。`)
    }

    const lensIcon = await page.$('.nDcEnd, .Gdd5U, div[aria-label="Search by image"], div[aria-label="按图片搜索"]')
    if (!lensIcon) {
      await saveDebugSnapshot(page, 'no-lens-icon')
      throw new Error('无法在这台服务器的谷歌页面中找到 Lens 上传入口。')
    }
    logger.info('[ImageSearch][GoogleLens] 找到 Lens 图标，点击中...')

    await lensIcon.click()
    await delay(3000)

    const urlAfterClick = page.url()
    const titleAfterClick = await page.title().catch(() => '(获取失败)')
    logger.info(`[ImageSearch][GoogleLens] 点击 Lens 后 — URL: ${urlAfterClick} | Title: ${titleAfterClick}`)

    const blockedAfterClick = detectBlockedPage(urlAfterClick, titleAfterClick)
    if (blockedAfterClick) {
      await saveDebugSnapshot(page, 'blocked-after-click')
      throw new Error(`点击 Lens 图标后页面被拦截 (${blockedAfterClick})。`)
    }

    const fileInputs = await page.$$('input[type="file"]')
    if (!fileInputs.length) {
      await saveDebugSnapshot(page, 'no-file-input')
      throw new Error('弹出区域内没有找到文件上传控件。')
    }
    logger.info(`[ImageSearch][GoogleLens] 找到文件上传控件 (共 ${fileInputs.length} 个)，上传图片中...`)

    const absoluteImagePath = path.resolve(imagePath)
    logger.info(`[ImageSearch][GoogleLens] 图片路径: ${absoluteImagePath}`)
    await fileInputs[0].uploadFile(absoluteImagePath)

    logger.info('[ImageSearch][GoogleLens] 图片已上传，等待结果页加载 (最长 20s)...')
    // 尝试等待 URL 变化为 lens 结果页，最长等 20 秒
    try {
      await page.waitForFunction(
        () => window.location.href.includes('/search') || window.location.href.includes('lens.google'),
        { timeout: 20000 }
      )
    } catch {
      logger.warn('[ImageSearch][GoogleLens] 等待结果页 URL 变化超时，继续尝试抓取...')
    }

    const urlAfterUpload = page.url()
    const titleAfterUpload = await page.title().catch(() => '(获取失败)')
    logger.info(`[ImageSearch][GoogleLens] 上传后 — URL: ${urlAfterUpload} | Title: ${titleAfterUpload}`)

    const blockedAfterUpload = detectBlockedPage(urlAfterUpload, titleAfterUpload)
    if (blockedAfterUpload) {
      await saveDebugSnapshot(page, 'blocked-after-upload')
      throw new Error(`上传图片后页面被拦截 (${blockedAfterUpload})。`)
    }

    // 额外等待页面内容渲染
    await delay(3000)

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
      } catch {
      }

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

    logger.info(`[ImageSearch][GoogleLens] 抓取完成 — aiText长度: ${scrapedData.aiText?.length ?? 0}, 结果数(带缩略图): ${scrapedData.results?.length ?? 0}`)

    if (!scrapedData.aiText && (!scrapedData.results || scrapedData.results.length === 0)) {
      logger.warn('[ImageSearch][GoogleLens] 结果为空，保存调试快照...')
      await saveDebugSnapshot(page, 'empty-result')
    }

    return {
      channel: SEARCH_CHANNELS.GOOGLE,
      aiText: sanitizeGoogleAiText(scrapedData.aiText),
      items: dedupeBy(scrapedData.results, item => `${item.url}|${item.title}`),
    }
  } catch (error) {
    logger.error('[ImageSearch][GoogleLens] 执行过程遭遇异常:', error)
    try {
      await saveDebugSnapshot(page, 'exception')
    } catch {}
    throw error
  } finally {
    await browser.close()
    logger.info('[ImageSearch][GoogleLens] 浏览器已关闭')
  }
}
