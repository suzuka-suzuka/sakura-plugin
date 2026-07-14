import puppeteer from "puppeteer";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "0";
}

function renderStatCards(stats) {
  const cards = [
    ["消息总数", formatNumber(stats.messageCount), `含 Bot ${formatNumber(stats.botMessageCount)} 条`],
    ["活跃成员", formatNumber(stats.participantCount), "按实际发言成员统计"],
    ["文本字符", formatNumber(stats.textCharacters), `回复互动 ${formatNumber(stats.replyCount)} 次`],
    ["高峰时段", stats.peakHourLabel, `${formatNumber(stats.peakHourCount)} 条消息`],
  ];
  return cards.map(([label, value, note]) => `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      <div class="stat-note">${escapeHtml(note)}</div>
    </div>`).join("");
}

function renderActivityChart(stats) {
  const counts = Array.isArray(stats.hourlyCounts) ? stats.hourlyCounts : [];
  const max = Math.max(1, ...counts);
  return Array.from({ length: 24 }, (_, hour) => {
    const count = Number(counts[hour] || 0);
    const height = count > 0 ? Math.max(8, Math.round(count / max * 120)) : 3;
    const active = count === max && count > 0 ? " peak" : "";
    const hourLabel = hour % 3 === 0 ? String(hour).padStart(2, "0") : "";
    return `<div class="hour-column" title="${hour}:00，共 ${count} 条">
      <div class="bar-wrap"><div class="bar${active}" style="height:${height}px"></div></div>
      <div class="hour-count">${count || ""}</div>
      <div class="hour-label">${hourLabel}</div>
    </div>`;
  }).join("");
}

function renderTopMembers(stats) {
  const members = Array.isArray(stats.topMembers) ? stats.topMembers.slice(0, 8) : [];
  if (!members.length) return '<div class="empty">暂无成员活跃数据</div>';
  const max = Math.max(1, ...members.map((member) => member.messageCount));
  return members.map((member, index) => {
    const width = Math.max(5, Math.round(member.messageCount / max * 100));
    return `<div class="rank-row">
      <div class="rank-index">${index + 1}</div>
      <div class="rank-main">
        <div class="rank-head">
          <span class="rank-name">${escapeHtml(member.name)}</span>
          <span class="rank-count">${formatNumber(member.messageCount)} 条 · ${escapeHtml(member.share)}%</span>
        </div>
        <div class="rank-track"><div class="rank-fill" style="width:${width}%"></div></div>
      </div>
      <div class="rank-time">${escapeHtml(member.activeHourLabel)}</div>
    </div>`;
  }).join("");
}

