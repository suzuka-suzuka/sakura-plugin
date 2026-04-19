import { connect } from "puppeteer-real-browser"
import crypto from "crypto"
import https from "https"
import fs from "fs"
import path from "path"
import { pluginConfigDir } from "../lib/path.js"


const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
const REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
const LOGIN_URL = "https://app-api.pixiv.net/web/v1/login"
const TOKEN_URL = "https://oauth.secure.pixiv.net/auth/token"


function generatePKCE() {
    const codeVerifier = crypto.randomBytes(32)
        .toString("base64url")
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 43)

    const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url")
    return { codeVerifier, codeChallenge }
}


function exchangeToken(code, codeVerifier) {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            code_verifier: codeVerifier,
            grant_type: "authorization_code",
            include_policy: "true",
            redirect_uri: REDIRECT_URI,
        }).toString()
        const options = {
            hostname: "oauth.secure.pixiv.net",
            path: "/auth/token",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(postData),
                "User-Agent": "PixivAndroidApp/5.0.234 (Android 14; Pixel 8)",
            },
        }

        const req = https.request(options, (res) => {
            let data = ""
            res.on("data", (chunk) => { data += chunk })
            res.on("end", () => {
                try {
                    const json = JSON.parse(data)
                    if (json.refresh_token) {
                        resolve(json)
                    } else {
                        reject(new Error(`Token 交换失败: ${data}`))
                    }
                } catch (e) {
                    reject(new Error(`解析响应失败: ${data}`))
                }
            })
        })

        req.on("error", reject)
        req.write(postData)
        req.end()
    })
}

async function main() {
    console.log("=".repeat(60))
    console.log("  Pixiv Token 获取工具")
    console.log("=".repeat(60))
    console.log()


    const { codeVerifier, codeChallenge } = generatePKCE()
    const loginUrl = `${LOGIN_URL}?code_challenge=${codeChallenge}&code_challenge_method=S256&client=pixiv-android`

    console.log("[1/4] 正在启动浏览器...")

    let browser
    try {
        const result = await connect({
            headless: false,
            turnstile: true,
        })

        browser = result.browser
        const page = result.page


        console.log("[2/4] 正在打开 Pixiv 登录页...")
        console.log("  → 请在浏览器中完成登录")
        console.log()

        await page.goto(loginUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        })


        console.log("[3/4] 等待登录完成...")

        const authCode = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("登录超时（5分钟），请重试"))
            }, 5 * 60 * 1000)


            const checkUrl = async () => {
                try {
                    const currentUrl = page.url()
                    if (currentUrl.includes("/callback") && currentUrl.includes("code=")) {
                        clearTimeout(timeout)
                        const url = new URL(currentUrl)
                        const code = url.searchParams.get("code")
                        if (code) {
                            resolve(code)
                            return
                        }
                    }
                } catch (e) {
                }
            }


            page.on("request", (request) => {
                const url = request.url()
                if (url.startsWith(REDIRECT_URI) && url.includes("code=")) {
                    clearTimeout(timeout)
                    const urlObj = new URL(url)
                    const code = urlObj.searchParams.get("code")
                    if (code) {
                        resolve(code)
                    }
                }
            })


            const interval = setInterval(async () => {
                try {
                    await checkUrl()
                } catch (e) {
                    clearInterval(interval)
                }
            }, 1000)


            const origResolve = resolve
            resolve = (value) => {
                clearInterval(interval)
                origResolve(value)
            }
        })

        console.log("  ✓ 登录成功，获取到 auth code")


        console.log("[4/4] 正在获取 Cookie 和 Token...")


        await page.goto("https://www.pixiv.net/", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        })
        await new Promise(r => setTimeout(r, 3000))

        const cookies = await page.cookies("https://www.pixiv.net")
        const cookieString = cookies
            .map(c => `${c.name}=${c.value}`)
            .join("; ")

        await browser.close()
        browser = null


        const tokenData = await exchangeToken(authCode, codeVerifier)
        const refreshToken = tokenData.refresh_token


        console.log()
        console.log("=".repeat(60))
        console.log("  获取成功！")
        console.log("=".repeat(60))
        console.log()
        console.log("Refresh Token:")
        console.log(refreshToken)
        console.log()
        console.log("Cookie:")
        console.log(cookieString)
        console.log()


        try {
            const configFile = path.join(pluginConfigDir, "pixiv.yaml")

            if (fs.existsSync(configFile)) {
                let content = fs.readFileSync(configFile, "utf-8")
                const originalContent = content


                if (content.includes("refresh_token:")) {
                    content = content.replace(
                        /refresh_token:.*$/m,
                        `refresh_token: '${refreshToken}'`
                    )
                }


                if (content.includes("cookie:")) {
                    content = content.replace(
                        /cookie:.*$/m,
                        `cookie: '${cookieString}'`
                    )
                }

                if (content !== originalContent) {
                    fs.writeFileSync(configFile, content, "utf-8")
                    console.log(`✓ 已自动保存到 ${configFile}`)
                } else {
                    console.log("⚠ 配置文件中未找到对应字段，请手动复制上方内容到配置中")
                }
            } else {
                console.log(`⚠ 配置文件不存在: ${configFile}`)
                console.log("  请手动将上方内容填入 Pixiv 配置")
            }
        } catch (e) {
            console.log(`⚠ 自动保存失败: ${e.message}`)
            console.log("  请手动将上方内容填入 Pixiv 配置")
        }

    } catch (error) {
        console.error()
        console.error(`✗ 错误: ${error.message}`)
    } finally {
        if (browser) {
            await browser.close().catch(() => { })
        }
    }
}

main()
