import puppeteer from "puppeteer";
import Setting from "../lib/setting.js";
import { getAI } from "../lib/AIUtils/getAI.js";

const UID_COMMAND_RE =
  /^#?\s*(?:查)?(?:B站|b站|哔哩哔哩|bili)\s*(?:UID|uid|用户|成分)?\s*[:：]?\s*(\d{2,20})(?:\s*[\s\S]*)?$/i;

const API_BASE = "https://api.syrds.pro/get_replies";
const SOURCE_SITE = "https://syrds.pro";
const DEFAULT_PAGE_SIZE = 75;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_AI_CHAR_LIMIT = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";

export class BiliUidAnalyzer extends plugin {
  constructor() {
    super({
      name: "B站UID成分分析",
      event: "message",
      priority: 1135,
    });
  }

  get appconfig() {
    return Setting.getConfig("BiliUid") || {};
  }

  queryUid = Command(
    UID_COMMAND_RE,
    { economy: { command: "B站UID分析", refundOnFalse: true } },
    async (e) => {
      const uid = e.match?.[1];
      if (!uid) return false;

      await e.react?.(124).catch(() => {});

      try {
        const config = normalizeConfig(this.appconfig);
        const report = await this.fetchUidReport(uid, config);
        const aiReport = await this.buildAiReport(e, report, config);
        const imageBuffer = await renderReportImage({
          uid,
          report,
          aiReport,
          aiInputNote: aiReport.inputNote,
        });

        await e.reply(segment.image(imageBuffer));
        return true;
      } catch (error) {
        logger.error(`[BiliUidAnalyzer] UID ${uid} 查询失败:`, error);
        await e.reply(
          `B站 UID 查询失败：${error?.message || error}`,
          10,
          true
        );
        return { handled: true, refund: true };
      }
    }
  );

  async fetchUidReport(uid, config) {
    const pageSize = config.pageSize;
    const firstPage = await fetchReplyPage(uid, 1, pageSize, config.timeoutMs);
    const totalReviews = Number(firstPage.review_num || 0);
    const totalPagesFromCount = totalReviews
      ? Math.max(1, Math.ceil(totalReviews / pageSize))
      : 1;
    const plannedPages =
      config.maxPages > 0
        ? Math.min(totalPagesFromCount, config.maxPages)
        : totalPagesFromCount;

    const pages = [firstPage];
    const restPageNums = [];
    for (let page = 2; page <= plannedPages; page++) {
      restPageNums.push(page);
    }

    const restPages = await mapLimit(
      restPageNums,
      config.concurrency,
      (pageNum) => fetchReplyPage(uid, pageNum, pageSize, config.timeoutMs)
    );
    pages.push(...restPages);

    await probeExtraPages(uid, pages, config);

    const pagesWithRows = pages.filter((page) => pageRows(page).length > 0);
    const comments = dedupeComments(
      pagesWithRows.flatMap((page) => normalizeRows(page.data))
    );
    const lastRows = pageRows(pagesWithRows[pagesWithRows.length - 1]);
    const hitMaxPages =
      config.maxPages > 0 &&
      pagesWithRows.length >= config.maxPages &&
      lastRows.length >= pageSize;

    return {
      uid: String(firstPage.uid || uid),
      currentName: firstPage.current_name || "未知",
      allNames: parseAllNames(firstPage.all_names),
      reviewNum: Math.max(totalReviews, comments.length),
      fetchedCount: comments.length,
      totalPages: Math.max(totalPagesFromCount, pagesWithRows.length),
      fetchedPages: pagesWithRows.length,
      limitedByMaxPages:
        (config.maxPages > 0 && totalPagesFromCount > config.maxPages) ||
        hitMaxPages,
      sourceUrl: `${SOURCE_SITE}/uid=${encodeURIComponent(uid)}`,
      generatedAt: formatDateTime(new Date()),
      comments,
    };
  }

