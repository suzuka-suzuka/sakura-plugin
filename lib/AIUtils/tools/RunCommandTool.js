import { AbstractTool } from "./AbstractTool.js"
import { exec } from "child_process"
import path from "path"

const ALLOWED_ROOT = path.resolve(process.cwd())
const DEFAULT_TIMEOUT = 60000  // 默认 60 秒
const MAX_TIMEOUT = 600000     // 最长允许 10 分钟
const MAX_OUTPUT_LENGTH = 5000 // 最大输出字符数
const IS_WINDOWS = process.platform === "win32"

// Windows 输出通常是 GBK，Linux/Mac 是 UTF-8
const OUTPUT_ENCODING = IS_WINDOWS ? "gbk" : "utf-8"
const decoder = new TextDecoder(OUTPUT_ENCODING)

// 危险命令黑名单
const BLOCKED_COMMANDS = [
    /\brm\s+-rf\s+[\/\\]/i,          // rm -rf /
    /\bformat\b/i,                    // format
    /\bdel\s+\/[sфq]/i,              // del /s /q（批量删除）
    /\brmdir\s+\/s\b/i,              // rmdir /s（递归删除）
    /\breg\s+(delete|add)\b/i,       // 注册表操作
    /\bshutdown\b/i,                  // 关机
    /\brestart\b/i,                   // 重启
    /\bnet\s+user\b/i,               // 用户管理
    /\btaskkill\b/i,                  // 杀进程
    /\bnpm\s+(publish|unpublish)\b/i, // npm 发布
    /\bsudo\s+rm\b/i,                // sudo rm
    /\bmkfs\b/i,                      // 格式化磁盘
    /\bdd\s+if=/i,                    // dd 写盘
    /\bcurl\b.*\|\s*(bash|sh)\b/i,   // 管道执行远程脚本
    /\bwget\b.*\|\s*(bash|sh)\b/i,   // 管道执行远程脚本
]

export class RunCommandTool extends AbstractTool {
    name = "RunCommand"
    description = `在项目目录下执行命令行命令。当前系统: ${IS_WINDOWS ? "Windows" : process.platform}。工作目录: ${ALLOWED_ROOT}。可以执行任意合法命令（npm、pnpm、node、git、ls/dir、ping 等），禁止删除系统文件、关机、注册表操作、用户管理等破坏性操作。默认超时 ${DEFAULT_TIMEOUT / 1000} 秒，可通过 timeout 参数指定（最长 ${MAX_TIMEOUT / 1000} 秒），对于 pip install、npm install、文件下载等耗时操作请适当加大。`
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
                description: `超时秒数，默认 ${DEFAULT_TIMEOUT / 1000} 秒，最大 ${MAX_TIMEOUT / 1000} 秒。pip install、npm install、文件下载等耗时操作建议设为 120~300。`,
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

        // 仅检查黑名单
        for (const pattern of BLOCKED_COMMANDS) {
            if (pattern.test(command)) {
                return "错误：命令包含禁止的危险操作，已被拦截。"
            }
        }

        // 解析工作目录
        const workDir = path.resolve(ALLOWED_ROOT, cwd)
        if (!workDir.startsWith(ALLOWED_ROOT)) {
            return "错误：工作目录必须在项目根目录内。"
        }

        return new Promise((resolve) => {
            const child = exec(
                command,
                {
                    cwd: workDir,
                    timeout: commandTimeout,
                    maxBuffer: 1024 * 1024,
                    encoding: "buffer", // buffer 模式，自行处理编码，解决 Windows GBK 乱码
                    shell: true,
                    env: { ...process.env, PAGER: "cat" },
                }
            )

            const stdoutChunks = []
            const stderrChunks = []

            child.stdout.on("data", (chunk) => stdoutChunks.push(chunk))
            child.stderr.on("data", (chunk) => stderrChunks.push(chunk))

            child.on("close", (code, signal) => {
                const stdout = decoder.decode(Buffer.concat(stdoutChunks)).trimEnd()
                const stderr = decoder.decode(Buffer.concat(stderrChunks)).trimEnd()

                let output = ""
                if (stdout) output += stdout
                if (stderr) output += (output ? "\n" : "") + `[stderr]\n${stderr}`

                // 截断过长输出
                if (output.length > MAX_OUTPUT_LENGTH) {
                    output =
                        output.substring(0, MAX_OUTPUT_LENGTH) +
                        `\n\n... 输出过长已截断（共 ${output.length} 字符）`
                }

                if (signal === "SIGTERM" || signal === "SIGKILL") {
                    resolve(`命令超时（${commandTimeout / 1000}秒），已终止。\n${output}`)
                } else if (code !== 0) {
                    resolve(`命令执行完毕（退出码: ${code}）\n${output || "(无输出)"}`)
                } else {
                    resolve(output ? `命令执行成功:\n${output}` : "命令执行成功（无输出）。")
                }
            })

            child.on("error", (err) => {
                resolve(`执行失败: ${err.message}`)
            })
        })
    }
}
