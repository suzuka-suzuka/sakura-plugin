import { AbstractTool } from "./AbstractTool.js"
import fs from "fs"
import { spawn } from "child_process"
import path from "path"
import { projectRoot } from "../../path.js"

const ALLOWED_ROOT = path.resolve(projectRoot)
const TEMP_SCRIPT_DIR = path.join(ALLOWED_ROOT, "temp", "run-command")
const DEFAULT_TIMEOUT = 60000
const MAX_TIMEOUT = 600000
const FORCE_KILL_GRACE_MS = 5000
const MAX_OUTPUT_CHARS = 12000
const IS_WINDOWS = process.platform === "win32"

const OUTPUT_ENCODING = IS_WINDOWS ? "gbk" : "utf-8"
const decoder = new TextDecoder(OUTPUT_ENCODING)
const MULTILINE_COMMAND_RE = /\r?\n/

function truncateCommandResult(result) {
    const text = String(result || "")
    if (text.length <= MAX_OUTPUT_CHARS) return text

    const buildNotice = (omittedChars) =>
        `\n... [输出已截断，省略 ${omittedChars} 字符，总长 ${text.length} 字符，上限 ${MAX_OUTPUT_CHARS} 字符] ...\n`

    let notice = buildNotice(text.length - MAX_OUTPUT_CHARS)
    let keepChars = Math.max(0, MAX_OUTPUT_CHARS - notice.length)
    let headChars = Math.floor(keepChars * 0.45)
    let tailChars = keepChars - headChars

    notice = buildNotice(text.length - headChars - tailChars)
    keepChars = Math.max(0, MAX_OUTPUT_CHARS - notice.length)
    headChars = Math.floor(keepChars * 0.45)
    tailChars = keepChars - headChars

    const tail = tailChars > 0 ? text.slice(-tailChars) : ""
    return `${text.slice(0, headChars)}${notice}${tail}`
}

function getExecutableToken(commandPrefix) {
    const trimmed = commandPrefix.trim()
    if (!trimmed) return ""

    const match = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)
    return match?.[1] || match?.[2] || match?.[3] || ""
}

function getExecutableName(commandPrefix) {
    const executableToken = getExecutableToken(commandPrefix)
    if (!executableToken) return ""
    return path.basename(executableToken).toLowerCase()
}

function isPythonPrefix(commandPrefix) {
    const executableName = getExecutableName(commandPrefix)
    return executableName === "python"
        || executableName === "python.exe"
        || executableName === "py"
        || executableName === "py.exe"
        || /^python\d+(?:\.\d+)?(?:\.exe)?$/.test(executableName)
}

function isNodePrefix(commandPrefix) {
    const executableName = getExecutableName(commandPrefix)
    return executableName === "node" || executableName === "node.exe"
}

function isPowerShellPrefix(commandPrefix) {
    const executableName = getExecutableName(commandPrefix)
    return executableName === "powershell"
        || executableName === "powershell.exe"
        || executableName === "pwsh"
        || executableName === "pwsh.exe"
}

