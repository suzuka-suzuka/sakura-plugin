import { AbstractTool } from "./AbstractTool.js";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

const PYTHON_TIMEOUT = 15000; // 15秒超时
const MAX_OUTPUT_LENGTH = 4000; // 最大输出字符数
const IS_WINDOWS = process.platform === "win32";

// 沙箱头部：限制危险模块访问
const SANDBOX_HEADER = `
import sys
import builtins

# 禁止导入的危险模块
_BLOCKED_MODULES = {
    'subprocess', 'multiprocessing', 'socket', 'urllib', 'http',
    'ftplib', 'smtplib', 'telnetlib', 'xmlrpc', 'ctypes',
    'mmap', 'winreg', 'winsound', '_winapi',
}

_original_import = builtins.__import__

def _safe_import(name, *args, **kwargs):
    base = name.split('.')[0]
    if base in _BLOCKED_MODULES:
        raise ImportError(f"[沙箱] 模块 '{name}' 已被禁用")
    return _original_import(name, *args, **kwargs)

builtins.__import__ = _safe_import

# 限制 open() 只能访问当前目录
import os as _os
_SANDBOX_DIR = _os.getcwd()
_original_open = builtins.open

def _safe_open(file, mode='r', *args, **kwargs):
    abs_path = _os.path.abspath(str(file))
    if not abs_path.startswith(_SANDBOX_DIR):
        raise PermissionError(f"[沙箱] 禁止访问沙箱外路径: {file}")
    return _original_open(file, mode, *args, **kwargs)

builtins.open = _safe_open

# 用户代码从此处开始
`.trimStart();

export class RunPythonTool extends AbstractTool {
    name = "RunPython";
    description = "在沙箱环境中执行 Python 代码并返回输出结果。沙箱限制：禁止网络请求（socket/urllib/http）、禁止子进程、禁止访问沙箱目录以外的文件。适合数学计算、算法演示、数据处理、文本操作等纯计算任务。超时 15 秒。";
    parameters = {
        properties: {
            code: {
                type: "string",
                description: "要执行的 Python 代码",
            },
            packages: {
                type: "string",
                description: "需要临时安装的第三方包，用逗号分隔，如 'numpy,requests'。注意 requests 等网络包在沙箱中无法发出实际请求。",
            },
        },
        required: ["code"],
    };

    func = async function (opts) {
        const { code, packages } = opts;

        if (!code || code.trim() === "") {
            return "错误：必须提供要执行的 Python 代码。";
        }

        // 检查 Python 是否可用
        const pythonCmd = await detectPython();
        if (!pythonCmd) {
            return "错误：未检测到 Python 环境，请确保系统安装了 Python 3。";
        }

        // 创建沙箱临时目录
        const sandboxId = crypto.randomBytes(8).toString("hex");
        const sandboxDir = path.join(os.tmpdir(), `py_sandbox_${sandboxId}`);

        try {
            await fs.mkdir(sandboxDir, { recursive: true });

            // 如果需要安装包
            if (packages && packages.trim()) {
                const pkgList = packages.split(",").map(p => p.trim()).filter(Boolean);
                const installResult = await installPackages(pythonCmd, pkgList, sandboxDir);
                if (installResult.error) {
                    return `安装包失败: ${installResult.error}`;
                }
            }

            // 写入沙箱代码文件
            const scriptPath = path.join(sandboxDir, "script.py");
            const fullCode = SANDBOX_HEADER + "\n" + code;
            await fs.writeFile(scriptPath, fullCode, "utf-8");

            // 执行代码
            const result = await runPythonScript(pythonCmd, scriptPath, sandboxDir);
            return result;

        } catch (err) {
            return `沙箱执行失败: ${err.message}`;
        } finally {
            // 清理沙箱目录
            try {
                await fs.rm(sandboxDir, { recursive: true, force: true });
            } catch { }
        }
    };
}

/**
 * 检测可用的 Python 命令
 */
