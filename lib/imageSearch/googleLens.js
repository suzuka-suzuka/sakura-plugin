import path from 'path'
import fs from 'fs'
import { connect } from 'puppeteer-real-browser'
import { plugindata } from '../path.js'
import { SEARCH_CHANNELS } from './constants.js'
import { delay, dedupeBy, sanitizeGoogleAiText } from './helpers.js'

const LENS_ENTRY_LABELS = [
  'Search by image',
  'Search by Image',
  'Search with an image',
  'Google Lens',
  'Google レンズ',
  'Google レンズで画像を検索',
  '画像で検索',
  '画像検索',
  '按图搜索',
  '按图片搜索',
  '以图搜索',
  '以图片搜索',
  '搜尋圖片',
  '按圖搜尋',
  '按圖片搜尋',
  '以圖搜尋',
  '以圖片搜尋',
]

const LENS_ENTRY_SELECTORS = [
  '[data-is-images-mode="true"]',
  'div[jsname="R5mgy"]',
  '[aria-label="Search by image"]',
  '[aria-label="画像で検索"]',
  '[aria-label*="Search by image" i][role="button"]',
  '[aria-label*="Google Lens" i][role="button"]',
  '[aria-label*="画像"][role="button"]',
  '[aria-label*="按图"][role="button"]',
  '[aria-label*="按图片"][role="button"]',
  '[aria-label*="以图"][role="button"]',
  '[aria-label*="搜尋"][role="button"]',
  '[aria-label*="按圖片"][role="button"]',
]

const GOOGLE_LENS_LANGUAGE = 'zh-CN'
const GOOGLE_LENS_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8'
const GOOGLE_IMAGES_URL = 'https://images.google.com/?hl=zh-CN&gl=CN'

async function findLensUploadEntry(page) {
  for (const selector of LENS_ENTRY_SELECTORS) {
    try {
      const element = await page.$(selector)
      if (element) return element
    } catch {
      // 某些 Chromium 版本不支持带 i 标记的属性选择器，忽略后继续走文本匹配
    }
  }

  const handle = await page.evaluateHandle((labels) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const normalizedLabels = labels.map(label => normalize(label))
    const candidates = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"], [aria-label], [title]'))

    return candidates.find(el => {
      const haystack = normalize([
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.textContent,
      ].filter(Boolean).join(' '))

      return normalizedLabels.some(label => haystack.includes(label))
    }) || null
  }, LENS_ENTRY_LABELS)

  const element = handle.asElement()
  if (!element) {
    await handle.dispose()
  }

  return element
}

async function assertGooglePageUsable(page) {
  const pageState = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title || '',
    text: document.body?.innerText?.slice(0, 1200) || '',
    hasCaptcha: Boolean(document.querySelector('#captcha-form, .g-recaptcha, iframe[src*="recaptcha"]')),
  })).catch(() => ({ url: page.url(), title: '', text: '', hasCaptcha: false }))

  if (
    pageState.hasCaptcha ||
    /\/sorry\//i.test(pageState.url) ||
    /unusual traffic|detected unusual traffic|captcha|recaptcha|人机验证|異常なトラフィック/i.test(pageState.text)
  ) {
    throw new Error('Google 返回了人机验证/异常流量页面，请先在浏览器中完成验证，或更换出口 IP/稍后再试。')
  }
}

async function getPageBrief(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title || '',
    text: document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 200) || '',
  })).catch(() => ({ url: page.url(), title: '', text: '' }))
}

async function prepareChineseGoogleLocale(page) {
  await page.setExtraHTTPHeaders({
    'Accept-Language': GOOGLE_LENS_ACCEPT_LANGUAGE,
  })

  await page.evaluateOnNewDocument((language) => {
    Object.defineProperty(navigator, 'language', { get: () => language })
    Object.defineProperty(navigator, 'languages', { get: () => [language, 'zh', 'en'] })
  }, GOOGLE_LENS_LANGUAGE)
}

