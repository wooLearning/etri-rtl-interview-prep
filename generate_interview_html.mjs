import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const SOURCE = "면접준비.md";
const OUTPUTS = ["면접준비.html", "index.html"];

const md = await readFile(SOURCE, "utf8");
const generatedAt = new Date().toISOString();

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function inlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<a href="$1">$1</a>');
  return out;
}

function parseMarkdown(source) {
  const lines = source.split(/\r?\n/);
  const root = {
    title: "",
    meta: [],
    sections: [],
  };
  let currentSection = null;
  let currentBlock = null;
  let list = null;

  function ensureSection() {
    if (!currentSection) {
      currentSection = {
        id: "overview",
        title: "개요",
        children: [],
      };
      root.sections.push(currentSection);
    }
    return currentSection;
  }

  function closeList() {
    if (list && currentBlock) {
      currentBlock.items.push(list);
    }
    list = null;
  }

  function closeBlock() {
    closeList();
    currentBlock = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    const h4 = line.match(/^####\s+(.+)$/);

    if (h1) {
      closeBlock();
      root.title = h1[1].trim();
      continue;
    }

    if (h2) {
      closeBlock();
      const title = h2[1].trim();
      currentSection = {
        id: slugify(title),
        title,
        children: [],
      };
      root.sections.push(currentSection);
      continue;
    }

    if (h3 || h4) {
      closeBlock();
      const title = (h3 || h4)[1].trim();
      const level = h3 ? 3 : 4;
      currentBlock = {
        type: level === 3 ? "topic" : "question",
        level,
        id: slugify(`${ensureSection().title}-${title}`),
        title,
        items: [],
      };
      ensureSection().children.push(currentBlock);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    if (!currentSection && !currentBlock && line.includes(":")) {
      root.meta.push(line.trim());
      continue;
    }

    const targetSection = ensureSection();
    if (!currentBlock) {
      currentBlock = {
        type: "note",
        level: 3,
        id: slugify(`${targetSection.title}-note-${targetSection.children.length + 1}`),
        title: "메모",
        items: [],
      };
      targetSection.children.push(currentBlock);
    }

    const listMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/) || line.match(/^[-*]\s+(.+)$/);
    const numberMatch = line.match(/^(\d+)\.\s+(.+)$/);
    const quoteMatch = line.match(/^>\s?(.+)$/);

    if (listMatch) {
      if (!list || list.kind !== "ul") list = { kind: "ul", entries: [] };
      const text = listMatch[2] || listMatch[1];
      const checked = listMatch[2] ? listMatch[1].toLowerCase() === "x" : null;
      list.entries.push({ text: text.trim(), checked });
      continue;
    }

    if (numberMatch) {
      if (!list || list.kind !== "ol") list = { kind: "ol", entries: [] };
      list.entries.push({ text: numberMatch[2].trim(), checked: null });
      continue;
    }

    closeList();
    if (quoteMatch) {
      currentBlock.items.push({ kind: "quote", text: quoteMatch[1].trim() });
    } else {
      currentBlock.items.push({ kind: "paragraph", text: line.trim() });
    }
  }

  closeBlock();
  return root;
}

function renderItems(items) {
  return items.map((item) => {
    if (item.kind === "paragraph") {
      return `<p>${inlineMarkdown(item.text)}</p>`;
    }
    if (item.kind === "quote") {
      return `<blockquote>${inlineMarkdown(item.text)}</blockquote>`;
    }
    if (item.kind === "ul" || item.kind === "ol") {
      const tag = item.kind;
      const entries = item.entries.map((entry) => {
        const check = entry.checked === null ? "" : `<span class="check ${entry.checked ? "done" : ""}"></span>`;
        return `<li>${check}${inlineMarkdown(entry.text)}</li>`;
      }).join("");
      return `<${tag}>${entries}</${tag}>`;
    }
    return "";
  }).join("\n");
}

const data = parseMarkdown(md);
const questionCount = data.sections.flatMap((section) => section.children).filter((block) => block.type === "question" || /^Q\d+|^Q\./.test(block.title)).length;
const sectionNav = data.sections.map((section, index) => `
  <a href="#${section.id}" class="nav-link">
    <span class="nav-index">${String(index).padStart(2, "0")}</span>
    <span>${escapeHtml(section.title)}</span>
  </a>
`).join("");

const sectionHtml = data.sections.map((section, index) => {
  const cards = section.children.map((block) => {
    const isQuestion = block.type === "question" || /^Q\d+|^Q\./.test(block.title);
    const tag = isQuestion ? "질문" : block.type === "note" ? "메모" : "주제";
    return `
      <article class="card ${isQuestion ? "question-card" : "topic-card"}" id="${block.id}" data-search="${escapeHtml(`${section.title} ${block.title} ${block.items.map((item) => item.text || (item.entries || []).map((entry) => entry.text).join(" ")).join(" ")}`.toLowerCase())}">
        <button class="card-head" type="button" aria-expanded="true">
          <span class="card-tag">${tag}</span>
          <span class="card-title">${escapeHtml(block.title)}</span>
          <span class="chevron">⌄</span>
        </button>
        <div class="card-body">
          ${renderItems(block.items)}
        </div>
      </article>
    `;
  }).join("\n");

  return `
    <section class="section" id="${section.id}" data-section="${escapeHtml(section.title)}">
      <div class="section-heading">
        <span class="section-number">${String(index).padStart(2, "0")}</span>
        <h2>${escapeHtml(section.title)}</h2>
      </div>
      <div class="cards">
        ${cards}
      </div>
    </section>
  `;
}).join("\n");

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.title || "면접 준비")}</title>
  <style>
    :root {
      --bg: #f5f7fb;
      --panel: #ffffff;
      --ink: #18202f;
      --muted: #667085;
      --line: #d9e0ea;
      --accent: #2457c5;
      --accent-soft: #e7efff;
      --accent-ink: #173a88;
      --good: #18895d;
      --shadow: 0 18px 48px rgba(25, 35, 55, 0.10);
      --radius: 8px;
      color-scheme: light;
    }

    * { box-sizing: border-box; }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.68;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .layout {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
    }

    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 28px 22px;
      background: #101828;
      color: #f9fafb;
      overflow-y: auto;
    }

    .brand {
      display: grid;
      gap: 8px;
      margin-bottom: 24px;
    }

    .brand small {
      color: #a7b0c0;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .brand h1 {
      margin: 0;
      font-size: 23px;
      line-height: 1.25;
      letter-spacing: 0;
    }

    .source {
      margin: 0 0 22px;
      color: #c9d2e1;
      font-size: 13px;
      line-height: 1.5;
    }

    .nav {
      display: grid;
      gap: 6px;
    }

    .nav-link {
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 10px;
      align-items: start;
      padding: 10px 10px;
      border-radius: var(--radius);
      color: #e7edf8;
      text-decoration: none;
    }

    .nav-link:hover,
    .nav-link.active {
      background: rgba(255, 255, 255, 0.10);
      text-decoration: none;
    }

    .nav-index {
      color: #93a4bd;
      font-size: 12px;
      font-weight: 800;
      padding-top: 3px;
    }

    .main {
      min-width: 0;
    }

    .hero {
      padding: 42px clamp(24px, 4vw, 64px) 26px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }

    .hero h1 {
      margin: 0 0 14px;
      font-size: clamp(28px, 4vw, 46px);
      line-height: 1.18;
      letter-spacing: 0;
    }

    .hero p {
      max-width: 900px;
      margin: 0;
      color: var(--muted);
      font-size: 17px;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 14px clamp(24px, 4vw, 64px);
      background: rgba(245, 247, 251, 0.92);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(12px);
    }

    .search {
      width: min(560px, 100%);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 12px 14px;
      font: inherit;
      background: #fff;
      color: var(--ink);
      outline: none;
    }

    .search:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(36, 87, 197, 0.14);
    }

    .button {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 11px 13px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    .button:hover {
      border-color: #b7c3d5;
      background: #fdfdfd;
    }

    .stats {
      margin-left: auto;
      color: var(--muted);
      font-size: 14px;
      white-space: nowrap;
    }

    .content {
      padding: 30px clamp(24px, 4vw, 64px) 72px;
    }

    .section {
      scroll-margin-top: 82px;
      margin-bottom: 42px;
    }

    .section-heading {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin: 0 0 16px;
    }

    .section-number {
      color: var(--accent);
      font-weight: 900;
      font-size: 14px;
    }

    .section h2 {
      margin: 0;
      font-size: 26px;
      letter-spacing: 0;
    }

    .cards {
      display: grid;
      gap: 12px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
      overflow: hidden;
    }

    .card-head {
      width: 100%;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 10px;
      align-items: center;
      border: 0;
      padding: 15px 18px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .question-card .card-head {
      background: linear-gradient(0deg, #fff, #fff), var(--accent-soft);
    }

    .card-tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      background: var(--accent-soft);
      color: var(--accent-ink);
      font-size: 12px;
      font-weight: 900;
    }

    .topic-card .card-tag {
      background: #eef1f6;
      color: #475467;
    }

    .card-title {
      min-width: 0;
      font-weight: 800;
      line-height: 1.35;
    }

    .chevron {
      color: var(--muted);
      font-size: 18px;
      transform: rotate(0deg);
      transition: transform 120ms ease;
    }

    .card.collapsed .chevron {
      transform: rotate(-90deg);
    }

    .card-body {
      padding: 0 18px 18px;
      color: #2b3547;
    }

    .card.collapsed .card-body {
      display: none;
    }

    p {
      margin: 12px 0 0;
    }

    ul, ol {
      margin: 12px 0 0;
      padding-left: 1.35rem;
    }

    li + li {
      margin-top: 6px;
    }

    blockquote {
      margin: 14px 0 0;
      padding: 12px 14px;
      border-left: 4px solid var(--accent);
      border-radius: 0 var(--radius) var(--radius) 0;
      background: var(--accent-soft);
      color: #1d3264;
      font-weight: 650;
    }

    code {
      border-radius: 5px;
      padding: 2px 5px;
      background: #eef1f6;
      color: #9f1239;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
    }

    .check {
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-right: 8px;
      border: 1.5px solid #98a2b3;
      border-radius: 3px;
      vertical-align: -2px;
    }

    .check.done {
      background: var(--good);
      border-color: var(--good);
    }

    .empty {
      display: none;
      margin: 34px 0;
      padding: 24px;
      border: 1px dashed #b7c3d5;
      border-radius: var(--radius);
      color: var(--muted);
      background: #fff;
      text-align: center;
    }

    @media (max-width: 960px) {
      .layout {
        display: block;
      }

      .sidebar {
        position: relative;
        height: auto;
        padding: 18px 16px;
      }

      .brand {
        margin-bottom: 14px;
      }

      .brand h1 {
        font-size: 20px;
      }

      .source {
        margin-bottom: 14px;
      }

      .nav {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
        scroll-snap-type: x proximity;
      }

      .nav-link {
        min-width: 210px;
        scroll-snap-align: start;
      }

      .toolbar {
        flex-wrap: wrap;
        top: 0;
      }

      .stats {
        width: 100%;
        margin-left: 0;
      }

      .hero {
        padding: 28px 20px 20px;
      }

      .hero h1 {
        font-size: 30px;
      }

      .content {
        padding: 24px 20px 54px;
      }
    }

    @media (max-width: 640px) {
      body {
        font-size: 15px;
        line-height: 1.62;
      }

      .toolbar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 10px 14px;
      }

      .search {
        grid-column: 1 / -1;
        width: 100%;
        padding: 11px 12px;
      }

      .button {
        padding: 10px 8px;
        font-size: 14px;
      }

      #printPage {
        grid-column: 1 / -1;
      }

      .stats {
        grid-column: 1 / -1;
        font-size: 13px;
      }

      .section {
        scroll-margin-top: 170px;
      }

      .section-heading {
        gap: 8px;
        align-items: flex-start;
      }

      .section h2 {
        font-size: 21px;
        line-height: 1.32;
      }

      .card-head {
        grid-template-columns: 1fr auto;
        gap: 8px;
        padding: 14px 14px;
      }

      .card-tag {
        width: fit-content;
      }

      .card-title {
        grid-column: 1 / -1;
        grid-row: 2;
      }

      .chevron {
        grid-column: 2;
        grid-row: 1;
        justify-self: end;
      }

      .card-body {
        padding: 0 14px 16px;
      }

      blockquote {
        padding: 11px 12px;
      }
    }

    @media print {
      body {
        background: #fff;
        font-size: 12px;
        line-height: 1.45;
      }

      .layout {
        display: block;
      }

      .sidebar,
      .toolbar {
        display: none;
      }

      .hero,
      .content {
        padding: 0;
        border: 0;
      }

      .hero h1 {
        font-size: 22px;
      }

      .section {
        break-inside: avoid;
        margin-bottom: 22px;
      }

      .card {
        break-inside: avoid;
        box-shadow: none;
        border-color: #c8ced8;
      }

      .card-body {
        display: block !important;
      }
    }
  </style>