async function detectPython() {
    const candidates = IS_WINDOWS
        ? ["python", "python3", "py"]
        : ["python3", "python"];

    for (const cmd of candidates) {
        try {
            const version = await execAsync(`${cmd} --version`);
            if (version.stdout.includes("Python 3") || version.stderr.includes("Python 3")) {
                return cmd;
            }
        } catch { }
    }
    return null;
}

/**
 * 安装 pip 包到临时目录（--target 隔离）
 */
async function installPackages(pythonCmd, pkgList, targetDir) {
    const pkgTarget = path.join(targetDir, "site-packages");
    await fs.mkdir(pkgTarget, { recursive: true });

    const pkgArgs = pkgList.map(p => `"${p}"`).join(" ");
    const installCmd = `${pythonCmd} -m pip install ${pkgArgs} --target "${pkgTarget}" --quiet --no-warn-script-location`;

    try {
        await execAsync(installCmd, { timeout: 30000 });
        return { error: null, target: pkgTarget };
    } catch (err) {
        return { error: err.stderr || err.message };
    }
}

/**
 * 实际执行 Python 脚本
 */
function runPythonScript(pythonCmd, scriptPath, sandboxDir) {
    return new Promise((resolve) => {
        // 注入包路径
        const pkgTarget = path.join(sandboxDir, "site-packages");
        const env = {
            ...process.env,
            PYTHONPATH: pkgTarget,
            PYTHONDONTWRITEBYTECODE: "1",
            PYTHONIOENCODING: "utf-8",
            // 移除代理等网络相关变量，进一步隔离
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            http_proxy: "",
            https_proxy: "",
        };

        const child = exec(
            `${pythonCmd} -u "${scriptPath}"`,
            {
                cwd: sandboxDir,
                timeout: PYTHON_TIMEOUT,
                maxBuffer: 1024 * 512,
                encoding: "buffer",
                env,
            }
        );

        const stdoutChunks = [];
        const stderrChunks = [];

        child.stdout.on("data", chunk => stdoutChunks.push(chunk));
        child.stderr.on("data", chunk => stderrChunks.push(chunk));

        child.on("close", (code, signal) => {
            const decoder = new TextDecoder("utf-8");
            const stdout = decoder.decode(Buffer.concat(stdoutChunks)).trimEnd();
            // 过滤掉沙箱自身的 stderr（如 UserWarning 等），只留真正的错误
            const stderr = decoder.decode(Buffer.concat(stderrChunks))
                .trimEnd()
                // 去掉 traceback 中指向沙箱 header 的偏移，仅保留用户代码部分
                .replace(/File ".*?script\.py", line (\d+)/g, (_, ln) => {
                    const userLine = parseInt(ln) - SANDBOX_HEADER.split("\n").length;
                    return `Line ${Math.max(1, userLine)}`;
                });

            let output = "";
            if (stdout) output += stdout;
            if (stderr) output += (output ? "\n\n" : "") + `[错误信息]\n${stderr}`;

            if (!output) output = "(无输出)";

            if (output.length > MAX_OUTPUT_LENGTH) {
                output = output.substring(0, MAX_OUTPUT_LENGTH) +
                    `\n\n... 输出过长已截断（共 ${output.length} 字符）`;
            }

            if (signal === "SIGTERM" || signal === "SIGKILL") {
                resolve(`⏱️ 执行超时（${PYTHON_TIMEOUT / 1000}秒），已强制终止。\n${output}`);
            } else if (code !== 0) {
                resolve(`❌ 执行出错（退出码 ${code}）:\n${output}`);
            } else {
                resolve(`✅ 执行成功:\n${stdout || "(无输出)"}`);
            }
        });

        child.on("error", err => {
            resolve(`执行失败: ${err.message}`);
        });
    });
}

/**
 * Promise 化的 exec
 */
function execAsync(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        exec(cmd, { encoding: "utf-8", ...opts }, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}