export async function searchGoogleLens(imagePath, options = {}) {
  const { googleLogin = true } = options
  const userDataDir = path.resolve(plugindata, 'google-lens-profile')
  const profileExists = fs.existsSync(userDataDir)
  const useProfile = profileExists || googleLogin

  if (useProfile && !profileExists) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }

  let disableXvfb = false
  if (process.platform === 'linux' && googleLogin && !profileExists) {
    disableXvfb = true // 首次登录时尽量弹出真实浏览器，便于手动完成 Google 登录
  }

  const { browser, page } = await connect({
    headless: false,
    turnstile: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--lang=${GOOGLE_LENS_LANGUAGE}`],
    disableXvfb: disableXvfb,
    customConfig: useProfile ? { userDataDir } : {},
    connectOption: { defaultViewport: null },
  })

  try {
    await prepareChineseGoogleLocale(page)
    await page.goto(GOOGLE_IMAGES_URL, { waitUntil: 'networkidle2' })

    const signInButton = await page.$('a[href^="https://accounts.google.com/ServiceLogin"]')
    if (signInButton) {
      if (googleLogin) {
        logger.info('[ImageSearch][GoogleLens] 检测到未登录状态，请在弹出的浏览器窗口中手动登录，程序将等待 120秒...')
        try {
          await page.waitForFunction(() => !document.querySelector('a[href^="https://accounts.google.com/ServiceLogin"]'), { timeout: 120000 })
          logger.info('[ImageSearch][GoogleLens] 登录检测完成，继续执行...')
        } catch (e) {
          logger.info('[ImageSearch][GoogleLens] 等待登录超时，将以当前状态继续执行...')
        }
      } else {
        logger.info('[ImageSearch][GoogleLens] 检测到未登录状态，配置为不等待登录，将以当前状态继续执行...')
      }
    }

    await assertGooglePageUsable(page)

    await page.waitForFunction(({ labels, selectors }) => {
      for (const selector of selectors) {
        try {
          if (document.querySelector(selector)) return true
        } catch {
        }
      }

      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const normalizedLabels = labels.map(label => normalize(label))
      return Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"], [aria-label], [title]')).some(el => {
        const haystack = normalize([
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          el.textContent,
        ].filter(Boolean).join(' '))

        return normalizedLabels.some(label => haystack.includes(label))
      })
    }, { timeout: 15000 }, { labels: LENS_ENTRY_LABELS, selectors: LENS_ENTRY_SELECTORS }).catch(() => {})

    const lensIcon = await findLensUploadEntry(page)
    if (!lensIcon) {
      const pageBrief = await getPageBrief(page)
      throw new Error(`无法在谷歌页面中找到 Lens 上传入口。当前页面: ${pageBrief.title || '无标题'} ${pageBrief.url} ${pageBrief.text}`)
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
      const GOOGLE_HOST_PATTERN = /(^|\.)google\./i

      const normalizeInlineText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

      const isGoogleHost = (hostname) => GOOGLE_HOST_PATTERN.test(hostname) || hostname === 'lens.google.com'

      const isUnwantedGoogleLink = (url, text = '') => {
        const normalizedText = normalizeInlineText(text).toLowerCase()
        const hostname = String(url.hostname || '').toLowerCase()
        const href = String(url.href || '').toLowerCase()

        return hostname === 'policies.google.com' ||
          hostname === 'accounts.google.com' ||
          hostname === 'myaccount.google.com' ||
          /(^|\.)consent\.google\./i.test(hostname) ||
          /\b(privacy|terms|policy|policies|service[-_ ]?terms)\b/i.test(href) ||
          /(隐私|隱私|隐私权|隱私權|隐私政策|隱私政策|条款|條款|服务条款|服務條款|privacy|terms|policy|policies)/i.test(normalizedText)
      }

      const normalizeHref = (href, allowGoogleLink = false, linkText = '') => {
        if (!href) return ''

        try {
          const url = new URL(href, window.location.href)
          if (!/^https?:$/i.test(url.protocol)) return ''

          if (isGoogleHost(url.hostname)) {
            if (isUnwantedGoogleLink(url, linkText)) return ''

            const nestedKeys = ['url', 'q', 'imgrefurl', 'u']
            for (const key of nestedKeys) {
              const nested = url.searchParams.get(key)
              if (nested && /^https?:\/\//i.test(nested)) {
                try {
                  const nestedUrl = new URL(nested)
                  return isUnwantedGoogleLink(nestedUrl, linkText) ? '' : nestedUrl.href
                } catch {
                  return nested
                }
              }
            }

            return allowGoogleLink ? url.href : ''
          }

          return url.href
        } catch {
          return ''
        }
      }

      const escapeMarkdownText = (value) => normalizeInlineText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')

      const escapeMarkdownUrl = (value) => String(value || '').replace(/\)/g, '%29')

      const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      const buildMarkdownLink = (link) => `[${escapeMarkdownText(link.text)}](${escapeMarkdownUrl(link.url)})`

      const buildLooseTextPattern = (text) => {
        const tokens = normalizeInlineText(text).split(/\s+/).filter(Boolean).map(escapeRegExp)
        return tokens.length > 0 ? new RegExp(tokens.join('\\s+'), 'u') : null
      }

      const appendBeforeGoogleDisclaimer = (content, appendix) => {
        const match = String(content || '').match(/\s*(在 AI 模式下深入探索|AI 的回答未必正确无误，请注意核查)[\s\S]*$/u)
        if (typeof match?.index === 'number') {
          return `${content.slice(0, match.index).trimEnd()}\n\n${appendix}${content.slice(match.index)}`
        }

        return `${content}\n\n${appendix}`
      }

      const isNoisyLinkText = (text) => {
        const normalized = normalizeInlineText(text).toLowerCase()
        return !normalized ||
          normalized.length > 80 ||
          normalized.startsWith('http://') ||
          normalized.startsWith('https://') ||
          /(隐私|隱私|隐私权|隱私權|隐私政策|隱私政策|条款|條款|服务条款|服務條款|privacy|terms|policy|policies)/i.test(normalized) ||
          /^(更多|更多内容|反馈|分享|复制链接|打开|查看|访问|搜索|图片|网页|登录|设置|工具|more|feedback|share|copy link|open|visit|search|images|sign in|settings|tools)$/i.test(normalized)
      }

      const collectLinks = (root, allowGoogleLink = false) => {
        const seen = new Set()
        const seenUrls = new Set()
        const links = []

        Array.from(root.querySelectorAll('a[href]')).forEach(a => {
          const text = normalizeInlineText(
            a.innerText ||
            a.textContent ||
            a.getAttribute('aria-label') ||
            a.getAttribute('title') ||
            '链接'
          )
          const url = normalizeHref(a.href, allowGoogleLink, text)

          if (!url || isNoisyLinkText(text)) return

          const key = `${text}|${url}`
          if (seen.has(key) || seenUrls.has(url)) return
          seen.add(key)
          seenUrls.add(url)
          links.push({ text, url })
        })

        return links
      }

      const applyMarkdownLinks = (text, links) => {
        let output = String(text || '').replace(/\r/g, '').trim()
        if (!output || !links.length) return output

        const insertedKeys = new Set()

        links.forEach(link => {
          if (!link.text || !link.url) return

          const key = `${link.text}|${link.url}`
          const markdown = buildMarkdownLink(link)
          const lines = output.split('\n')
          const lineIndex = lines.findIndex(line => normalizeInlineText(line) === link.text && !line.includes(']('))

          if (lineIndex !== -1) {
            const leading = lines[lineIndex].match(/^\s*/)?.[0] || ''
            const trailing = lines[lineIndex].match(/\s*$/)?.[0] || ''
            lines[lineIndex] = `${leading}${markdown}${trailing}`
            output = lines.join('\n')
            insertedKeys.add(key)
            return
          }

          if (link.text.length >= 2 && link.text.length <= 80 && !output.includes(markdown)) {
            const loosePattern = buildLooseTextPattern(link.text)
            if (loosePattern && loosePattern.test(output)) {
              output = output.replace(loosePattern, markdown)
              insertedKeys.add(key)
            }
          }
        })

        const uninsertedLinks = links
          .filter(link => !insertedKeys.has(`${link.text}|${link.url}`))
          .slice(0, 8)

        if (uninsertedLinks.length > 0) {
          const appendix = `引用链接：\n${uninsertedLinks.map(link => `- ${buildMarkdownLink(link)}`).join('\n')}`
          output = appendBeforeGoogleDisclaimer(output, appendix)
        }

        return output
      }

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
              aiText = applyMarkdownLinks(container.innerText, collectLinks(container, true))
              break
            }
            if (container) container = container.parentElement
          }
        }
      } catch {}

      const links = Array.from(document.querySelectorAll('a'))
        .map(a => ({ a, url: normalizeHref(a.href, false, a.innerText) }))
        .filter(({ a, url }) => url && a.innerText.trim().length > 0)

      const results = links.map(({ a, url }) => {
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
          url,
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
