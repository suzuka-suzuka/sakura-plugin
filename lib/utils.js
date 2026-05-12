import { _path } from "./path.js";
import sharp from "sharp";
import { marked } from "marked";
import puppeteer from "puppeteer";
import { remark } from "remark";
import stripMarkdown from "strip-markdown";
import { parseAtMessage } from "./AIUtils/messaging.js";
import Setting from "./setting.js";

const DEFAULT_MARKDOWN_PLAIN_TEXT_LIMIT = 300;
const DEFAULT_MARKDOWN_SPLIT_IMAGE_LIMIT = 0;

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
  const hasCodeBlock = /```[a-zA-Z0-9]*\n[\s\S]*?```/m.test(text);

  const hasTable = /\|.*\|\n\|[\s:-]+\|/m.test(text);

  const hasHeading = /^#{1,6}\s+.+/m.test(text);

  const hasOrderedList = /^\s*\d+\.\s+.+/m.test(text);

  const hasUnorderedList = /^\s*[-*]\s+.+/m.test(text);

  const hasBlockquote = /^\s*>\s+.+/m.test(text);

  const hasBold = /(\*\*|__)[^\s*].*?[^\s*]\1/.test(text);

  const hasLatex = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/.test(text);

  const hasMermaid = /```mermaid\n[\s\S]*?```/m.test(text);

  return hasCodeBlock || hasTable || hasHeading || hasOrderedList || hasUnorderedList || hasBlockquote || hasBold || hasLatex || hasMermaid;
}

