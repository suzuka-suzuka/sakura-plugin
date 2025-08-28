import { AbstractTool } from './AbstractTool.js';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

export class MarkdownTool extends AbstractTool {
    name = 'Card';

    parameters = {
        properties: {
            markdownContent: {
                type: 'string',
                description: '用于最终呈现给用户的、已经组织好的完整Markdown文本。应包含标题、列表、要点等结构化元素'
            },
        },
        required: ['markdownContent'],
    };
    description = '用于以清晰的卡片格式展示总结、分析、报告等最终回答。当用户的指令是要求进行解释、定义、总结、分析、对比、报告、或列出要点时，你应该使用此工具来组织和呈现你的答案。在使用了Search工具获取信息后，通常需要用此工具来回复。'

    func = async function (opts, e) {
        const { markdownContent } = opts;

        if (!markdownContent || markdownContent.trim() === '') {
            return '错误：markdownContent 不能为空。'
        }

        let browser = null;
        try {
            const htmlFragment = marked.parse(markdownContent);

            const fullHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
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
                    </style>
                </head>
                <body>
                    <div id="container">
                        ${htmlFragment}
                    </div>
                </body>
                </html>
            `;

            browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
            
            const containerElement = await page.$('#container');
            if (!containerElement) {
                throw new Error('无法在页面中找到渲染容器。');
            }

            const imageBase64 = await containerElement.screenshot({
                encoding: 'base64'
            });

            const imageBuffer = Buffer.from(imageBase64, 'base64');
            await e.reply(segment.image(imageBuffer));
            return '任务已通过工具成功执行并完成，最终的卡片格式已以图片的方式发送，你只需简短地用一句话回复要点即可';

        } catch (error) {
            console.error('将 Markdown 转换为图片时出错：', error);
            return `发生意外错误：${error.message}`
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    };
}