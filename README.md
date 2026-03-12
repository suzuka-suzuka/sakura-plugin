# Sakura-Plugin

## 🚀 安装指南

1.  **进入 Sakura 根目录**
    打开终端，并确保你的当前路径在 Sakura 的根目录下。

2.  **克隆插件仓库**
    推荐使用 `git` 进行安装，方便后续更新。

    ```bash
    git clone --depth=1 -b sakura https://github.com/suzuka-suzuka/sakura-plugin.git ./plugins/sakura-plugin/
    ```

3.  **安装依赖**
    进入插件目录并安装所需依赖。
    ```bash
    cd ./plugins/sakura-plugin
    pnpm install
    ```
    _如果你没有 `pnpm`，请先安装：`npm install -g pnpm`_
    
## 📦 额外依赖 (MCP相关)
部分 MCP 功能依赖于外部扩展，使用对应工具前请确保已经安装了相关的支持：
* **Fetch Server**：
`pip install mcp-server-fetch` (如果使用了隔离的虚拟环境，请将其安装在机器人运行的全局 Python 环境下)

* **GitHub MCP Server**：
  前往 [github-mcp-server Releases](https://github.com/github/github-mcp-server/releases/latest) 页面下载对应平台的二进制文件，并将其放置在插件目录的 `github-mcp-server/` 文件夹下：
  - **Windows**：下载 `github-mcp-server_windows_amd64.zip`，解压后将 `github-mcp-server.exe` 放入 `plugins/sakura-plugin/github-mcp-server/`
  - **Linux**：下载 `github-mcp-server_linux_amd64.tar.gz`，解压后将 `github-mcp-server` 放入 `plugins/sakura-plugin/github-mcp-server/`，并执行 `chmod +x github-mcp-server` 赋予可执行权限

## 💬 支持与交流

如果你在使用过程中遇到任何问题，或者有好的建议，欢迎通过以下方式联系：

-   **提交 Issue**: [GitHub Issues](https://github.com/suzuka-suzuka/sakura-plugin/issues)
-   **加入 QQ 交流群**: 1058044133 (欢迎来群里交流！)