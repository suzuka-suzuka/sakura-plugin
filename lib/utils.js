import { _path } from "./path.js";
import sharp from "sharp";
import { marked } from "marked";
import puppeteer from "puppeteer";
import { parseAtMessage } from "./AIUtils/messaging.js";
import Setting from "./setting.js";

/**
 * 将图片 URL 转换为 base64 格式（自动将 GIF 转为 PNG）
 * @param {string} imageUrl - 图片 URL
 * @returns {Promise<object|null>} { base64, mimeType } 或 null
 */
export async function urlToBase64(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      logger.warn(`下载图片失败: ${response.status}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    let mimeType = response.headers.get("content-type") || "image/jpeg";

    if (mimeType === "image/gif") {
      buffer = await sharp(buffer).toFormat("png").toBuffer();
      mimeType = "image/png";
    }

    const base64 = buffer.toString("base64");
    return { base64, mimeType };
  } catch (error) {
    logger.error(`转换图片为 base64 失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取消息中的图片
 * @param {object} e - 消息事件对象
 * @param {boolean} getAvatar - 是否获取头像
 * @param {boolean} toBase64 - 是否转换为 base64
 * @returns {Promise<Array|null>} 图片 URL 数组 或 base64 对象数组
 */
export async function getImg(e, getAvatar = false, toBase64 = false) {
  if (!e.message || !Array.isArray(e.message)) {
    return null;
  }

  let imageUrls = [];

  const directImageUrls = e.message
    .filter((segment) => segment.type === "image" && segment.data?.url)
    .map((segment) => segment.data.url);

  if (directImageUrls.length > 0) {
    imageUrls = directImageUrls;
  } else if (e.reply_id) {
    const sourceMessageData = await e.getReplyMsg();
    const messageSegments = sourceMessageData?.message;

    if (messageSegments && Array.isArray(messageSegments)) {
      const repliedImageUrls = messageSegments
        .filter((segment) => segment.type === "image" && segment.data?.url)
        .map((segment) => segment.data.url);

      if (repliedImageUrls.length > 0) {
        imageUrls = repliedImageUrls;
      }
    }
  }

  if (imageUrls.length === 0 && getAvatar) {
    const atMsg = e.at;
    if (atMsg) {
      imageUrls = [`https://q1.qlogo.cn/g?b=qq&s=640&nk=${atMsg}`];
    }
  }

  if (imageUrls.length === 0) {
    return null;
  }

  e.img = imageUrls;

  if (toBase64) {
    const base64Results = await Promise.all(
      imageUrls.map((url) => urlToBase64(url))
    );
    return base64Results.filter(Boolean);
  }

  return imageUrls;
}

export async function randomReact(e) {
  const emojiList = [
    { id: "424", name: "续标识" },
    { id: "66", name: "爱心" },
    { id: "318", name: "崇拜" },
    { id: "10024", name: "闪光" },
    { id: "319", name: "比心" },
    { id: "269", name: "暗中观察" },
    { id: "38", name: "敲打" },
    { id: "181", name: "戳一戳" },
    { id: "351", name: "敲打" },
    { id: "350", name: "贴贴" },
    { id: "21", name: "可爱" },
    { id: "34", name: "晕" },
    { id: "270", name: "emm" },
    { id: "352", name: "咦" },
    { id: "49", name: "拥抱" },
    { id: "128513", name: "😁 呲牙" },
    { id: "128514", name: "😂 激动" },
    { id: "128516", name: "😄 高兴" },
    { id: "128522", name: "😊 嘿嘿" },
    { id: "128524", name: "😌 羞涩" },
    { id: "128527", name: "😏 哼哼" },
    { id: "128530", name: "😒 不屑" },
    { id: "128531", name: "😓 汗" },
    { id: "128532", name: "😔 失落" },
    { id: "128536", name: "😘 飞吻" },
    { id: "128538", name: "😚 亲亲" },
    { id: "128540", name: "😜 淘气" },
    { id: "128541", name: "😝 吐舌" },
    { id: "128557", name: "😭 大哭" },
    { id: "128560", name: "😰 紧张" },
    { id: "128563", name: "😳 瞪眼" },
  ];

  const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];
  const emojiId = randomEmoji.id;

  await e.react(emojiId);
}

/**
 * 判断文本是否包含明显的 Markdown 语法或 LaTeX 公式
 * 使用更严谨的正则以避免日常对话产生误判
 * @param {string} text
 * @returns {boolean}
 */
export function isMdText(text) {
  // 匹配多行代码块: ```language\n...```
  const hasCodeBlock = /```[a-zA-Z0-9]*\n[\s\S]*?```/m.test(text);

  // 匹配表格 (至少有表头和分隔线)
  const hasTable = /\|.*\|\n\|[\s:-]+\|/m.test(text);

  // 匹配行首的标题 (必须有空格如 "# 标题")
  const hasHeading = /^#{1,6}\s+.+/m.test(text);

  // 匹配有序列表 (必须带有行首数字和小数点以及空格 "1. ")
  const hasOrderedList = /^\s*\d+\.\s+.+/m.test(text);

  // 匹配无序列表 (必须带有行首的 "* " 或 "- ")
  const hasUnorderedList = /^\s*[-*]\s+.+/m.test(text);

  // 匹配引用块 (行首 "> ")
  const hasBlockquote = /^\s*>\s+.+/m.test(text);

  // 匹配粗体或粗斜体 (如 **文本** 或 ***文本***)，要求其内部有实际内容
  const hasBold = /(\*\*|__)[^\s*].*?[^\s*]\1/.test(text);

  // 处理 LaTeX 公式：行内 $公式$ 或 块级 $$公式$$ (独立一行)
  const hasLatex = /\$\$.*?\$\$|\$[^\s$].*?[^\s$]\$/m.test(text);

  // 匹配 Mermaid 图表
  const hasMermaid = /```mermaid\n[\s\S]*?```/m.test(text);

  return hasCodeBlock || hasTable || hasHeading || hasOrderedList || hasUnorderedList || hasBlockquote || hasBold || hasLatex || hasMermaid;
}

/**
 * 通过三层合并转发发送 Markdown 消息
 * （经测试：第二层 markdown 会失败，必须放在第三层才能成功）
 *
 * @param {object} e - 消息事件对象
 * @param {string} markdownContent - Markdown 文本内容
 * @param {object} [opts] - 可选项
 * @param {string} [opts.source]  - 转发卡片来源标注，默认 "消息"
 * @param {string} [opts.prompt]  - 转发卡片预览文字，默认 "点击查看详情"
 * @param {string} [opts.outerNickname] - 外层节点显示名，默认触发用户昵称
 * @param {string} [opts.innerNickname] - 内层节点显示名，同上
 * @returns {Promise<object|null>} sendForwardMsg 的返回值
 */
export async function sendMarkdownMsg(e, markdownContent, opts = {}) {
  const userId = e.self_id;
  const defaultNickname = bot.nickname || String(e.self_id);

  const {
    source = "Markdown消息",
    prompt = "喵喵喵",
    outerNickname = defaultNickname,
    innerNickname = defaultNickname,
    fallbackContent = null, // 可选：在第一层追加一个降级节点（图片或纯文本），方便不支持三层的客户端直接查看
  } = opts;

  // 第三层：真正的 markdown 节点
  const layer3_node = {
    type: "node",
    data: {
      user_id: userId,
      nickname: innerNickname,
      content: [
        { type: "markdown", data: { content: markdownContent } },
      ],
    },
  };

  // 第一层节点：内容为包裹 markdown 的第三层节点
  const layer1_nodes = [
    {
      user_id: userId,
      nickname: outerNickname,
      content: [layer3_node],
    },
  ];

  // 若传入降级内容，在第一层追加第二个节点（手机不支持三层时可直接看到图片/文本）
  if (fallbackContent && Array.isArray(fallbackContent) && fallbackContent.length > 0) {
    layer1_nodes.push({
      user_id: userId,
      nickname: outerNickname,
      content: fallbackContent,
    });
  }

  try {
    const forwardOpts = {
      source,
      prompt,
      news: [{ text: markdownContent }]
    };
    const result = await e.sendForwardMsg(layer1_nodes, forwardOpts);
    // 移除这里的重复警告日志，交由主要调用方进行降级或提醒
    // if (!result || !result.message_id) {
    //   logger.warn("[sendMarkdownMsg] 发送可能失败，result:", result);
    // }
    return result;
  } catch (err) {
    logger.error(`[sendMarkdownMsg] 发送失败: ${err.message}`);
    return null;
  }
}

/**
 * 统一智能回复：自动按内容长度与 Markdown 特征选择最佳发送方式
 * 
 * 修改后的逻辑：
 * - 过滤掉 `<draw>...</draw>` 标签的文本
 * - ≥300 字 + Markdown → Puppeteer 渲染图片作为降级节点 + 第三层嵌套 Markdown
 * - 否则走 textReplyFn / e.reply 原样发送
 *
 * @param {object}   e              - 消息事件对象
 * @param {string}   text           - 回复文本
 * @param {object}   [opts]
 * @param {number}   [opts.quote=0]         - 引用参数
 * @param {boolean}  [opts.at=false]        - 是否 @
 * @param {Function} [opts.textReplyFn]     - 自定义纯文本发送函数 async (text) => {}
 *                                            不传则默认 e.reply(parseAtMessage(text), quote, at)
 * @returns {Promise<any>}
 */
export async function smartReplyMsg(e, text, opts = {}) {
  if (!text) return;

  // 过滤掉绘画标签的文本，确保最终判断和发送的是清理后的文本
  text = text.replace(/<draw>([\s\S]*?)<\/draw>/gi, "").trim();

  // 修复带有空格导致渲染失败的 Markdown 粗体标签，例如: ** "绿色AI" ** -> **"绿色AI"**
  // 并且在外部强制填充空格，以兼容 marked 等解析器在中文语境下遭遇紧贴的字母/标点符号导致忽略加粗的问题
  text = text.replace(/\*\*(.*?)\*\*/g, (match, inner) => ` **${inner.trim()}** `);

  if (!text) return;

  const { quote = 0, at = false, textReplyFn = null } = opts;
  const botname = Setting.getConfig("bot")?.botname || "";

  const doTextReply = async (t) => {
    if (textReplyFn) return await textReplyFn(t);
    return await e.reply(parseAtMessage(t), quote, at);
  };

  if (isMdText(text)) {
    let imgBuffer = null;
    try {
      let fallbackContent = [];
      imgBuffer = await renderMarkdownToImage(text).catch(() => null);
      if (imgBuffer) {
        fallbackContent.push(segment.image(imgBuffer));
      } else {
        fallbackContent.push({ type: "text", data: { text: text } });
      }

      const result = await sendMarkdownMsg(e, text, {
        source: botname ? `${botname}回复` : "消息",
        fallbackContent,
      });
      if (result && result.message_id) return result;
      logger.warn("[smartReplyMsg] 嵌套转发失败，降级为发送图片");
    } catch (err) {
      logger.error(`[smartReplyMsg] 嵌套转发出错: ${err.message}，降级为发送图片`);
    }

    if (imgBuffer) {
      return await e.reply(segment.image(imgBuffer), quote, at);
    }
  }

  return await doTextReply(text);
}

/**
 * 使用 Puppeteer + marked 将 Markdown 渲染为图片 Buffer
 * @param {string} markdownText
 * @returns {Promise<Buffer|null>}
 */
export async function renderMarkdownToImage(markdownText) {
  let browser = null;
  try {
    // 保护数学公式不被 marked 破坏
    const mathBlocks = [];
    markdownText = markdownText.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
      mathBlocks.push(match);
      return `@@@MATH_BLOCK_${mathBlocks.length - 1}@@@`;
    });

    const inlineMath = [];
    markdownText = markdownText.replace(/\$([^$\n]+?)\$/g, (match) => {
      inlineMath.push(match);
      return `@@@INLINE_MATH_${inlineMath.length - 1}@@@`;
    });

    let htmlBody = marked.parse(markdownText);

    const escapeHtml = (unsafe) => {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    // 恢复数学公式
    mathBlocks.forEach((match, i) => {
      htmlBody = htmlBody.replace(`@@@MATH_BLOCK_${i}@@@`, () => escapeHtml(match));
    });
    inlineMath.forEach((match, i) => {
      htmlBody = htmlBody.replace(`@@@INLINE_MATH_${i}@@@`, () => escapeHtml(match));
    });

    const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script>
window.mathjaxReady = false;
MathJax = {
  tex: {
    inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
    displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
    processEscapes: true
  },
  svg: {
    fontCache: 'global'
  },
  startup: {
    pageReady: function() {
      return MathJax.startup.defaultPageReady().then(function() {
        window.mathjaxReady = true;
      });
    }
  }
};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
  window.mermaid = mermaid;
</script>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 30px 40px;
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 32px; /* 再次调大字体 */
    line-height: 1.8;
    max-width: 1080px; /* 限制大宽度，迫使图片在缩放时文字更大 */
  }
  h1, h2, h3, h4, h5, h6 {
    color: #cba6f7;
    margin: 0.8em 0 0.4em;
    border-bottom: 2px solid #313244;
    padding-bottom: 6px;
  }
  p { margin: 0.5em 0; }
  code {
    background: #313244;
    color: #a6e3a1;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.9em;
  }
  pre {
    background: #181825;
    border-radius: 10px;
    padding: 16px 20px;
    overflow-x: auto;
    margin: 0.8em 0;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }
  pre code {
    background: none;
    padding: 0;
    color: #a6e3a1;
    font-size: 0.9em;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }
  th {
    background: #313244;
    color: #89b4fa;
    padding: 10px 16px;
    border: 1px solid #45475a;
    text-align: left;
  }
  td {
    padding: 10px 16px;
    border: 1px solid #313244;
  }
  tr:nth-child(even) td { background: #181825; }
  blockquote {
    border-left: 6px solid #cba6f7;
    margin: 0.6em 0;
    padding: 6px 16px;
    color: #a6adc8;
    background: #181825;
    border-radius: 0 8px 8px 0;
  }
  ul, ol { padding-left: 1.8em; margin: 0.5em 0; }
  li { margin: 4px 0; }
  a { color: #89b4fa; text-decoration: none; }
  strong { color: #f38ba8; }
  hr { border: none; border-top: 2px solid #45475a; margin: 1em 0; }
  mjx-container {
    color: #cdd6f4;
  }
  /* 允许嵌套标签继承自定义颜色，防止被全局颜色强制覆盖 */
  span[style*="color"], font[color] {
    color: inherit;
  }
  /* Mermaid 样式调整以防溢出 */
  .mermaid {
    background: #181825;
    padding: 20px;
    border-radius: 10px;
    margin: 1em 0;
    overflow-x: auto;
    display: flex;
    justify-content: center;
  }
</style></head>
<body id="md-body">${htmlBody}</body></html>`;

    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    // 使用 deviceScaleFactor 提高图片物理分辨率，提升清晰度
    await page.setViewport({ width: 1080, height: 100, deviceScaleFactor: 2 });
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    // 等待网页完全加载、MathJax 渲染完成、且所有 mermaid 图表渲染完成
    await page.evaluate(async () => {
      // 动态将语言标为 mermaid 的代码块转换成 mermaid div，供 mermaid 初始化时自动渲染
      document.querySelectorAll('pre code.language-mermaid').forEach(el => {
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = el.textContent;
        el.parentElement.replaceWith(div);
      });
      if (window.mermaid) {
        await window.mermaid.run();
      }
    });

    await page.waitForFunction('window.mathjaxReady === true', { timeout: 15000 }).catch(() => {
      logger.warn('MathJax rendering timed out or failed to initialize.');
    });

    let currentWidth = 1080;
    // 按内容实际高度截图，避免留白
    let bodyHeight = await page.evaluate(() => document.body.scrollHeight);

    // 动态调整宽度以尽量确保高宽比不超过 2:1
    if (bodyHeight > currentWidth * 2) {
      let area = currentWidth * bodyHeight;
      let targetWidth = Math.ceil(Math.sqrt(area / 2));

      // 限制最大宽度，防止手机端缩放后文字实在太小
      // 最宽可以允许到 1080*2，超过的就算了，也能保证适度
      targetWidth = Math.min(targetWidth, 1080 * 2);

      if (targetWidth > currentWidth) {
        currentWidth = targetWidth;
        await page.evaluate((w) => {
          document.body.style.maxWidth = `${w}px`;
        }, currentWidth);

        await page.setViewport({ width: currentWidth, height: 100, deviceScaleFactor: 2 });
        // 留时间给浏览器重排排版
        await new Promise(r => setTimeout(r, 100));
        bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      }
    }

    await page.setViewport({ width: currentWidth, height: Math.ceil(bodyHeight), deviceScaleFactor: 2 });
    const imageBuffer = await page.screenshot({ fullPage: true, type: 'png' }); // 使用 PNG 无损画质
    return imageBuffer;
  } catch (err) {
    logger.error(`[renderMarkdownToImage] 渲染失败: ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => { });
  }
}