function renderTopics(analysis) {
  const topics = Array.isArray(analysis.topics) ? analysis.topics : [];
  if (!topics.length) return '<div class="empty">AI 未提取到可靠的话题</div>';
  return topics.map((topic, index) => `
    <article class="topic-card">
      <div class="topic-number">${String(index + 1).padStart(2, "0")}</div>
      <div>
        <h3>${escapeHtml(topic.title)}</h3>
        <p>${escapeHtml(topic.summary)}</p>
        ${topic.participants?.length
          ? `<div class="chips">${topic.participants.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
          : ""}
      </div>
    </article>`).join("");
}

function renderQuotes(analysis) {
  const quotes = Array.isArray(analysis.quotes) ? analysis.quotes : [];
  if (!quotes.length) return '<div class="empty">没有足够可靠的群聊金句</div>';
  return quotes.map((quote) => `
    <blockquote class="quote-card">
      <div class="quote-mark">“</div>
      <div class="quote-content">${escapeHtml(quote.content)}</div>
      <footer>
        <b>${escapeHtml(quote.speaker)}</b>
        <span>${escapeHtml(quote.reason || quote.messageRef)}</span>
      </footer>
    </blockquote>`).join("");
}

function renderMemberInsights(analysis) {
  const members = Array.isArray(analysis.members) ? analysis.members : [];
  if (!members.length) return '<div class="empty">成员样本不足，暂不生成称号</div>';
  return members.map((member) => `
    <article class="member-card">
      <div class="member-head">
        <div>
          <div class="member-name">${escapeHtml(member.name)}</div>
          <div class="member-qq">QQ ${escapeHtml(member.userId)}</div>
        </div>
        <div class="behavior-tags">${(member.behaviorTags || [])
          .map((tag) => `<span>${escapeHtml(tag)}</span>`)
          .join("")}</div>
      </div>
      <div class="member-title">${escapeHtml(member.title)}</div>
      <p>${escapeHtml(member.reason)}</p>
    </article>`).join("");
}

function getRelationshipPairKey(userAId, userBId) {
  return [String(userAId), String(userBId)].sort().join(":");
}

function buildRelationshipGraphData(stats, analysis) {
  const nodes = (stats.topMembers || []).slice(0, 8).map((member) => ({
    userId: String(member.userId),
    name: member.name,
  }));
  const nodeIds = new Set(nodes.map((node) => node.userId));
  const edgeMap = new Map();

  for (const edge of stats.relationships?.edges || []) {
    if (!nodeIds.has(String(edge.userAId)) || !nodeIds.has(String(edge.userBId))) {
      continue;
    }
    const key = getRelationshipPairKey(edge.userAId, edge.userBId);
    edgeMap.set(key, {
      userAId: String(edge.userAId),
      userBId: String(edge.userBId),
      explicitCount: Number(edge.count || 0),
      atCount: Number(edge.atCount || 0),
      replyCount: Number(edge.replyCount || 0),
      contextual: false,
      confidence: "",
      reason: "",
    });
  }

  for (const relation of analysis.relations || []) {
    if (
      !nodeIds.has(String(relation.userAId))
      || !nodeIds.has(String(relation.userBId))
    ) {
      continue;
    }
    const key = getRelationshipPairKey(relation.userAId, relation.userBId);
    const existing = edgeMap.get(key) || {
      userAId: String(relation.userAId),
      userBId: String(relation.userBId),
      explicitCount: 0,
      atCount: 0,
      replyCount: 0,
    };
    edgeMap.set(key, {
      ...existing,
      contextual: true,
      confidence: relation.confidence,
      reason: relation.reason,
    });
  }

  return {
    nodes,
    edges: [...edgeMap.values()]
      .sort((a, b) => (
        b.explicitCount - a.explicitCount
        || Number(b.contextual) - Number(a.contextual)
      ))
      .slice(0, 14),
  };
}

function getRelationshipStrength(edge) {
  const contextualStrength = edge.contextual
    ? edge.confidence === "高" ? 2 : 1
    : 0;
  return Math.max(1, Number(edge.explicitCount || 0) + contextualStrength);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildForceDirectedPositions(nodes, edges, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const initialRadiusX = Math.min(310, width * 0.32);
  const initialRadiusY = Math.min(135, height * 0.32);
  const layoutNodes = nodes.map((node, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / nodes.length;
    return {
      ...node,
      x: centerX + Math.cos(angle) * initialRadiusX,
      y: centerY + Math.sin(angle) * initialRadiusY,
    };
  });
  const maxStrength = Math.max(1, ...edges.map(getRelationshipStrength));
  const strengthScaleMax = Math.max(6, maxStrength);
  const layoutEdges = edges.map((edge) => {
    const strength = getRelationshipStrength(edge);
    const normalizedStrength = Math.log1p(strength) / Math.log1p(strengthScaleMax);
    return {
      source: edge.userAId,
      target: edge.userBId,
      distance: 250 - normalizedStrength * 75,
      forceStrength: 0.25 + normalizedStrength * 0.55,
    };
  });

  const simulation = forceSimulation(layoutNodes)
    .alpha(1)
    .alphaMin(0.001)
    .velocityDecay(0.45)
    .force("link", forceLink(layoutEdges)
      .id((node) => node.userId)
      .distance((edge) => edge.distance)
      .strength((edge) => edge.forceStrength))
    .force("charge", forceManyBody().strength(-520).distanceMax(520))
    .force("collision", forceCollide(88).strength(1).iterations(2))
    .force("center", forceCenter(centerX, centerY))
    .force("x", forceX(centerX).strength(0.035))
    .force("y", forceY(centerY).strength(0.07))
    .stop();

  for (let index = 0; index < 320; index++) {
    simulation.tick();
    for (const node of layoutNodes) {
      const x = clamp(node.x, 98, width - 98);
      const y = clamp(node.y, 42, height - 42);
      if (x !== node.x) node.vx = 0;
      if (y !== node.y) node.vy = 0;
      node.x = x;
      node.y = y;
    }
  }
  simulation.stop();

  return new Map(layoutNodes.map((node) => [
    node.userId,
    { x: node.x, y: node.y },
  ]));
}

function renderRelationshipGraph(stats, analysis) {
  const { nodes, edges } = buildRelationshipGraphData(stats, analysis);
  if (nodes.length < 2 || edges.length === 0) {
    return '<div class="empty">今天还没有足够明确的群友互动关系</div>';
  }

  const width = 950;
  const height = 420;
  const positions = buildForceDirectedPositions(nodes, edges, width, height);
  const edgeLines = edges.map((edge) => {
    const start = positions.get(edge.userAId);
    const end = positions.get(edge.userBId);
    if (!start || !end) return "";
    const strength = getRelationshipStrength(edge);
    const strokeWidth = Math.min(8, 2 + Math.log2(strength + 1) * 1.5);
    return `<line class="relation-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" style="stroke-width:${strokeWidth}px" />`;
  }).join("");
  const nodeHtml = nodes.map((node) => {
    const position = positions.get(node.userId);
    return `<div class="relation-node" style="left:${position.x}px;top:${position.y}px">
      <b>${escapeHtml(node.name)}</b>
    </div>`;
  }).join("");
  const contextualRelations = (analysis.relations || [])
    .filter((relation) => (
      positions.has(String(relation.userAId))
      && positions.has(String(relation.userBId))
    ));
  const contextHtml = contextualRelations.length
    ? `<div class="context-relations">${contextualRelations.map((relation) => `
        <div class="context-relation-card">
          <div><b>${escapeHtml(relation.userAName)}</b><span> ↔ </span><b>${escapeHtml(relation.userBName)}</b><em>${escapeHtml(relation.confidence)}置信</em></div>
          <p>${escapeHtml(relation.reason)}</p>
        </div>`).join("")}</div>`
    : "";

  return `<div class="relationship-wrap">
    <div class="relationship-graph">
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        ${edgeLines}
      </svg>
      ${nodeHtml}
    </div>
    ${contextHtml}
  </div>`;
}

function buildReportHtml(report) {
  const { stats, analysis } = report;
  const cacheLabel = report.isDailyReport
    ? "每日自动报告"
    : report.fromCache ? "缓存报告" : "实时生成";
  const aiLabel = analysis.aiAvailable ? "AI 洞见" : "仅本地统计";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    :root {
      --bg: #11111b;
      --panel: rgba(30, 30, 46, 0.92);
      --panel-soft: rgba(49, 50, 68, 0.72);
      --border: rgba(205, 214, 244, 0.12);
      --text: #cdd6f4;
      --muted: #9399b2;
      --pink: #f5c2e7;
      --mauve: #cba6f7;
      --blue: #89b4fa;
      --green: #a6e3a1;
      --yellow: #f9e2af;
      --body-font-size: 25px;
      --content-font-size: 27px;
      --note-font-size: 17px;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    }
    #capture-area {
      width: 1080px;
      min-height: 100vh;
      padding: 38px;
      background:
        radial-gradient(circle at 8% 2%, rgba(203, 166, 247, 0.20), transparent 25%),
        radial-gradient(circle at 94% 10%, rgba(137, 180, 250, 0.14), transparent 24%),
        linear-gradient(155deg, #11111b 0%, #181825 58%, #11111b 100%);
    }
    .header {
      position: relative;
      overflow: hidden;
      padding: 32px 34px;
      border: 1px solid var(--border);
      border-radius: 24px;
      background: linear-gradient(130deg, rgba(49, 50, 68, 0.96), rgba(30, 30, 46, 0.94));
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
    }
    .header::after {
      content: "";
      position: absolute;
      width: 260px;
      height: 260px;
      right: -100px;
      top: -130px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--pink), var(--blue));
      opacity: 0.18;
      filter: blur(4px);
    }
    .eyebrow { color: var(--pink); font-size: 18px; font-weight: 800; letter-spacing: 3px; }
    h1 { margin: 10px 0 8px; font-size: 42px; line-height: 1.25; color: #f5e0f2; }
    .subtitle { color: #bac2de; font-size: 24px; }
    .badges { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    .badge {
      padding: 7px 13px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(17, 17, 27, 0.45);
      color: #bac2de;
      font-size: var(--note-font-size);
    }
    .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 18px; }
    .stat-card, .section {
      border: 1px solid var(--border);
      background: var(--panel);
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.15);
    }
    .stat-card { padding: 20px; border-radius: 18px; min-width: 0; }
    .stat-label { color: var(--muted); font-size: 20px; }
    .stat-value { margin-top: 8px; color: #f5e0f2; font-size: 34px; font-weight: 900; overflow-wrap: anywhere; }
    .stat-note { margin-top: 7px; color: #7f849c; font-size: var(--note-font-size); }
    .section { margin-top: 18px; padding: 25px; border-radius: 22px; }
    .section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 19px; }
    .section-title { color: #f5e0f2; font-size: 27px; font-weight: 900; }
    .section-note { color: var(--muted); font-size: var(--note-font-size); text-align: right; }
    .overview { margin: 0; color: #dce2f6; font-size: var(--body-font-size); line-height: 1.7; white-space: pre-wrap; }
    .mood {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-top: 18px;
      padding: 8px 13px;
      border-radius: 12px;
      background: rgba(203, 166, 247, 0.12);
      border: 1px solid rgba(203, 166, 247, 0.24);
      color: #e7d5fa;
      font-size: 19px;
    }
    .mood b { color: var(--mauve); }
    .activity-chart { display: grid; grid-template-columns: repeat(24, 1fr); gap: 6px; height: 174px; }
    .hour-column { display: grid; grid-template-rows: 122px 22px 20px; min-width: 0; text-align: center; }
    .bar-wrap { display: flex; align-items: end; justify-content: center; height: 122px; }
    .bar { width: 70%; min-width: 5px; max-width: 22px; border-radius: 7px 7px 3px 3px; background: linear-gradient(180deg, var(--blue), #74c7ec); opacity: 0.75; }
    .bar.peak { background: linear-gradient(180deg, var(--pink), var(--mauve)); opacity: 1; box-shadow: 0 0 18px rgba(203, 166, 247, 0.38); }
    .hour-count { color: #bac2de; font-size: 14px; }
    .hour-label { color: #6c7086; font-size: 14px; }
    .rank-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) 150px; gap: 14px; align-items: center; margin: 18px 0; }
    .rank-index { color: var(--mauve); font-size: 22px; font-weight: 900; text-align: center; }
    .rank-head { display: flex; justify-content: space-between; gap: 14px; margin-bottom: 6px; }
    .rank-name { color: #e7eaf8; font-size: var(--body-font-size); font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rank-count, .rank-time { color: var(--muted); font-size: var(--note-font-size); }
    .rank-time { text-align: right; }
    .rank-track { height: 7px; overflow: hidden; border-radius: 99px; background: #313244; }
    .rank-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--mauve), var(--pink)); }
    .relationship-graph { position: relative; width: 100%; height: 420px; overflow: hidden; border-radius: 18px; background: radial-gradient(circle at center, rgba(137, 180, 250, 0.08), transparent 58%); border: 1px solid var(--border); }
    .relationship-graph svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .relation-line { fill: none; stroke: var(--blue); opacity: 0.78; }
    .relation-node { position: absolute; width: 164px; min-height: 56px; padding: 14px 12px; transform: translate(-50%, -50%); border-radius: 14px; border: 1px solid rgba(203, 166, 247, 0.34); background: rgba(49, 50, 68, 0.96); text-align: center; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24); }
    .relation-node b { display: block; color: #f0e5fb; font-size: 19px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-relations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .context-relation-card { padding: 15px; border: 1px dashed rgba(203, 166, 247, 0.34); border-radius: 14px; background: rgba(49, 50, 68, 0.58); }
    .context-relation-card div { color: #e6e9f8; font-size: 19px; }
    .context-relation-card em { margin-left: 9px; color: var(--mauve); font-size: 15px; font-style: normal; }
    .context-relation-card p { margin: 8px 0 0; color: #bac2de; font-size: 18px; line-height: 1.55; }
    .topic-grid, .member-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .topic-card { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 14px; padding: 18px; border-radius: 16px; background: var(--panel-soft); border: 1px solid var(--border); }
    .topic-number { color: var(--blue); font-size: 22px; font-weight: 900; }
    h3 { margin: 0; color: #e6e9f8; font-size: var(--body-font-size); }
    .topic-card p, .member-card p { margin: 10px 0 0; color: #bac2de; font-size: var(--body-font-size); line-height: 1.62; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
    .chips span { padding: 5px 9px; border-radius: 999px; background: rgba(137, 180, 250, 0.12); color: #b8d3fa; font-size: var(--note-font-size); }
    .quote-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .quote-card { position: relative; margin: 0; padding: 23px 19px 18px; border-radius: 16px; background: var(--panel-soft); border: 1px solid var(--border); }
    .quote-mark { position: absolute; top: 3px; left: 12px; color: rgba(245, 194, 231, 0.35); font-family: Georgia, serif; font-size: 54px; }
    .quote-content { position: relative; color: #e6e9f8; font-size: var(--content-font-size); line-height: 1.62; overflow-wrap: anywhere; }
    .quote-card footer { display: flex; justify-content: space-between; gap: 14px; margin-top: 17px; color: var(--muted); font-size: 21px; line-height: 1.5; }
    .quote-card footer b { color: var(--pink); font-size: 23px; }
    .member-card { padding: 18px; border-radius: 16px; background: var(--panel-soft); border: 1px solid var(--border); }
    .member-head { display: flex; justify-content: space-between; gap: 14px; align-items: start; }
    .member-name { color: #e6e9f8; font-size: var(--body-font-size); font-weight: 900; }
    .member-qq { color: #7f849c; font-size: var(--note-font-size); margin-top: 4px; }
    .behavior-tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 58%; }
    .behavior-tags span { padding: 6px 9px; border-radius: 8px; background: rgba(166, 227, 161, 0.12); color: var(--green); font-weight: 800; font-size: 17px; }
    .member-title { display: inline-block; margin-top: 14px; padding: 6px 10px; border-radius: 8px; color: var(--yellow); background: rgba(249, 226, 175, 0.10); font-size: 22px; font-weight: 800; }
    .empty { padding: 22px; border: 1px dashed rgba(205, 214, 244, 0.18); border-radius: 14px; color: #7f849c; text-align: center; }
    .footer { margin-top: 20px; color: #6c7086; font-size: var(--note-font-size); line-height: 1.6; text-align: center; }
    .brand { color: var(--mauve); font-weight: 800; }
  </style>
</head>
<body>
  <main id="capture-area">
    <header class="header">
      <div class="eyebrow">SAKURA · GROUP INSIGHT</div>
      <h1>${escapeHtml(report.groupName)} 群聊洞见</h1>
      <div class="subtitle">${escapeHtml(report.date.displayLabel)}</div>
      <div class="badges">
        <span class="badge">${escapeHtml(cacheLabel)}</span>
        <span class="badge">${escapeHtml(aiLabel)}</span>
        <span class="badge">${escapeHtml(report.aiInputNote)}</span>
      </div>
    </header>

    <section class="stats">${renderStatCards(stats)}</section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">群聊速写</div>
        <div class="section-note">基于当天已记录消息生成</div>
      </div>
      <p class="overview">${escapeHtml(analysis.overview)}</p>
      <div class="mood"><b>${escapeHtml(analysis.mood.label)}</b><span>${escapeHtml(analysis.mood.description)}</span></div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">24 小时活跃度</div>
        <div class="section-note">高峰 ${escapeHtml(stats.peakHourLabel)} · ${formatNumber(stats.peakHourCount)} 条</div>
      </div>
      <div class="activity-chart">${renderActivityChart(stats)}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">活跃成员</div>
        <div class="section-note">Bot 消息不参与成员排名</div>
      </div>
      ${renderTopMembers(stats)}
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">群关系图谱</div>
        <div class="section-note">线条越粗，互动越强</div>
      </div>
      ${renderRelationshipGraph(stats, analysis)}
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">热门话题</div>
        <div class="section-note">从聊天样本中归纳</div>
      </div>
      <div class="topic-grid">${renderTopics(analysis)}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">群聊金句</div>
        <div class="section-note">原文由消息引用反查，避免 AI 改写</div>
      </div>
      <div class="quote-grid">${renderQuotes(analysis)}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">成员称号</div>
        <div class="section-note">行为标签来自本地统计，不进行人格类型推断</div>
      </div>
      <div class="member-grid">${renderMemberInsights(analysis)}</div>
    </section>

    <div class="footer">
      数据范围受 Redis 的 5000 条上限与 7 天保留期影响；AI 仅读取报告中注明的消息样本。<br>
      生成时间 ${escapeHtml(report.generatedAt)} · <span class="brand">Made by Sakura Plugin</span>
    </div>
  </main>
</body>
</html>`;
}

export async function renderGroupInsightImage(report) {
  const html = buildReportHtml(report);
  let browser;

  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 900, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluateHandle("document.fonts.ready").catch(() => null);
    const element = await page.$("#capture-area");
    if (!element) throw new Error("群聊洞见渲染节点不存在");
    return await element.screenshot({ type: "png" });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
