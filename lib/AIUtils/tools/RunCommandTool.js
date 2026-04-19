import { AbstractTool } from "./AbstractTool.js"
import { spawn } from "child_process"
import path from "path"
import { projectRoot } from "../../path.js"

const ALLOWED_ROOT = path.resolve(projectRoot)
const DEFAULT_TIMEOUT = 60000
const MAX_TIMEOUT = 600000
const FORCE_KILL_GRACE_MS = 5000
const IS_WINDOWS = process.platform === "win32"


const OUTPUT_ENCODING = IS_WINDOWS ? "gbk" : "utf-8"
const decoder = new TextDecoder(OUTPUT_ENCODING)

export class RunCommandTool extends AbstractTool {
    name = "RunCommand"
    description = `在项目目录下执行命令行命令。当前系统 ${IS_WINDOWS ? "Windows" : process.platform}。工作目录 ${ALLOWED_ROOT}。支持任意合法命令，不允许破坏性操作。如需创建或下载临时文件，请放置在项目根目录的 temp目录下，切勿直接在项目根目录创建文件。`
    parameters = {
        properties: {
            command: {
                type: "string",
                description: "要执行的命令",
            },
            cwd: {
                type: "string",
                description: "工作目录，相对于项目根目录，默认为项目根目录",
            },
            timeout: {
                type: "number",
                description: `超时秒数，默认 ${DEFAULT_TIMEOUT / 1000} 秒，最大 ${MAX_TIMEOUT / 1000} 秒。执行文件下载等耗时操作时可设置为 120~300。`,
            },
        },
        required: ["command"],
    }

    func = async function (opts) {
        const { command, cwd = ".", timeout: timeoutSec } = opts
        const commandTimeout = timeoutSec
            ? Math.min(Math.max(timeoutSec, 1) * 1000, MAX_TIMEOUT)
            : DEFAULT_TIMEOUT

        if (!command || command.trim() === "") {
            return "错误：必须提供要执行的命令。"
        }

        const workDir = path.resolve(ALLOWED_ROOT, cwd)
        if (!workDir.startsWith(ALLOWED_ROOT)) {
            return "错误：工作目录必须在项目根目录内。"
        }

        return new Promise((resolve) => {
            const child = spawn(command, [], {
                cwd: workDir,
                shell: true,
                env: { ...process.env, PAGER: "cat" },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            })

            const stdoutChunks = []
            const stderrChunks = []
            let timedOut = false
            let closed = false
            let settled = false
            let forceKillTimer = null

            const finish = (message) => {
                if (!settled) {
                    settled = true
                    resolve(message)
                }
            }

            const timeoutTimer = setTimeout(() => {
                if (closed) return
                timedOut = true
                child.kill("SIGTERM")
                forceKillTimer = setTimeout(() => {
                    if (!closed) {
                        child.kill("SIGKILL")
                    }
                }, FORCE_KILL_GRACE_MS)
            }, commandTimeout)

            child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk))
            child.stderr?.on("data", (chunk) => stderrChunks.push(chunk))

            child.on("close", (code, signal) => {
                closed = true
                clearTimeout(timeoutTimer)
                if (forceKillTimer) clearTimeout(forceKillTimer)

                const stdout = decoder.decode(Buffer.concat(stdoutChunks)).trimEnd()
                const stderr = decoder.decode(Buffer.concat(stderrChunks)).trimEnd()

                let output = ""
                if (stdout) output += stdout
                if (stderr) output += (output ? "\n" : "") + `[stderr]\n${stderr}`

                if (timedOut || signal === "SIGTERM" || signal === "SIGKILL") {
                    finish(`命令超时（${commandTimeout / 1000}秒），已终止。\n${output}`)
                } else if (code !== 0) {
                    finish(`命令执行完毕（退出码: ${code}）\n${output || "(无输出)"}`)
                } else {
                    finish(output ? `命令执行成功:\n${output}` : "命令执行成功（无输出）。")
                }
            })

            child.on("error", (err) => {
                clearTimeout(timeoutTimer)
                if (forceKillTimer) clearTimeout(forceKillTimer)
                finish(`执行失败: ${err.message}`)
            })
        })
    }
}