</head>
<body>
  <script id="interview-db" type="application/json">${escapeScriptJson({ source: SOURCE, generatedAt, data })}</script>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <small>Interview DB</small>
        <h1>${escapeHtml(data.title || "면접 준비")}</h1>
      </div>
      <p class="source">원본 DB: <strong>${escapeHtml(basename(SOURCE))}</strong><br>문항 ${questionCount}개 · 섹션 ${data.sections.length}개</p>
      <nav class="nav" aria-label="면접 준비 목차">
        ${sectionNav}
      </nav>
    </aside>
    <main class="main">
      <header class="hero">
        <h1>${escapeHtml(data.title || "면접 준비")}</h1>
        <p>Markdown 파일을 원본 DB로 삼아 정리한 면접 준비 화면입니다. 질문은 검색해서 빠르게 찾고, 카드는 접었다 펼치며 암기용으로 사용할 수 있습니다.</p>
      </header>
      <div class="toolbar">
        <input class="search" id="search" type="search" placeholder="질문, 키워드, 프로젝트명 검색">
        <button class="button" id="expandAll" type="button">전체 펼치기</button>
        <button class="button" id="collapseAll" type="button">전체 접기</button>
        <button class="button" id="printPage" type="button">인쇄</button>
        <div class="stats" id="stats">문항 ${questionCount}개</div>
      </div>
      <div class="content">
        <div class="empty" id="empty">검색 결과가 없습니다.</div>
        ${sectionHtml}
      </div>
    </main>
  </div>
  <script>
    const cards = Array.from(document.querySelectorAll(".card"));
    const sections = Array.from(document.querySelectorAll(".section"));
    const navLinks = Array.from(document.querySelectorAll(".nav-link"));
    const search = document.getElementById("search");
    const stats = document.getElementById("stats");
    const empty = document.getElementById("empty");

    function setCollapsed(card, collapsed) {
      card.classList.toggle("collapsed", collapsed);
      const button = card.querySelector(".card-head");
      if (button) button.setAttribute("aria-expanded", String(!collapsed));
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest(".card-head");
      if (!button) return;
      const card = button.closest(".card");
      setCollapsed(card, !card.classList.contains("collapsed"));
    });

    document.getElementById("expandAll").addEventListener("click", () => {
      cards.forEach((card) => setCollapsed(card, false));
    });

    document.getElementById("collapseAll").addEventListener("click", () => {
      cards.forEach((card) => setCollapsed(card, true));
    });

    document.getElementById("printPage").addEventListener("click", () => window.print());

    function applySearch() {
      const query = search.value.trim().toLowerCase();
      let visibleCards = 0;
      cards.forEach((card) => {
        const hit = !query || card.dataset.search.includes(query);
        card.style.display = hit ? "" : "none";
        if (hit) {
          visibleCards += 1;
          if (query) setCollapsed(card, false);
        }
      });
      sections.forEach((section) => {
        const hasVisible = Array.from(section.querySelectorAll(".card")).some((card) => card.style.display !== "none");
        section.style.display = hasVisible ? "" : "none";
      });
      empty.style.display = visibleCards ? "none" : "block";
      stats.textContent = query ? \`검색 결과 \${visibleCards}개\` : \`문항 ${questionCount}개\`;
    }

    search.addEventListener("input", applySearch);

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === "#" + visible.target.id);
      });
    }, { rootMargin: "-20% 0px -70% 0px", threshold: [0.1, 0.2, 0.4] });

    sections.forEach((section) => observer.observe(section));
  </script>
</body>
</html>
`;

for (const output of OUTPUTS) {
  await writeFile(output, html, "utf8");
}
console.log(`Generated ${OUTPUTS.join(", ")} from ${SOURCE}`);
