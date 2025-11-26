import { AbstractTool } from "./AbstractTool.js"
import { marked } from "marked"
import puppeteer from "puppeteer"

export class MarkdownTool extends AbstractTool {
  name = "Card"

  parameters = {
    properties: {
      markdownContent: {
        type: "string",
        description:
          "用于最终呈现给用户的、已经组织好的完整Markdown文本。应包含标题、列表、要点等结构化元素",
      },
    },
    required: ["markdownContent"],
  }
  description =
    "仅当用户明确要求生成“卡片”、“报告”或回答内容非常长且包含复杂结构（如表格、多级列表）时使用此工具。用于将Markdown文本渲染为图片发送。对于简短的对话、简单的解释或不需要格式化的文本，请直接回复文本，不要使用此工具。"

  func = async function (opts, e) {
    const { markdownContent } = opts

    if (!markdownContent || markdownContent.trim() === "") {
      return "错误：markdownContent 不能为空。"
    }

    let browser = null
    try {
      const mathExpressions = []
      let protectedContent = markdownContent.replace(/\$\$([\s\S]+?)\$\$/g, match => {
        mathExpressions.push(match)
        return `MATHBLOCK${mathExpressions.length - 1}END`
      })
      protectedContent = protectedContent.replace(/\$([^$\n]+?)\$/g, match => {
        mathExpressions.push(match)
        return `MATHINLINE${mathExpressions.length - 1}END`
      })

      let htmlFragment = marked.parse(protectedContent)

      mathExpressions.forEach((expr, index) => {
        htmlFragment = htmlFragment.replace(`MATHBLOCK${index}END`, expr)
        htmlFragment = htmlFragment.replace(`MATHINLINE${index}END`, expr)
      })

      const fullHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <!-- 引入 KaTeX CSS -->
                    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
                    <style>
                        body {
                            margin: 0;
                            padding: 0;
                            display: flex;
                            justify-content: center;
                            align-items: flex-start;
                            background-color: #ffffff;
                        }
                        #container {
                            padding: 20px;
                            background-color: #ffffff;
                            border: 1px solid #d1d5da;
                            border-radius: 6px;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                            font-size: 16px;
                            line-height: 1.5;
                            color: #24292e;
                            max-width: 800px;
                            display: inline-block;
                            margin: 20px;
                        }
                        pre {
                            background-color: #f0f0f0;
                            padding: 10px;
                            border-radius: 4px;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                        }
                        blockquote {
                            border-left: 4px solid #d1d5da;
                            padding-left: 15px;
                            color: #586069;
                            margin-left: 0;
                        }
                        table {
                            border-collapse: collapse;
                            width: 100%;
                            margin-top: 1em;
                            margin-bottom: 1em;
                        }
                        th, td {
                            border: 1px solid #d1d5da;
                            padding: 8px 12px;
                            text-align: left;
                        }
                        thead {
                           background-color: #f1f1f1;
                        }
                        /* 调整公式字体大小 */
                        .katex { font-size: 1.1em; }
                    </style>
                </head>
                <body>
                    <div id="container">
                        ${htmlFragment}
                    </div>
                    
                    <!-- 引入 KaTeX JS 和 自动渲染脚本 -->
                    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
                    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
                    <script>
                        document.addEventListener("DOMContentLoaded", function() {
                            renderMathInElement(document.body, {
                                delimiters: [
                                    {left: '$$', right: '$$', display: true},
                                    {left: '$', right: '$', display: false}
                                ],
                                throwOnError : false
                            });
                        });
                    </script>
                </body>
                </html>
            `

      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
      const page = await browser.newPage()

      await page.setContent(fullHtml, { waitUntil: "networkidle0" })

      const containerElement = await page.$("#container")
      if (!containerElement) {
        throw new Error("无法在页面中找到渲染容器。")
      }

      const imageBase64 = await containerElement.screenshot({
        encoding: "base64",
      })

      const imageBuffer = Buffer.from(imageBase64, "base64")
      await e.reply(segment.image(imageBuffer))
      return "任务已通过工具成功执行并完成，最终的卡片格式已以图片的方式发送，你只需简短地用一句话回复要点即可"
    } catch (error) {
      console.error("将 Markdown 转换为图片时出错：", error)
      return `发生意外错误：${error.message}`
    } finally {
      if (browser) {
        await browser.close()
      }
    }
  }
}