export async function stripMarkdownToPlainText(markdownText) {
  try {
    const file = await remark().use(stripMarkdown).process(markdownText);
    return String(file)
      .replace(/\r\n/g, "\n")
      .replace(/[^\S\r\n]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (err) {
    logger.warn(`[stripMarkdownToPlainText] failed to strip markdown: ${err.message}`);
    return markdownText.trim();
  }
}

function getMarkdownDisplayLength(markdownText) {
  return String(markdownText || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/~~~[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`#>|-]/g, "")
    .replace(/\s+/g, "")
    .length;
}

function isTableDelimiterLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isHeadingLine(line) {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function isListItemLine(line) {
  return /^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function findPreviousNonEmptyLine(lines, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].trim()) return lines[i];
  }
  return "";
}

function findNextNonEmptyLine(lines, index) {
  for (let i = index; i < lines.length; i++) {
    if (lines[i].trim()) return lines[i];
  }
  return "";
}

function findFenceRanges(lines) {
  const ranges = [];
  let start = -1;
  let marker = "";

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*(```|~~~)/);
    if (!match) continue;

    if (start < 0) {
      start = i;
      marker = match[1];
    } else if (match[1] === marker) {
      ranges.push({ start, end: i + 1 });
      start = -1;
      marker = "";
    }
  }

  if (start >= 0) {
    ranges.push({ start, end: lines.length });
  }

  return ranges;
}

function isInsideFenceBoundary(index, ranges) {
  return ranges.some((range) => index > range.start && index < range.end);
}

function isLineInsideRange(index, ranges) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function findTableRanges(lines, fenceRanges) {
  const ranges = [];

  for (let i = 0; i < lines.length - 1; i++) {
    if (isLineInsideRange(i, fenceRanges)) continue;
    if (!lines[i].includes("|") || !isTableDelimiterLine(lines[i + 1])) continue;

    let end = i + 2;
    while (
      end < lines.length &&
      !isLineInsideRange(end, fenceRanges) &&
      lines[end].trim() &&
      lines[end].includes("|")
    ) {
      end++;
    }

    ranges.push({
      start: i,
      end,
      headerLines: [lines[i], lines[i + 1]],
    });
    i = end - 1;
  }

  return ranges;
}

function findTableForSplit(index, tableRanges) {
  return tableRanges.find((range) => index > range.start + 2 && index < range.end) || null;
}

function splitMarkdownByCharacter(markdownText) {
  const text = String(markdownText || "").trim();
  if (!text) return null;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fenceRanges = findFenceRanges(lines);
  if (fenceRanges.length === 1 && fenceRanges[0].start === 0 && fenceRanges[0].end === lines.length) {
    return null;
  }

  const target = Math.floor(text.length / 2);
  const minIndex = Math.max(1, Math.floor(text.length * 0.15));
  const maxIndex = Math.min(text.length - 1, Math.ceil(text.length * 0.85));
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const boundaryPattern = /[。！？.!?；;，,\n ]/g;
  let match;

  while ((match = boundaryPattern.exec(text)) !== null) {
    const index = match.index + 1;
    if (index < minIndex || index > maxIndex) continue;
    const distance = Math.abs(index - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  const splitIndex = bestIndex > 0 ? bestIndex : target;
  const left = text.slice(0, splitIndex).trim();
  const right = text.slice(splitIndex).trim();
  return left && right ? [left, right] : null;
}

export function splitMarkdownIntoBalancedParts(markdownText) {
  const normalized = String(markdownText || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const lines = normalized.split("\n");
  const fenceRanges = findFenceRanges(lines);
  const tableRanges = findTableRanges(lines, fenceRanges);
  const totalWeight = getMarkdownDisplayLength(normalized);
  if (totalWeight <= 1) return null;

  const minWeight = Math.max(1, Math.floor(totalWeight * 0.15));
  let best = null;

  for (let index = 1; index < lines.length; index++) {
    if (isInsideFenceBoundary(index, fenceRanges)) continue;

    const tableRange = findTableForSplit(index, tableRanges);
    const previousLine = lines[index - 1] || "";
    const currentLine = lines[index] || "";
    const previousNonEmptyLine = findPreviousNonEmptyLine(lines, index);
    const nextNonEmptyLine = findNextNonEmptyLine(lines, index);
    let rightPrefix = [];
    let penalty = 160;

    if (isHeadingLine(previousNonEmptyLine) && !isHeadingLine(nextNonEmptyLine)) {
      continue;
    }

    if (tableRange) {
      rightPrefix = tableRange.headerLines;
      penalty = 20;
    } else if (!previousLine.trim()) {
      penalty = 0;
    } else if (isHeadingLine(currentLine)) {
      penalty = 30;
    } else if (isListItemLine(previousLine) && isListItemLine(currentLine)) {
      penalty = 40;
    }

    const left = lines.slice(0, index).join("\n").trim();
    const right = [...rightPrefix, ...lines.slice(index)].join("\n").trim();
    if (!left || !right) continue;

    const leftWeight = getMarkdownDisplayLength(left);
    const rightWeight = getMarkdownDisplayLength(right);
    if (leftWeight < minWeight || rightWeight < minWeight) continue;

    const score = Math.abs(leftWeight - rightWeight) + penalty;
    if (!best || score < best.score) {
      best = { left, right, score };
    }
  }

  if (!best) {
    return splitMarkdownByCharacter(normalized);
  }

  return [best.left, best.right];
}

async function renderMarkdownPartsToImageNodes(markdownParts, userId, nickname) {
  const nodes = [];

  for (let i = 0; i < markdownParts.length; i++) {
    const imgBuffer = await renderMarkdownToImage(markdownParts[i]).catch(() => null);
    if (!imgBuffer) return null;

    nodes.push({
      user_id: userId,
      nickname,
      content: [segment.image(imgBuffer)],
    });
  }

  return nodes;
}

/**
 * 通过三层合并转发发送 Markdown 消息
 * （经测试：第一层 markdown 转发消息会失败，必须放在第二层转发消息才能成功）
 *
 * @param {object} e - 消息事件对象
 * @param {string} markdownContent - Markdown 文本内容
 * @param {object} [opts] - 可选项
 * @param {string} [opts.source]  - 转发卡片来源标注，默认 "消息"
 * @param {string} [opts.prompt]  - 转发卡片预览文字，默认 "点击查看详情"
 * @param {string} [opts.outerNickname] - 外层节点显示名，默认触发用户昵称
 * @param {string} [opts.innerNickname] - 内层节点显示名，同上
 * @param {Array} [opts.fallbackNodes] - 已构造好的转发节点
 * @returns {Promise<object|null>} sendForwardMsg 的返回值
 */
export async function sendMarkdownMsg(e, markdownContent, opts = {}) {
  const userId = e.self_id;
  const defaultNickname = bot.nickname || String(e.self_id);
  const {
    source = "Markdown消息",
    prompt = "点击查看详情",
    outerNickname = defaultNickname,
    innerNickname = defaultNickname,
    fallbackContent = null,
    fallbackNodes = null,
  } = opts;

  let nodes = Array.isArray(fallbackNodes) && fallbackNodes.length ? fallbackNodes : null;

  if (!nodes) {
    let content = Array.isArray(fallbackContent) ? [...fallbackContent] : [];

    if (content.length === 0) {
      const imgBuffer = await renderMarkdownToImage(markdownContent).catch(() => null);
      if (imgBuffer) {
        content = [segment.image(imgBuffer)];
      } else {
        content = [{ type: "text", data: { text: markdownContent } }];
      }
    }

    nodes = [
      {
        user_id: userId,
        nickname: outerNickname || innerNickname,
        content,
      },
    ];
  }

  try {
    return await e.sendForwardMsg(
      nodes,
      { source, prompt }
    );
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
 * - 小于配置字数 + Markdown → 直接发送 AI 原始文本
 * - 达到拆分阈值 + Markdown → 尽量按 Markdown 块边界均分为两张图
 * - 达到配置字数 + Markdown → Puppeteer 渲染图片作为降级节点 + 第三层嵌套 Markdown
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

  text = text.replace(/<draw>([\s\S]*?)<\/draw>/gi, "").trim();

  text = text.replace(/\*\*(.*?)\*\*/g, (match, inner) => ` **${inner.trim()}** `);

  if (!text) return;

  const { quote = 0, at = false, textReplyFn = null } = opts;
  const botname = Setting.getConfig("bot")?.botname || "";

  const doTextReply = async (t) => {
    if (textReplyFn) return await textReplyFn(t);
    return await e.reply(parseAtMessage(t), quote, at);
  };

  const aiConfig = Setting.getConfig("AI") || {};
  const enableMarkdownProcess = aiConfig.enableMarkdownProcess ?? true;
  const markdownPlainTextLimit = aiConfig.markdownPlainTextLimit ?? DEFAULT_MARKDOWN_PLAIN_TEXT_LIMIT;
  const markdownSplitImageLimit = aiConfig.markdownSplitImageLimit ?? DEFAULT_MARKDOWN_SPLIT_IMAGE_LIMIT;

  if (isMdText(text)) {
    if (!enableMarkdownProcess) {
      return await doTextReply(text);
    }

    if (text.length < markdownPlainTextLimit) {
      return await doTextReply(text);
    }

    let imgBuffer = null;
    try {
      let fallbackNodes = null;
      let fallbackContent = [];

      if (markdownSplitImageLimit > 0 && text.length >= markdownSplitImageLimit) {
        const parts = splitMarkdownIntoBalancedParts(text);
        if (parts?.length === 2) {
          const defaultNickname = bot.nickname || String(e.self_id);
          fallbackNodes = await renderMarkdownPartsToImageNodes(parts, e.self_id, defaultNickname);
        }
      }

      if (!fallbackNodes) {
        imgBuffer = await renderMarkdownToImage(text).catch(() => null);
        if (imgBuffer) {
          fallbackContent.push(segment.image(imgBuffer));
        } else {
          fallbackContent.push({ type: "text", data: { text: text } });
        }
      }

      const result = await sendMarkdownMsg(e, text, {
        source: botname ? `${botname}回复` : "消息",
        fallbackContent,
        fallbackNodes,
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
  html {
    width: 1080px;
    max-width: 1080px;
    overflow-x: hidden;
  }
  body {
    margin: 0;
    padding: 30px 40px;
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 34px;
    line-height: 1.7;
    width: 1080px;
    max-width: 1080px; /* 限制大宽度，迫使图片在缩放时文字更大 */
    overflow-x: hidden;
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
    max-width: 100%;
    overflow: visible;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    margin: 0.8em 0;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }
  pre code {
    background: none;
    padding: 0;
    color: #a6e3a1;
    font-size: 0.9em;
    display: block;
    white-space: inherit;
    word-break: inherit;
    overflow-wrap: inherit;
  }
  table {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
    max-width: 100%;
    margin: 1em 0;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    overflow-wrap: anywhere;
    word-break: break-word;
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
  th, td {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  th code, td code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
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
    await page.setViewport({ width: 1080, height: 100, deviceScaleFactor: 1 });
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    await page.evaluate(async () => {
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

    const bodyHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    await page.setViewport({ width: 1080, height: Math.ceil(bodyHeight), deviceScaleFactor: 1 });
    const imageBuffer = await page.screenshot({
      clip: {
        x: 0,
        y: 0,
        width: 1080,
        height: Math.ceil(bodyHeight),
      },
      type: 'png',
    });
    return imageBuffer;
  } catch (err) {
    logger.error(`[renderMarkdownToImage] 渲染失败: ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => { });
  }
}
