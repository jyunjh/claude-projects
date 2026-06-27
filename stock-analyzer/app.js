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
let currentView = "detail"; // "detail" | "compare"

// 個別分析ビューを構成するセクション (compare モードでは隠す)
const DETAIL_SECTIONS = [
  "overview", "contrarian", "chart", "sectorEnvironment", "sectorKpis",
  "metrics", "valuation", "factors", "guide", "recommendation",
];

// API取得した最新値の差分 (ticker -> patch)。サンプルに重ねて使う。
let liveOverrides = {};
// 過去株価のキャッシュ (ticker -> [{date, price}])。APIから遅延取得。
let historyCache = {};
// データバーの一時メッセージ ("refreshing" | "error" | null)
let dataMessage = null;

// サンプル + 最新差分をマージした銘柄オブジェクトを返す
function getStock(ticker) {
  const base = SAMPLE_STOCKS[ticker];
  const ov = liveOverrides[ticker];
  if (!ov) return base;
  return {
    ...base,
    ...ov,
    metrics: { ...base.metrics, ...(ov.metrics || {}) },
    _liveAt: ov._liveAt,
  };
}

// セクターでフィルタした銘柄リスト ("all" は全件)。最新差分を反映。
function stocksInSector(sectorKey) {
  const all = Object.keys(SAMPLE_STOCKS).map(getStock);
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
  const stock = getStock(currentTicker);

  // 静的UIテキスト
  document.documentElement.lang = currentLang;
  document.getElementById("appTitle").textContent = t("appTitle");
  document.getElementById("appSubtitle").textContent = t("appSubtitle");
  document.getElementById("demoNotice").textContent = t("demoNotice").replace("{date}", DATA_AS_OF);
  document.getElementById("langBtn").textContent = t("langButton");
  document.getElementById("recDisclaimer").textContent = t("recDisclaimer");
  document.getElementById("recTitle").textContent = t("recommendation");
  document.getElementById("viewBtn").textContent = currentView === "detail" ? t("viewCompare") : t("viewDetail");
  renderDataBar(stock);

  renderSectorSelector();
  renderSelector();
  renderOverview(stock);
  renderMetrics(stock);
  renderValuation(stock);
  renderContrarian(stock);
  renderFactors(stock);
  renderChart(stock);
  renderSectorPanels(stock);
  renderGuide(stock);
  renderRecommendation(stock);
  renderCompare();
  applyView();
  maybeLoadHistory(currentTicker);
}

// キーがあり未取得なら、過去株価を遅延取得してチャートだけ再描画
function maybeLoadHistory(ticker) {
  if (!getApiKey() || historyCache[ticker]) return;
  fetchPriceHistory(ticker)
    .then((hist) => {
      if (hist && hist.length > 1) {
        historyCache[ticker] = hist;
        // 取得中に銘柄が変わっていなければチャートを更新
        if (ticker === currentTicker && currentView === "detail") renderChart(getStock(ticker));
      }
    })
    .catch(() => { /* 失敗時はサンプル系列のまま */ });
}

// 決定論的なサンプル系列 (ticker をシードに、現在株価へ収束する週次52本)
function sampleHistory(stock) {
  const n = 52;
  let seed = [...stock.ticker].reduce((a, c) => a + c.charCodeAt(0), 0) + 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const prices = [stock.price];
  for (let i = 1; i < n; i++) prices.push(prices[i - 1] * (1 + (rand() - 0.5) * 0.06));
  prices.reverse(); // 末尾が現在株価
  const today = Date.now();
  return prices.map((p, i) => ({
    date: new Date(today - (n - 1 - i) * 7 * 864e5).toISOString().slice(0, 10),
    price: Math.round(p * 100) / 100,
  }));
}