function quotePathForShell(targetPath) {
    if (IS_WINDOWS) {
        return `"${targetPath.replace(/"/g, '""')}"`
    }

    return `'${targetPath.replace(/'/g, `'\\''`)}'`
}

function createTempScript(content, extension) {
    fs.mkdirSync(TEMP_SCRIPT_DIR, { recursive: true })

    const fileName = `run-command-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`
    const filePath = path.join(TEMP_SCRIPT_DIR, fileName)

    fs.writeFileSync(filePath, content, "utf8")

    if (!IS_WINDOWS && extension === ".sh") {
        fs.chmodSync(filePath, 0o755)
    }

    return filePath
}

function tryTransformInterpreterCommand(command, { switchPattern, extension, matchesPrefix, buildCommand }) {
    const pattern = new RegExp(
        `^\\s*(?<prefix>.+?)\\s+${switchPattern}\\s+(?<quote>["'])(?<script>[\\s\\S]*)\\k<quote>\\s*$`,
        "i"
    )
    const match = command.match(pattern)
    if (!match?.groups) return null

    const commandPrefix = match.groups.prefix.trim()
    if (!matchesPrefix(commandPrefix)) return null

    const tempScriptPath = createTempScript(match.groups.script, extension)
    return {
        commandToRun: buildCommand(commandPrefix, tempScriptPath),
        tempScriptPath,
    }
}

function buildShellScriptContent(command) {
    if (IS_WINDOWS) {
        const normalized = command.replace(/\r?\n/g, "\r\n")
        return `@echo off\r\n${normalized}\r\n`
    }

    return `#!/usr/bin/env sh
set -e
${command}
`
}

function prepareCommandExecution(command) {
    if (!MULTILINE_COMMAND_RE.test(command)) {
        return { commandToRun: command, tempScriptPath: null }
    }

    const scriptTransforms = [
        {
            switchPattern: "-c",
            extension: ".py",
            matchesPrefix: isPythonPrefix,
            buildCommand: (commandPrefix, tempScriptPath) => `${commandPrefix} ${quotePathForShell(tempScriptPath)}`,
        },
        {
            switchPattern: "-e",
            extension: ".js",
            matchesPrefix: isNodePrefix,
            buildCommand: (commandPrefix, tempScriptPath) => `${commandPrefix} ${quotePathForShell(tempScriptPath)}`,
        },
        {
            switchPattern: "-Command",
            extension: ".ps1",
            matchesPrefix: isPowerShellPrefix,
            buildCommand: (commandPrefix, tempScriptPath) => `${commandPrefix} -File ${quotePathForShell(tempScriptPath)}`,
        },
    ]

    for (const transform of scriptTransforms) {
        const prepared = tryTransformInterpreterCommand(command, transform)
        if (prepared) {
            return prepared
        }
    }

    const extension = IS_WINDOWS ? ".cmd" : ".sh"
    const tempScriptPath = createTempScript(buildShellScriptContent(command), extension)
    return {
        commandToRun: IS_WINDOWS
            ? quotePathForShell(tempScriptPath)
            : `sh ${quotePathForShell(tempScriptPath)}`,
        tempScriptPath,
    }
}

export class RunCommandTool extends AbstractTool {
    name = "RunCommand"
    description = `在项目目录下执行命令行命令。当前系统 ${IS_WINDOWS ? "Windows" : process.platform}。工作目录 ${ALLOWED_ROOT}。支持任意合法命令，不允许破坏性操作。如需创建或下载临时文件，请放置在项目根目录的 temp 目录下，切勿直接在项目根目录创建文件。输出超过 ${MAX_OUTPUT_CHARS} 字符时会保留开头和结尾并截断中间。`
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
                description: `超时秒数，默认 ${DEFAULT_TIMEOUT / 1000} 秒，最大 ${MAX_TIMEOUT / 1000} 秒。执行下载等耗时操作时可设置为 120~300。`,
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

        let preparedCommand
        try {
            preparedCommand = prepareCommandExecution(command)
        } catch (error) {
            return `执行失败: ${error.message || error}`
        }

        return new Promise((resolve) => {
            const child = spawn(preparedCommand.commandToRun, [], {
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

            const cleanupTempScript = () => {
                if (!preparedCommand?.tempScriptPath) return
                try {
                    if (fs.existsSync(preparedCommand.tempScriptPath)) {
                        fs.unlinkSync(preparedCommand.tempScriptPath)
                    }
                } catch {
                }
            }

            const finish = (message) => {
                if (!settled) {
                    settled = true
                    resolve(truncateCommandResult(message))
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
                cleanupTempScript()

                let output = ""
                if (stdout) output += stdout
                if (stderr) output += (output ? "\n" : "") + `[stderr]\n${stderr}`

                if (timedOut || signal === "SIGTERM" || signal === "SIGKILL") {
                    finish(`命令超时（${commandTimeout / 1000} 秒），已终止。\n${output}`)
                } else if (code !== 0) {
                    finish(`命令执行完成（退出码: ${code}）\n${output || "(无输出)"}`)
                } else {
                    finish(output ? `命令执行成功:\n${output}` : "命令执行成功（无输出）。")
                }
            })

            child.on("error", (err) => {
                clearTimeout(timeoutTimer)
                if (forceKillTimer) clearTimeout(forceKillTimer)
                cleanupTempScript()
                finish(`执行失败: ${err.message}`)
            })
        })
    }
}