  async buildAiReport(e, report, config) {
    if (!report.comments.length) {
      return {
        summary: "该 UID 暂无可分析的评论数据。",
        tags: [],
        composition: [],
        commentAnalysis: [],
        cautions: ["没有评论时不做画像推断。"],
        inputNote: "无评论数据，未调用 AI。",
      };
    }

    const aiInput = buildAiInput(report, config.aiCommentCharLimit);
    const prompt = buildAiPrompt(report, aiInput.text);
    const channel = Setting.getConfig("AI")?.appschannel || "default";

    try {
      const result = await getAI(
        channel,
        e,
        [{ text: prompt }],
        null,
        false,
        false,
        []
      );

      if (!result || typeof result === "string") {
        return buildAiErrorReport(result || "AI 未返回有效内容", aiInput.note);
      }

      const text = String(result.text || "").trim();
      if (!text) {
        return buildAiErrorReport("AI 返回为空", aiInput.note);
      }

      const parsed = extractJsonObject(text);
      if (!parsed) {
        return {
          summary: text,
          tags: [],
          composition: [],
          commentAnalysis: [],
          cautions: ["AI 未按 JSON 返回，已保留原始总结文本。"],
          rawText: text,
          inputNote: aiInput.note,
        };
      }

      return normalizeAiReport(parsed, aiInput.note);
    } catch (error) {
      logger.error("[BiliUidAnalyzer] AI 总结失败:", error);
      return buildAiErrorReport(error?.message || error, aiInput.note);
    }
  }
}

function normalizeConfig(config = {}) {
  const pageSize = clampInt(config.pageSize, DEFAULT_PAGE_SIZE, 1, 75);
  return {
    pageSize,
    maxPages: clampInt(config.maxPages, 0, 0, 500),
    concurrency: clampInt(config.concurrency, DEFAULT_CONCURRENCY, 1, 5),
    timeoutMs: clampInt(config.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 120_000),
    aiCommentCharLimit: clampInt(
      config.aiCommentCharLimit,
      DEFAULT_AI_CHAR_LIMIT,
      10_000,
      200_000
    ),
  };
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

async function fetchReplyPage(uid, pageNum, pageSize, timeoutMs) {
  const params = new URLSearchParams({
    uid,
    pageSize: String(pageSize),
    pageNum: String(pageNum),
    keyword: "",
    start_dt: "",
    end_dt: "",
  });

  const json = await fetchJson(`${API_BASE}?${params.toString()}`, timeoutMs);
  if (json.code !== 0) {
    throw new Error(json.msg || `接口返回 code=${json.code}`);
  }
  return json;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
        Referer: `${SOURCE_SITE}/`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`接口返回非 JSON：${text.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => run()
  );
  await Promise.all(workers);
  return results;
}

async function probeExtraPages(uid, pages, config) {
  const seenKeys = new Set(
    pages.flatMap((page) => normalizeRows(page.data).map(getCommentKey))
  );

  while (true) {
    const lastRows = pageRows(pages[pages.length - 1]);
    if (lastRows.length < config.pageSize) return;
    if (config.maxPages > 0 && pages.length >= config.maxPages) return;

    const nextPageNum = pages.length + 1;
    const nextPage = await fetchReplyPage(
      uid,
      nextPageNum,
      config.pageSize,
      config.timeoutMs
    );
    const nextRows = normalizeRows(nextPage.data);
    if (!nextRows.length) return;

    const hasNewRows = nextRows.some((row) => !seenKeys.has(getCommentKey(row)));
    if (!hasNewRows) return;

    pages.push(nextPage);
    for (const row of nextRows) {
      seenKeys.add(getCommentKey(row));
    }
  }
}

function pageRows(page) {
  return page ? normalizeRows(page.data) : [];
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => ({
    index,
    bvid: safeString(row.bvid),
    content: safeString(row.content),
    dt: safeString(row.dt),
    favorite: toInt(row.favorite),
    link: safeString(row.link),
    pubdate: safeString(row.pubdate),
    reply: toInt(row.reply),
    replyType: toInt(row.reply_type),
    title: safeString(row.title || "无标题"),
    userId: safeString(row.user_id),
    userName: safeString(row.user_name),
    videoOwnerName: safeString(row.video_owner_name || "未知"),
  }));
}

function dedupeComments(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = getCommentKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...row, index: output.length + 1 });
  }
  return output;
}

function getCommentKey(row) {
  return row.link || `${row.bvid}:${row.pubdate}:${row.content}`;
}

function parseAllNames(value) {
  if (Array.isArray(value)) return value.map(safeString).filter(Boolean);
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(safeString).filter(Boolean);
  } catch {
  }

  return trimmed
    .split(/[,，、\s]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildAiInput(report, charLimit) {
  const allLines = report.comments.map(formatCommentForAi).join("\n\n");
  if (allLines.length <= charLimit) {
    return {
      text: allLines,
      note: `AI 输入使用全部 ${report.comments.length} 条评论。`,
    };
  }

  const picked = new Map();
  const addRows = (rows) => {
    for (const row of rows) picked.set(row.index, row);
  };

  addRows(report.comments.slice(0, 80));
  addRows(report.comments.slice(-40));
  addRows(
    [...report.comments]
      .sort((a, b) => b.favorite + b.reply * 2 - (a.favorite + a.reply * 2))
      .slice(0, 60)
  );
  addRows(
    [...report.comments]
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, 50)
  );

  let text = "";
  let used = 0;
  const rows = [...picked.values()].sort((a, b) => a.index - b.index);
  for (const row of rows) {
    const line = formatCommentForAi(row);
    if (text.length + line.length + 2 > charLimit) break;
    text += `${text ? "\n\n" : ""}${line}`;
    used++;
  }

  return {
    text,
    note: `评论过长，AI 输入使用代表性样本 ${used}/${report.comments.length} 条；图片评论区仍列出已抓取的全部评论。`,
  };
}

function formatCommentForAi(row) {
  return [
    `#${row.index}`,
    `时间: ${row.pubdate || row.dt || "未知"}`,
    `视频: ${row.title}`,
    `UP: ${row.videoOwnerName}`,
    `互动: 点赞${row.favorite} 回复${row.reply}`,
    `评论: ${row.content || "(空评论/表情)"}`,
  ].join("\n");
}

