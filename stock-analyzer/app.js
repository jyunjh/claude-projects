/*
 * 米国株アナライザー — メインロジック
 * US Stock Analyzer — main logic
 *
 * 投資哲学: 長期・ファンダメンタル重視・コントラリアン
 * Philosophy: long-term, fundamental-focused, contrarian.
 */

let currentLang = localStorage.getItem("lang") || "ja";
let currentSector = "defense"; // 防衛セクター特化から開始 (start specialized on defense)
let currentTicker = "LMT";

// セクターでフィルタした銘柄リスト ("all" は全件)
function stocksInSector(sectorKey) {
  const all = Object.values(SAMPLE_STOCKS);
  return sectorKey === "all" ? all : all.filter((s) => s.sectorKey === sectorKey);
}

const t = (key) => I18N[currentLang][key] || key;
const localized = (obj) => (obj ? obj[currentLang] : "");

/* ---------- 計算ロジック (analysis helpers) ---------- */

// 適正価値に対する上昇/下落余地 (%)
function upsidePct(stock) {
  return ((stock.fairValue - stock.price) / stock.price) * 100;
}

// ファンダメンタルスコア 0-100 を簡易合成
// (バリュエーションの割安さ・収益性・財務健全性・成長から)
function fundamentalScore(stock) {
  const m = stock.metrics;
  let score = 50;

  // バリュエーション: 適正価値より割安ならプラス
  score += clamp(upsidePct(stock) * 0.8, -20, 20);

  // 収益性 (ROE)
  if (m.roe >= 20) score += 12;
  else if (m.roe >= 10) score += 6;
  else if (m.roe < 0) score -= 12;

  // 財務健全性 (負債資本比率: 低いほど良い)
  if (m.debtToEquity < 0.5) score += 8;
  else if (m.debtToEquity > 1.5) score -= 8;

  // FCF利回り (キャッシュ創出力)
  if (m.fcfYield >= 5) score += 8;
  else if (m.fcfYield < 0) score -= 8;

  // 成長
  if (m.revenueGrowth >= 10) score += 6;
  else if (m.revenueGrowth < 0) score -= 6;

  return Math.round(clamp(score, 0, 100));
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// コントラリアン判定: センチメントとファンダメンタルの乖離
function contrarianVerdict(stock) {
  const sentiment = stock.sentiment.sentimentScore;
  const fundamentals = fundamentalScore(stock);
  const gap = fundamentals - sentiment; // 正: 市場が過小評価 (逆張り買い)

  if (gap >= 15) return { type: "green", key: "contrarianBuy", gap };
  if (gap <= -15) return { type: "red", key: "crowdedTrade", gap };
  return { type: "amber", key: "aligned", gap };
}

// 総合投資判断
function recommendation(stock) {
  const up = upsidePct(stock);
  const fund = fundamentalScore(stock);
  const contrarian = contrarianVerdict(stock);

  if (up >= 8 && fund >= 55 && contrarian.type !== "red") {
    return { pill: "green", key: "recBuy" };
  }
  if (up <= -8 || fund < 40) {
    return { pill: "red", key: "recAvoid" };
  }
  return { pill: "amber", key: "recHold" };
}

/* ---------- フォーマット (formatting) ---------- */
const fmt = (n, d = 1) => (n === 0 || n == null ? "—" : n.toFixed(d));
const pct = (n, d = 1) => (n == null ? "—" : `${n > 0 ? "" : ""}${n.toFixed(d)}%`);
const usd = (n) => `$${n.toFixed(2)}`;
const bn = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(2)}T` : `$${n}B`);

/* ---------- レンダリング (rendering) ---------- */

function render() {
  const stock = SAMPLE_STOCKS[currentTicker];

  // 静的UIテキスト
  document.documentElement.lang = currentLang;
  document.getElementById("appTitle").textContent = t("appTitle");
  document.getElementById("appSubtitle").textContent = t("appSubtitle");
  document.getElementById("demoNotice").textContent = t("demoNotice");
  document.getElementById("langBtn").textContent = t("langButton");
  document.getElementById("recDisclaimer").textContent = t("recDisclaimer");
  document.getElementById("recTitle").textContent = t("recommendation");

  renderSectorSelector();
  renderSelector();
  renderOverview(stock);
  renderMetrics(stock);
  renderValuation(stock);
  renderContrarian(stock);
  renderFactors(stock);
  renderSectorPanels(stock);
  renderGuide(stock);
  renderRecommendation(stock);
}

// 利用可能なセクター一覧 (データから動的に生成)
function availableSectors() {
  const keys = [...new Set(Object.values(SAMPLE_STOCKS).map((s) => s.sectorKey))];
  return keys;
}

function renderSectorSelector() {
  const sel = document.getElementById("sectorSelect");
  sel.innerHTML = "";
  // 全セクター
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = t("allSectors");
  if (currentSector === "all") allOpt.selected = true;
  sel.appendChild(allOpt);
  // 個別セクター
  availableSectors().forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    // 特化セクター名は SECTORS から、無ければ代表銘柄の sector ラベルを使う
    const label = SECTORS[key] ? localized(SECTORS[key].name) : sectorLabelFromData(key);
    opt.textContent = SECTORS[key] ? `★ ${label}` : label;
    if (key === currentSector) opt.selected = true;
    sel.appendChild(opt);
  });
}

function sectorLabelFromData(key) {
  const s = stocksInSector(key)[0];
  return s ? localized(s.sector) : key;
}

function renderSelector() {
  const sel = document.getElementById("stockSelect");
  sel.innerHTML = "";
  stocksInSector(currentSector).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.ticker;
    opt.textContent = `${s.ticker} — ${localized(s.name)}`;
    if (s.ticker === currentTicker) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderOverview(stock) {
  const up = upsidePct(stock);
  document.getElementById("overview").innerHTML = `
    <h2>📊 ${t("overview")}</h2>
    <div class="overview-head">
      <div>
        <div class="name">${localized(stock.name)}</div>
        <div class="ticker">${stock.ticker} · ${localized(stock.sector)}</div>
      </div>
      <div class="big-price">${usd(stock.price)}</div>
    </div>
    <div class="kv-grid">
      <div class="kv"><div class="label">${t("fairValue")}</div><div class="value">${usd(stock.fairValue)}</div></div>
      <div class="kv"><div class="label">${up >= 0 ? t("upside") : t("downside")}</div>
        <div class="value" style="color:${up >= 0 ? "var(--green)" : "var(--red)"}">${pct(up)}</div></div>
      <div class="kv"><div class="label">${t("marketCap")}</div><div class="value">${bn(stock.marketCap)}</div></div>
      <div class="kv"><div class="label">${t("sector")}</div><div class="value" style="font-size:0.95rem">${localized(stock.sector)}</div></div>
    </div>`;
}

function renderMetrics(stock) {
  const m = stock.metrics;
  const rows = [
    ["pe", fmt(m.pe), null],
    ["forwardPe", fmt(m.forwardPe), null],
    ["evEbitda", fmt(m.evEbitda), null],
    ["pb", fmt(m.pb, 1), null],
    ["psales", fmt(m.psales, 1), null],
    ["divYield", `${fmt(m.divYield, 2)}%`, m.divYield >= 3 ? "good" : null],
    ["roe", `${fmt(m.roe, 1)}%`, m.roe >= 15 ? "good" : m.roe < 0 ? "bad" : null],
    ["revenueGrowth", `${fmt(m.revenueGrowth, 1)}%`, m.revenueGrowth >= 8 ? "good" : m.revenueGrowth < 0 ? "bad" : null],
    ["grossMargin", `${fmt(m.grossMargin, 1)}%`, null],
    ["netMargin", `${fmt(m.netMargin, 1)}%`, m.netMargin < 0 ? "bad" : null],
    ["debtToEquity", fmt(m.debtToEquity, 2), m.debtToEquity < 0.5 ? "good" : m.debtToEquity > 1.5 ? "bad" : null],
    ["fcfYield", `${fmt(m.fcfYield, 1)}%`, m.fcfYield >= 5 ? "good" : m.fcfYield < 0 ? "bad" : null],
  ];
  document.getElementById("metrics").innerHTML = `
    <h2>🔢 ${t("valuation")} · ${currentLang === "ja" ? "主要指標" : "Key Metrics"}</h2>
    <div class="metrics">
      ${rows.map(([key, val, cls]) => `
        <div class="metric">
          <div class="label">${t(key)}</div>
          <div class="value ${cls || ""}">${val}</div>
        </div>`).join("")}
    </div>`;
}

function renderValuation(stock) {
  const up = upsidePct(stock);
  let msgKey = "fairlyValued", color = "var(--amber)";
  if (up >= 5) { msgKey = "undervalued"; color = "var(--green)"; }
  else if (up <= -5) { msgKey = "overvalued"; color = "var(--red)"; }

  // 価格 vs 適正価値のバー (0% .. 200% of fair value)
  const priceRatio = clamp((stock.price / stock.fairValue) * 50, 0, 100);
  document.getElementById("valuation").innerHTML = `
    <h2>💰 ${t("valuation")}</h2>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:14px">${t("valuationIntro")}</p>
    <div class="bar-row">
      <div class="bar-label"><span>${t("price")}: ${usd(stock.price)}</span><span>${t("fairValue")}: ${usd(stock.fairValue)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${priceRatio}%;background:${color}"></div></div>
    </div>
    <div style="margin-top:12px"><span class="pill ${up >= 5 ? "green" : up <= -5 ? "red" : "amber"}">${t(msgKey)} · ${pct(up)}</span></div>`;
}

function renderContrarian(stock) {
  const fund = fundamentalScore(stock);
  const sentiment = stock.sentiment.sentimentScore;
  const verdict = contrarianVerdict(stock);
  document.getElementById("contrarian").innerHTML = `
    <h2>🔄 ${t("contrarian")}</h2>
    <div class="bar-row">
      <div class="bar-label"><span>${t("marketSentiment")}</span><span>${sentiment}/100</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${sentiment}%;background:var(--accent)"></div></div>
    </div>
    <div class="bar-row">
      <div class="bar-label"><span>${t("fundamentalScore")}</span><span>${fund}/100</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${fund}%;background:var(--green)"></div></div>
    </div>
    <div style="margin-top:12px"><span class="pill ${verdict.type}">${t(verdict.key)}</span></div>`;
}

function renderFactors(stock) {
  document.getElementById("factors").innerHTML = `
    <h2>🎯 ${t("criticalFactors")}</h2>
    <table>
      <thead><tr><th>${t("factor")}</th><th>${t("impact")}</th><th>${t("probability")}</th></tr></thead>
      <tbody>
        ${stock.criticalFactors.map((f) => `
          <tr>
            <td>${localized(f.factor)}</td>
            <td><span class="tag ${f.impact}">${t(f.impact)}</span></td>
            <td>${f.probability}%</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

/* セクター特化パネル: 市場環境 + 特化KPI (defense 等のみ表示) */
function renderSectorPanels(stock) {
  const cfg = SECTORS[stock.sectorKey];
  const envEl = document.getElementById("sectorEnvironment");
  const kpiEl = document.getElementById("sectorKpis");

  // 特化設定が無いセクターはパネルを隠す
  if (!cfg) {
    envEl.hidden = true;
    kpiEl.hidden = true;
    return;
  }
  envEl.hidden = false;
  kpiEl.hidden = false;

  const statusClass = { tailwind: "green", neutral: "amber", headwind: "red" };
  envEl.innerHTML = `
    <h2>🌐 ${localized(cfg.name)} · ${t("sectorEnvironment")}</h2>
    <table>
      <tbody>
        ${cfg.environment.map((e) => `
          <tr>
            <td style="width:30%"><strong>${localized(e.label)}</strong></td>
            <td style="width:14%"><span class="pill ${statusClass[e.status]}" style="font-size:0.78rem">${t(e.status)}</span></td>
            <td><div>${localized(e.reading)}</div><div style="color:var(--text-dim);font-size:0.82rem">${localized(e.why)}</div></td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  // 特化KPI
  const d = stock.defense || {};
  kpiEl.innerHTML = `
    <h2>🛡️ ${localized(cfg.name)} · ${t("sectorKpis")}</h2>
    <div class="metrics">
      ${cfg.kpis.map((k) => {
        const v = d[k.key];
        let display, cls = "";
        if (k.unit === "tag") {
          const lvl = v || "medium";
          return `<div class="metric"><div class="label">${localized(k.label)}</div>
            <div class="value"><span class="tag ${lvl}">${t(lvl)}</span></div></div>`;
        } else if (k.unit === "x") { display = `${fmt(v, 2)}x`; }
        else if (k.unit === "y") { display = `${fmt(v, 1)}`; }
        else { display = `${fmt(v, 0)}%`; }
        if (k.good && k.good(v)) cls = "good";
        else if (k.bad && k.bad(v)) cls = "bad";
        return `<div class="metric"><div class="label">${localized(k.label)}</div>
          <div class="value ${cls}">${display}</div></div>`;
      }).join("")}
    </div>`;
}

/* 見るべきポイント解説: 共通 + セクター特化 (折りたたみ) */
function renderGuide(stock) {
  const cfg = SECTORS[stock.sectorKey];
  const items = [...(cfg ? cfg.guide : []), ...COMMON_GUIDE];
  document.getElementById("guide").innerHTML = `
    <h2>📖 ${t("guide")}</h2>
    ${items.map((g) => `
      <details class="guide-item">
        <summary>${localized(g.term)}</summary>
        <p>${localized(g.desc)}</p>
      </details>`).join("")}`;
}

function renderRecommendation(stock) {
  const rec = recommendation(stock);
  document.getElementById("recPill").className = `pill ${rec.pill}`;
  document.getElementById("recPill").textContent = t(rec.key);
}

/* ---------- イベント (events) ---------- */
function init() {
  document.getElementById("sectorSelect").addEventListener("change", (e) => {
    currentSector = e.target.value;
    // 選択中の銘柄が新セクターに無ければ、そのセクターの先頭銘柄に切り替える
    const list = stocksInSector(currentSector);
    if (!list.some((s) => s.ticker === currentTicker)) {
      currentTicker = list[0].ticker;
    }
    render();
  });
  document.getElementById("stockSelect").addEventListener("change", (e) => {
    currentTicker = e.target.value;
    render();
  });
  document.getElementById("langBtn").addEventListener("click", () => {
    currentLang = currentLang === "ja" ? "en" : "ja";
    localStorage.setItem("lang", currentLang);
    render();
  });
  render();
}

document.addEventListener("DOMContentLoaded", init);