// ビュー切り替え: 個別分析セクション群 ⇄ 横比較ビューの表示制御
function applyView() {
  const compare = currentView === "compare";
  DETAIL_SECTIONS.forEach((id) => {
    // detail モードでは inline display を消し、セクターパネルの hidden 属性を尊重する
    document.getElementById(id).style.display = compare ? "none" : "";
  });
  document.getElementById("compareView").style.display = compare ? "" : "none";
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

/* 株価チャート (SVG自前描画 / 適正価値ラインを重ねる) */
function renderChart(stock) {
  const live = !!historyCache[stock.ticker];
  const hist = live ? historyCache[stock.ticker] : sampleHistory(stock);
  const prices = hist.map((d) => d.price);
  const fv = stock.fairValue;

  const W = 760, H = 260, padL = 6, padR = 6, padT = 18, padB = 26;
  const lo = Math.min(...prices, fv), hi = Math.max(...prices, fv);
  const range = hi - lo || 1;
  const X = (i) => padL + (i / (hist.length - 1)) * (W - padL - padR);
  const Y = (p) => padT + (1 - (p - lo) / range) * (H - padT - padB);

  const linePts = hist.map((d, i) => `${X(i).toFixed(1)},${Y(d.price).toFixed(1)}`).join(" ");
  const areaPts = `${X(0).toFixed(1)},${(H - padB)} ${linePts} ${X(hist.length - 1).toFixed(1)},${(H - padB)}`;
  const up = prices[prices.length - 1] >= prices[0];
  const color = up ? "var(--green)" : "var(--red)";
  const fvY = Y(fv).toFixed(1);

  const seriesHi = Math.max(...prices), seriesLo = Math.min(...prices);
  const cur = prices[prices.length - 1];
  const firstDate = hist[0].date, lastDate = hist[hist.length - 1].date;
  const sourceTag = live ? t("chartLive") : t("chartSample");

  document.getElementById("chart").innerHTML = `
    <h2>📈 ${t("priceChart")}
      <span class="src-tag ${live ? "live" : ""}">${sourceTag}</span>
    </h2>
    <div class="chart-legend">
      <span>${t("price")}: <strong>${usd(cur)}</strong></span>
      <span style="color:var(--green)">${t("chartHigh")}: ${usd(seriesHi)}</span>
      <span style="color:var(--red)">${t("chartLow")}: ${usd(seriesLo)}</span>
      <span style="color:var(--amber)">— ${t("chartFairValue")}: ${usd(fv)}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="price-chart" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${up ? "rgba(52,211,153,0.28)" : "rgba(248,113,113,0.28)"}"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
      </defs>
      <polygon points="${areaPts}" fill="url(#grad)" />
      <polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" />
      <line x1="${padL}" y1="${fvY}" x2="${W - padR}" y2="${fvY}"
        stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="6 5" opacity="0.85" />
    </svg>
    <div class="chart-axis"><span>${firstDate}</span><span>${lastDate}</span></div>`;
}

/* 最新データ更新バー (静的テキスト + ステータス) */
function renderDataBar(stock) {
  document.getElementById("refreshLabel").textContent =
    dataMessage === "refreshing" ? t("refreshing") : t("refresh");
  document.getElementById("refreshBtn").disabled = dataMessage === "refreshing";
  document.getElementById("keyToggle").textContent = `⚙️ ${t("apiSettings")}`;
  document.getElementById("saveKeyBtn").textContent = t("saveKey");
  document.getElementById("getKeyLink").textContent = t("getKey");
  document.getElementById("liveNote").textContent = t("liveNote");
  document.getElementById("apiKeyInput").placeholder = t("apiKeyPlaceholder");

  // ステータス表示
  const el = document.getElementById("dataStatus");
  el.className = "data-status";
  if (dataMessage === "refreshing") {
    el.textContent = t("refreshing");
  } else if (dataMessage === "error") {
    el.textContent = t("dataError");
    el.classList.add("error");
  } else if (dataMessage === "keySaved") {
    el.textContent = t("keySaved");
    el.classList.add("live");
  } else if (stock._liveAt) {
    const time = new Date(stock._liveAt).toLocaleString(currentLang === "ja" ? "ja-JP" : "en-US");
    el.textContent = t("dataLive").replace("{time}", time);
    el.classList.add("live");
  } else {
    el.textContent = t("dataSample");
  }
}

/* 「最新に更新」: 現在セクターの全銘柄をAPI取得し、サンプルに重ねる */
async function updateLiveData() {
  if (!getApiKey()) {
    // キー未設定: 設定パネルを開いて促す
    document.getElementById("keyBox").open = true;
    document.getElementById("apiKeyInput").focus();
    const el = document.getElementById("dataStatus");
    el.className = "data-status error";
    el.textContent = t("noKeyMsg");
    return;
  }
  dataMessage = "refreshing";
  render();
  const tickers = stocksInSector(currentSector).map((s) => s.ticker);
  try {
    const { ok, failed } = await fetchLiveStocks(tickers);
    Object.assign(liveOverrides, ok);
    dataMessage = failed.length === tickers.length ? "error" : null;
  } catch (e) {
    dataMessage = "error";
  }
  render();
}

function saveApiKey() {
  const input = document.getElementById("apiKeyInput");
  setApiKey(input.value);
  input.value = "";
  if (getApiKey()) {
    dataMessage = "keySaved";
    document.getElementById("keyBox").open = false;
  }
  render();
}

/* グループ内 横比較ビュー */
function renderCompare() {
  const stocks = stocksInSector(currentSector);
  const cfg = SECTORS[currentSector]; // 防衛など特化セクターのみ

  // 比較する行 (dir: "up"=高いほど良い, "down"=低いほど良い, "info"=優劣なし)
  const rows = [
    { label: t("price"), dir: "info", val: (s) => ({ n: s.price, d: usd(s.price) }) },
    { label: t("fairValue"), dir: "info", val: (s) => ({ n: s.fairValue, d: usd(s.fairValue) }) },
    { label: t("upsideShort"), dir: "up", val: (s) => { const u = upsidePct(s); return { n: u, d: pct(u) }; } },
    { label: t("pe"), dir: "down", val: (s) => peVal(s.metrics.pe) },
    { label: t("forwardPe"), dir: "down", val: (s) => peVal(s.metrics.forwardPe) },
    { label: t("evEbitda"), dir: "down", val: (s) => ({ n: s.metrics.evEbitda, d: fmt(s.metrics.evEbitda) }) },
    { label: t("divYield"), dir: "up", val: (s) => ({ n: s.metrics.divYield, d: `${fmt(s.metrics.divYield, 2)}%` }) },
    { label: t("roe"), dir: "up", val: (s) => ({ n: s.metrics.roe, d: `${fmt(s.metrics.roe, 1)}%` }) },
    { label: t("revenueGrowth"), dir: "up", val: (s) => ({ n: s.metrics.revenueGrowth, d: `${fmt(s.metrics.revenueGrowth, 1)}%` }) },
    { label: t("fcfYield"), dir: "up", val: (s) => ({ n: s.metrics.fcfYield, d: `${fmt(s.metrics.fcfYield, 1)}%` }) },
    { label: t("debtToEquity"), dir: "down", val: (s) => ({ n: s.metrics.debtToEquity, d: fmt(s.metrics.debtToEquity, 2) }) },
    { label: t("fundamentalScore"), dir: "up", val: (s) => { const f = fundamentalScore(s); return { n: f, d: `${f}/100` }; } },
    { label: t("marketSentiment"), dir: "info", val: (s) => ({ n: s.sentiment.sentimentScore, d: `${s.sentiment.sentimentScore}/100` }) },
    { label: t("gap"), dir: "up", val: (s) => { const g = Math.round(contrarianVerdict(s).gap); return { n: g, d: `${g > 0 ? "+" : ""}${g}` }; } },
  ];

  // 防衛セクター特化のKPI行を追加
  if (cfg) {
    rows.push(
      { label: localize2(cfg, "bookToBill", "Book-to-Bill", "受注/売上比率"), dir: "up", val: (s) => ({ n: s.defense.bookToBill, d: `${fmt(s.defense.bookToBill, 2)}x` }) },
      { label: currentLang === "ja" ? "受注残高(年)" : "Backlog (yrs)", dir: "up", val: (s) => ({ n: s.defense.backlogYears, d: fmt(s.defense.backlogYears, 1) }) },
      { label: currentLang === "ja" ? "海外売上比率" : "International %", dir: "up", val: (s) => ({ n: s.defense.internationalPct, d: `${s.defense.internationalPct}%` }) },
    );
  }

  // 各行で最良値のインデックスを求める
  rows.forEach((row) => {
    if (row.dir === "info") { row.best = []; return; }
    const vals = stocks.map((s) => row.val(s).n);
    const target = row.dir === "up" ? Math.max(...vals) : Math.min(...vals);
    row.best = vals.map((v, i) => (v === target && isFinite(v) ? i : -1)).filter((i) => i >= 0);
  });

  const header = `<th>${t("compareMetric")}</th>` +
    stocks.map((s) => `<th>${s.ticker}<div style="font-weight:400;color:var(--text-dim);font-size:0.75rem">${localized(s.name)}</div></th>`).join("");

  const body = rows.map((row) => {
    const cells = stocks.map((s, i) => {
      const cell = row.val(s);
      const isBest = row.best.includes(i);
      return `<td class="${isBest ? "best" : ""}">${isBest ? "★ " : ""}${cell.d}</td>`;
    }).join("");
    return `<tr><td class="metric-name">${row.label}</td>${cells}</tr>`;
  }).join("");

  // 判定行 (コントラリアン / 投資判断) — ピルで表示、優劣ハイライトなし
  const verdictRow = (label, fn) =>
    `<tr><td class="metric-name">${label}</td>${stocks.map((s) => `<td>${fn(s)}</td>`).join("")}</tr>`;
  const contrarianCell = (s) => { const v = contrarianVerdict(s); return `<span class="pill ${v.type}" style="font-size:0.72rem">${t(v.key).split(":")[0]}</span>`; };
  const recCell = (s) => { const r = recommendation(s); return `<span class="pill ${r.pill}" style="font-size:0.72rem">${t(r.key).split(/[—-]/)[0].trim()}</span>`; };

  document.getElementById("compareView").innerHTML = `
    <h2>📋 ${t("compareTitle")}${cfg ? " · " + localized(cfg.name) : ""}</h2>
    <p style="color:var(--text-dim);font-size:0.82rem;margin-bottom:12px">${t("compareBestHint")}</p>
    <div style="overflow-x:auto">
      <table class="compare">
        <thead><tr>${header}</tr></thead>
        <tbody>
          ${body}
          ${verdictRow(t("contrarian"), contrarianCell)}
          ${verdictRow(t("recShort"), recCell)}
        </tbody>
      </table>
    </div>`;
}

// PER の特殊処理: 0 や負値は N/A 扱い (ランキングから除外)
function peVal(pe) {
  return pe > 0 ? { n: pe, d: fmt(pe) } : { n: Infinity, d: "—" };
}

// セクターKPIラベルの簡易ローカライズ補助
function localize2(cfg, key, en, ja) {
  const k = cfg.kpis.find((x) => x.key === key);
  return k ? localized(k.label) : currentLang === "ja" ? ja : en;
}

function renderRecommendation(stock) {
  const rec = recommendation(stock);
  document.getElementById("recPill").className = `pill ${rec.pill}`;
  document.getElementById("recPill").textContent = t(rec.key);
}

/* ---------- イベント (events) ---------- */
function init() {
  document.getElementById("sectorSelect").addEventListener("change", (e) => {
    dataMessage = null;
    currentSector = e.target.value;
    // 選択中の銘柄が新セクターに無ければ、そのセクターの先頭銘柄に切り替える
    const list = stocksInSector(currentSector);
    if (!list.some((s) => s.ticker === currentTicker)) {
      currentTicker = list[0].ticker;
    }
    render();
  });
  document.getElementById("stockSelect").addEventListener("change", (e) => {
    dataMessage = null;
    currentTicker = e.target.value;
    render();
  });
  document.getElementById("viewBtn").addEventListener("click", () => {
    dataMessage = null;
    currentView = currentView === "detail" ? "compare" : "detail";
    render();
  });
  document.getElementById("refreshBtn").addEventListener("click", updateLiveData);
  document.getElementById("saveKeyBtn").addEventListener("click", saveApiKey);
  document.getElementById("langBtn").addEventListener("click", () => {
    currentLang = currentLang === "ja" ? "en" : "ja";
    localStorage.setItem("lang", currentLang);
    render();
  });
  render();
}

document.addEventListener("DOMContentLoaded", init);