function buildAiPrompt(report, aiInputText) {
  return `你是一个评论画像分析器。请根据公开的 B 站评论数据，分析这个 UID 在评论区呈现出的兴趣、话题偏好、语言风格和互动方式。

重要限制：
- 只基于下面的评论内容、视频标题、UP 主和互动数据做分析。
- 不要推断现实身份、住址、工作单位、联系方式等隐私。
- 不要对政治立场、宗教信仰、健康状况、性取向、民族等敏感属性下定论。
- “成分”按网络语义理解为兴趣圈层、内容偏好和发言风格，结论要标注不确定性。
- 输出必须是严格 JSON，不要 Markdown，不要代码块。

JSON 格式：
{
  "summary": "100-180字总评",
  "tags": [
    { "name": "标签名", "confidence": "高/中/低", "reason": "证据，引用评论编号" }
  ],
  "composition": [
    "成分/圈层判断，引用评论编号"
  ],
  "commentAnalysis": [
    "对评论内容、语气、互动方式的分析，引用评论编号"
  ],
  "cautions": [
    "不确定性或需要避免误读的点"
  ]
}

UID: ${report.uid}
当前用户名: ${report.currentName}
曾用名: ${report.allNames.join("、") || "无"}
评论总数: ${report.fetchedCount}

评论数据：
${aiInputText}`;
}

function normalizeAiReport(parsed, inputNote) {
  return {
    summary: safeString(parsed.summary || "AI 未给出总评。"),
    tags: normalizeTags(parsed.tags),
    composition: normalizeStringArray(parsed.composition),
    commentAnalysis: normalizeStringArray(parsed.commentAnalysis),
    cautions: normalizeStringArray(parsed.cautions),
    rawText: "",
    inputNote,
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === "string") {
        return { name: tag, confidence: "", reason: "" };
      }
      return {
        name: safeString(tag?.name),
        confidence: safeString(tag?.confidence),
        reason: safeString(tag?.reason),
      };
    })
    .filter((tag) => tag.name)
    .slice(0, 12);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(safeString).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function buildAiErrorReport(error, inputNote) {
  return {
    summary: `AI 总结失败：${safeString(error)}`,
    tags: [],
    composition: [],
    commentAnalysis: [],
    cautions: ["评论数据已抓取并渲染，下方仍可人工查看全部评论。"],
    rawText: "",
    inputNote,
  };
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced?.[1]) candidates.push(fenced[1]);

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
    }
  }
  return null;
}

async function renderReportImage(data) {
  const profile = getRenderProfile(data.report.comments.length);
  const html = buildReportHtml(data, profile);
  let browser;

  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: profile.width,
      height: 900,
      deviceScaleFactor: profile.scale,
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluateHandle("document.fonts.ready").catch(() => null);

    const element = await page.$("#capture-area");
    if (!element) throw new Error("渲染节点不存在");

    return await element.screenshot({ type: "png" });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function getRenderProfile(count) {
  return {
    width: 1080,
    scale: 1,
    columns: 2,
    density: "normal",
  };
}

function buildReportHtml({ report, aiReport }, profile) {
  const commentsHtml = report.comments.length
    ? report.comments.map(renderCommentCard).join("")
    : '<div class="empty">该 UID 暂无评论数据</div>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    :root {
      --columns: ${profile.columns};
      --body-width: ${profile.width}px;
      --font-size: 25px;
      --content-font-size: 27px;
      --gap: 18px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #111315;
      color: #e8edf0;
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
    }
    #capture-area {
      width: var(--body-width);
      min-height: 100vh;
      padding: 30px 40px;
      background:
        linear-gradient(135deg, rgba(18, 144, 156, 0.18), transparent 28%),
        linear-gradient(315deg, rgba(236, 95, 121, 0.12), transparent 30%),
        #17191d;
    }
    .header {
      padding: 28px 30px;
      border: 1px solid #303842;
      border-radius: 8px;
      background: #20242a;
    }
    .eyebrow {
      color: #7dd8c6;
      font-size: 18px;
      letter-spacing: 0;
      margin-bottom: 12px;
      font-weight: 700;
    }
    h1,
    .title-peer {
      margin: 0;
      font-size: 34px;
      line-height: 1.28;
      letter-spacing: 0;
      font-weight: 800;
      color: #f4f7f9;
      overflow-wrap: anywhere;
    }
    .title-peer {
      margin-top: 4px;
    }
    .header-meta {
      margin-top: 14px;
      color: #aab4bd;
      font-size: 20px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .section {
      border: 1px solid #303842;
      border-radius: 8px;
      background: #20242a;
      padding: 22px;
      margin-top: 18px;
    }
    .section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      color: #f4f7f9;
      font-weight: 800;
      font-size: 25px;
    }
    .note {
      color: #9faab4;
      font-size: 17px;
      font-weight: 500;
      text-align: right;
    }
    .summary {
      margin: 0 0 14px;
      color: #e8edf0;
      font-size: 25px;
      line-height: 1.7;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0 14px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 999px;
      background: #29313a;
      color: #f7fbfc;
      border: 1px solid #3a4651;
      font-size: 19px;
      max-width: 100%;
    }
    .tag b {
      color: #8ee5d2;
      font-weight: 800;
    }
    .tag span {
      color: #bac5cf;
    }
    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--gap);
    }
    .analysis-card {
      padding: 12px;
      border-radius: 8px;
      background: #191d22;
      border: 1px solid #2e3640;
    }
    .analysis-card h2 {
      margin: 0 0 8px;
      font-size: 22px;
      color: #f0c66a;
      letter-spacing: 0;
    }
    ul {
      margin: 0;
      padding-left: 18px;
      color: #d6dde3;
      font-size: var(--font-size);
      line-height: 1.62;
    }
    li { margin: 5px 0; overflow-wrap: anywhere; }
    .comment-grid {
      column-count: var(--columns);
      column-gap: var(--gap);
    }
    .comment-card {
      min-width: 0;
      width: 100%;
      display: inline-block;
      margin: 0 0 var(--gap);
      border-radius: 8px;
      border: 1px solid #303842;
      background: #20242a;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .comment-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 14px;
      align-items: start;
      padding: 16px 18px 12px;
      border-bottom: 1px solid #2b323b;
    }
    .comment-index {
      min-width: 46px;
      height: 46px;
      padding: 0 10px;
      border-radius: 10px;
      background: rgba(243, 139, 168, 0.28);
      color: #ffdbe6;
      border: 1px solid rgba(243, 139, 168, 0.45);
      text-align: center;
      font-size: 25px;
      font-weight: 800;
      line-height: 44px;
    }
    .video-title {
      color: #f0f4f7;
      font-weight: 800;
      font-size: var(--font-size);
      line-height: 1.42;
      overflow-wrap: anywhere;
    }
    .owner {
      margin-top: 4px;
      color: #9ba7b1;
      font-size: 18px;
      overflow-wrap: anywhere;
    }
    .comment-content {
      padding: 16px 18px;
      color: #e2e7eb;
      font-size: var(--content-font-size);
      line-height: 1.58;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .comment-foot {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      padding: 0 18px 16px;
      color: #aeb8c2;
      font-size: 17px;
    }
    .pill {
      padding: 4px 7px;
      border-radius: 999px;
      background: #171b20;
      border: 1px solid #313943;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .empty {
      padding: 30px;
      color: #b8c1ca;
      text-align: center;
      border: 1px dashed #3a4651;
      border-radius: 8px;
    }
    .footer {
      margin-top: 14px;
      color: #87919b;
      font-size: 17px;
      text-align: right;
    }
  </style>
</head>
<body>
  <main id="capture-area">
    <section class="header">
      <div>
        <div class="eyebrow">BILIBILI UID COMMENT REPORT</div>
        <h1>UID ${escHtml(report.uid)} 的评论成分分析</h1>
        <div class="title-peer">用户名：${escHtml(report.currentName)}</div>
        <div class="title-peer">曾用名：${escHtml(report.allNames.join("、") || "无")}</div>
      </div>
      <div class="header-meta">
        <div>生成时间：${escHtml(report.generatedAt)}</div>
        <div>已抓取评论：${formatNum(report.fetchedCount)} 条${report.limitedByMaxPages ? "（达到页数上限）" : ""}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-title">
        <span>AI 成分总结与标签</span>
        <span class="note">${escHtml(aiReport.inputNote || "")}</span>
      </div>
      <p class="summary">${escHtml(aiReport.summary || "")}</p>
      ${renderTags(aiReport.tags)}
      <div class="analysis-grid">
        ${renderAnalysisCard("成分判断", aiReport.composition)}
        ${renderAnalysisCard("评论分析", aiReport.commentAnalysis)}
        ${renderAnalysisCard("注意事项", aiReport.cautions)}
      </div>
    </section>

    <section class="section">
      <div class="section-title">
        <span>全部评论</span>
        <span class="note">按接口返回顺序展示；标题、UP、互动和原评论均保留</span>
      </div>
      <div class="comment-grid">${commentsHtml}</div>
    </section>

    <div class="footer">来源：${escHtml(report.sourceUrl)} | 仅基于公开评论数据生成</div>
  </main>
</body>
</html>`;
}

function renderTags(tags) {
  if (!tags.length) return "";
  return `<div class="tags">${tags
    .map(
      (tag) =>
        `<div class="tag"><b>${escHtml(tag.name)}</b>${tag.confidence ? `<span>${escHtml(tag.confidence)}</span>` : ""}${tag.reason ? `<span>${escHtml(tag.reason)}</span>` : ""}</div>`
    )
    .join("")}</div>`;
}

function renderAnalysisCard(title, items) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const body = safeItems.length
    ? `<ul>${safeItems.map((item) => `<li>${escHtml(item)}</li>`).join("")}</ul>`
    : '<ul><li>暂无</li></ul>';
  return `<div class="analysis-card"><h2>${escHtml(title)}</h2>${body}</div>`;
}

function renderCommentCard(row) {
  const content = row.content || "(空评论/表情评论)";
  const link = row.link || "";
  return `<article class="comment-card">
    <div class="comment-head">
      <div class="comment-index">${escHtml(row.index)}</div>
      <div>
        <div class="video-title">${escHtml(row.title || "无标题")}</div>
        <div class="owner">UP：${escHtml(row.videoOwnerName || "未知")}</div>
      </div>
    </div>
    <div class="comment-content">${escHtml(content)}</div>
    <div class="comment-foot">
      <span class="pill">赞 ${escHtml(row.favorite)}</span>
      <span class="pill">回复 ${escHtml(row.reply)}</span>
      <span class="pill">${escHtml(row.pubdate || row.dt || "未知时间")}</span>
      ${row.bvid ? `<span class="pill">${escHtml(row.bvid)}</span>` : ""}
      ${link ? `<span class="pill">${escHtml(link)}</span>` : ""}
    </div>
  </article>`;
}

function safeString(value) {
  return String(value ?? "").trim();
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function formatNum(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return safeString(value);
  return number.toLocaleString("zh-CN");
}

function formatDateTime(date) {
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function escHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
