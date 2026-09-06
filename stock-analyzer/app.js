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
// メンター相談チャットの履歴と状態
let chatMessages = []; // [{role:"user"|"assistant", content}]
let chatBusy = false;
// データバーの一時メッセージ ("refreshing" | "error" | "partial" | null)
let dataMessage = null;
// 直近の失敗理由 (診断用にそのまま画面へ出す)
let dataDetail = "";
// 古いHTMLがキャッシュされている疑い (期待する要素が見つからない)
let staleHtml = false;

/*
 * 銘柄データは3層で重ねる:
 *   1. SAMPLE_STOCKS  … 手書き (仮説・KPI・重要ファクター・適正価値)
 *   2. LIVE_SNAPSHOT  … 保存済みの市場データ (snapshot.js / 自動生成)
 *   3. liveOverrides  … 今セッションでAPI取得した最新値
 * 上の層ほど優先。市場データだけが上書きされ、手書きの分析は保持される。
 */
// API取得層のみ (2, 3)。手書きの data.js は含まない。
function liveLayers(ticker) {
  const layers = [];
  if (typeof LIVE_SNAPSHOT !== "undefined" && LIVE_SNAPSHOT[ticker]) layers.push(LIVE_SNAPSHOT[ticker]);
  if (liveOverrides[ticker]) layers.push(liveOverrides[ticker]);
  return layers;
}

// 層を1つの patch に畳み込む (後の層が優先)
function flattenLayers(layers) {
  const out = { metrics: {} };
  layers.forEach((layer) => {
    Object.keys(layer).forEach((k) => {
      if (k === "metrics") Object.assign(out.metrics, layer.metrics);
      else out[k] = layer[k];
    });
  });
  return out;
}

// 1〜3層を合成しただけの銘柄。バリュエーションは載せない。
// ピア統計はこれを使う (適正価値の算出が自分自身を参照する循環を避けるため)。
function rawStock(ticker) {
  const base = SAMPLE_STOCKS[ticker];
  const layers = liveLayers(ticker);
  if (!layers.length) return base;
  const live = flattenLayers(layers);
  const merged = { ...base, ...live };
  merged.metrics = { ...base.metrics, ...live.metrics };
  return merged;
}

// ピア統計のキャッシュ (セクター単位)。取得データが変わったら clearValuationCache()。
let peerStatsCache = {};
function clearValuationCache() { peerStatsCache = {}; }

function peerStatsFor(sectorKey, selfTicker) {
  const cacheKey = sectorKey + "|" + selfTicker;
  if (!peerStatsCache[cacheKey]) {
    const peers = Object.keys(SAMPLE_STOCKS)
      .map(rawStock)
      .filter((s) => s.sectorKey === sectorKey && s.price != null);
    peerStatsCache[cacheKey] = buildPeerStats(peers, selfTicker);
  }
  return peerStatsCache[cacheKey];
}

/*
 * 表示用の銘柄。適正価値が手書きされていなければ、同業ピアを
 * レファレンス・クラスとしてアウトサイド・ビューで算出する (valuation.js)。
 * 手書きの fairValue があれば、それが常に勝つ。機械は上書きしない。
 */
function getStock(ticker) {
  const stock = rawStock(ticker);
  if (stock.fairValue != null) return { ...stock, _fairValueSource: "manual" };

  const val = computeFairValue(stock, peerStatsFor(stock.sectorKey, ticker), stock.inside);
  if (!val) return stock;
  return { ...stock, fairValue: val.fairValue, _fairValueSource: "auto", _valuation: val };
}

/*
 * snapshot.js へ保存する市場データを収集。
 * 必ず「API取得層だけ」から集める。getStock() は data.js と合成済みなので
 * 使ってはいけない（手書きの推定値が自動生成ファイルに焼き付いてしまう）。
 */
function collectSnapshot() {
  const snap = {};
  Object.keys(SAMPLE_STOCKS).forEach((tk) => {
    const layers = liveLayers(tk);
    if (!layers.length) return;
    const live = flattenLayers(layers);
    if (live.price == null || !live._liveAt) return; // 取得済みのものだけ

    const m = {};
    Object.keys(live.metrics).forEach((k) => { if (live.metrics[k] != null) m[k] = live.metrics[k]; });
    snap[tk] = { price: live.price, metrics: m, _liveAt: live._liveAt };
    if (live.marketCap != null) snap[tk].marketCap = live.marketCap;
    ["_priceSource", "_priceAsOf", "_providers"].forEach((k) => {
      if (live[k]) snap[tk][k] = live[k];
    });
  });
  return snap;
}

// ローカルサーバー(serve.py)へ保存を依頼
async function saveSnapshot() {
  const snap = collectSnapshot();
  const el = document.getElementById("dataStatus");
  if (!Object.keys(snap).length) {
    el.className = "data-status error";
    el.textContent = t("saveNothing");
    return;
  }
  try {
    const res = await fetch("/api/save-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
    const j = await res.json();
    el.className = "data-status " + (j.ok ? "live" : "error");
    el.textContent = j.ok ? t("saveOk").replace("{n}", j.count) : t("saveFail") + " — " + (j.error || res.status);
  } catch (e) {
    // 素の http.server で開いていると保存エンドポイントが無い
    el.className = "data-status error";
    el.textContent = t("saveFail") + " — " + t("saveNeedsServer");
  }
}

// セクターでフィルタした銘柄リスト ("all" は全件)。最新差分を反映。
function stocksInSector(sectorKey) {
  const all = Object.keys(SAMPLE_STOCKS).map(getStock);
  return sectorKey === "all" ? all : all.filter((s) => s.sectorKey === sectorKey);
}

const t = (key) => I18N[currentLang][key] || key;

/*
 * 要素が見つからなくても描画を止めないための setter。
 * ブラウザに古い index.html が残っていると render() が途中で例外になり、
 * 「更新中…」のまま無言で固まる事故が起きたため。
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return !!el;
}
function setPlaceholder(id, text) {
  const el = document.getElementById(id);
  if (el) el.placeholder = text;
  return !!el;
}
const localized = (obj) => (obj ? obj[currentLang] : "");

/* ---------- 計算ロジック (analysis helpers) ---------- */

// 市場データ(株価)が揃っているか。未取得の新規カバレッジ銘柄は false。
function hasPrice(stock) { return stock.price != null; }
// 適正価値(アナリスト自身の推定)が設定されているか
function hasFairValue(stock) { return stock.fairValue != null; }

// 適正価値に対する上昇/下落余地 (%)。どちらか欠けていれば null。
function upsidePct(stock) {
  if (!hasPrice(stock) || !hasFairValue(stock)) return null;
  return ((stock.fairValue - stock.price) / stock.price) * 100;
}

// ファンダメンタルスコア 0-100 を簡易合成
// (バリュエーションの割安さ・収益性・財務健全性・成長から)
function fundamentalScore(stock) {
  const up = upsidePct(stock);
  // 株価も適正価値も無い銘柄はスコアを出さない (未取得を"中立"と偽らない)
  if (up === null) return null;
  const m = stock.metrics;
  let score = 50;

  // バリュエーション: 適正価値より割安ならプラス
  score += clamp(up * 0.8, -20, 20);

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
  if (fundamentals === null) return { type: "amber", key: "pendingData", gap: null };
  const gap = fundamentals - sentiment; // 正: 市場が過小評価 (逆張り買い)

  if (gap >= 15) return { type: "green", key: "contrarianBuy", gap };
  if (gap <= -15) return { type: "red", key: "crowdedTrade", gap };
  return { type: "amber", key: "aligned", gap };
}

// 総合投資判断
function recommendation(stock) {
  const up = upsidePct(stock);
  const fund = fundamentalScore(stock);
  if (up === null || fund === null) return { pill: "amber", key: "recPending" };
  // 適正価値が機械算出なら、判定は暫定。手で置いた適正価値と同列に見せない。
  const provisional = stock._fairValueSource === "auto";
  const contrarian = contrarianVerdict(stock);

  let out;
  if (up >= 8 && fund >= 55 && contrarian.type !== "red") out = { pill: "green", key: "recBuy" };
  else if (up <= -8 || fund < 40) out = { pill: "red", key: "recAvoid" };
  else out = { pill: "amber", key: "recHold" };

  if (provisional) {
    out.provisional = true;
    // 未検証の点推定を、確定判断と同じ色で出さない
    out.pill = "amber";
  }
  return out;
}

/* ---------- フォーマット (formatting) ---------- */
const fmt = (n, d = 1) => (n === 0 || n == null ? "—" : n.toFixed(d));
const pct = (n, d = 1) => (n == null ? "—" : `${n > 0 ? "" : ""}${n.toFixed(d)}%`);
const usd = (n) => (n == null ? "—" : `$${n.toFixed(2)}`);
const bn = (n) => (n == null ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(2)}T` : `$${n}B`);

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
  renderChat();
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
      <div class="big-price">${usd(stock.price)}${stock._priceSource === "eod" ? `<span class="src-tag">${t("eodPrice")}${stock._priceAsOf ? " " + stock._priceAsOf : ""}</span>` : ""}</div>
    </div>
    <div class="kv-grid">
      <div class="kv"><div class="label">${t("fairValue")}</div><div class="value">${usd(stock.fairValue)}</div></div>
      <div class="kv"><div class="label">${up === null ? t("upside") : up >= 0 ? t("upside") : t("downside")}</div>
        <div class="value" style="color:${up === null ? "var(--text-dim)" : up >= 0 ? "var(--green)" : "var(--red)"}">${pct(up)}</div></div>
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
  // 株価または適正価値が未設定なら、判定せず必要な操作を案内する
  if (up === null) {
    document.getElementById("valuation").innerHTML = `
      <h2>💰 ${t("valuation")}</h2>
      <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:14px">${t("valuationIntro")}</p>
      <div class="pending-box">
        <div>${!hasPrice(stock) ? t("needPrice") : ""}</div>
        <div>${!hasFairValue(stock) ? t("needFairValue") : ""}</div>
      </div>`;
    return;
  }
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
    <div style="margin-top:12px"><span class="pill ${up >= 5 ? "green" : up <= -5 ? "red" : "amber"}">${t(msgKey)} · ${pct(up)}</span></div>
    ${renderValuationBasis(stock)}`;
}

/*
 * 適正価値の根拠。機械算出のときだけ出す。
 * 点推定だけを見せず、各法の結果・ピア倍率とその四分位・母数・
 * 市場が今当てている相対倍率、そして方法の限界(警告)まで並べる。
 */
function renderValuationBasis(stock) {
  if (stock._fairValueSource !== "auto" || !stock._valuation) {
    return stock._fairValueSource === "manual"
      ? `<p class="key-note">${t("fvManual")}</p>` : "";
  }
  const v = stock._valuation;
  const rows = v.methods.map((m) => `
    <tr>
      <td>${t(m.labelKey)}</td>
      <td>${fmt(m.perShare, 2)}</td>
      <td>${fmt(m.multiple, 1)}x</td>
      <td>${m.q1 == null ? "—" : `${fmt(m.q1, 1)}–${fmt(m.q3, 1)}`}</td>
      <td>${usd(m.value)}</td>
    </tr>`).join("");

  const caveats = (v.caveats || []).map((c) => {
    if (c.dir === "spread") return `<li>${t("caveatSpread").replace("{ratio}", c.ratio)}</li>`;
    const driver = t("kpi_" + c.driver) || c.driver;
    const method = t("method_" + c.method);
    const msg = c.dir === "negative"
      ? t("caveatNegative") : c.dir === "below" ? t("caveatBelow") : t("caveatAbove");
    return `<li>${msg
      .replace("{driver}", driver)
      .replace("{own}", fmt(c.own, 1))
      .replace("{peer}", fmt(c.peer, 1))
      .replace("{method}", method)}</li>`;
  }).join("");

  return `
    <details class="guide-item" style="margin-top:14px">
      <summary>${t("fvBasis")} — ${t("fvAuto")}</summary>
      <p>${t("fvOutsideView")}</p>
      <table>
        <tr><th>${t("fvMethod")}</th><th>${t("fvPerShare")}</th><th>${t("fvMultiple")}</th><th>${t("fvIqr")}</th><th>${t("fvResult")}</th></tr>
        ${rows}
      </table>
      <p>${t("fvRange").replace("{low}", usd(v.low)).replace("{high}", usd(v.high))}</p>
      <p>${t("fvMarketRelative").replace("{rel}", v.marketRelative == null ? "—" : fmt(v.marketRelative, 2))}</p>
      ${caveats ? `<p style="color:var(--amber);margin-top:10px"><strong>${t("fvCaveats")}</strong></p><ul style="color:var(--amber);font-size:0.84rem;padding-left:18px">${caveats}</ul>` : ""}
      <p style="margin-top:10px">${t("fvInsideView")}</p>
    </details>`;
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
      <div class="bar-label"><span>${t("fundamentalScore")}</span><span>${fund === null ? "—" : fund + "/100"}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${fund === null ? 0 : fund}%;background:var(--green)"></div></div>
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

  // 特化KPI (セクター固有データは stock[sectorKey] に格納)
  const d = stock[stock.sectorKey] || {};
  kpiEl.innerHTML = `
    <h2>${cfg.icon || "🛡️"} ${localized(cfg.name)} · ${t("sectorKpis")}</h2>
    <div class="metrics">
      ${cfg.kpis.map((k) => {
        const v = d[k.key];
        // 未取得の項目は "—" (推測で埋めない)
        if (v === undefined || v === null) {
          return `<div class="metric"><div class="label">${localized(k.label)}</div>
            <div class="value" style="color:var(--text-dim)">—</div></div>`;
        }
        let display, cls = "";
        if (k.unit === "tag") {
          return `<div class="metric"><div class="label">${localized(k.label)}</div>
            <div class="value"><span class="tag ${v}">${t(v)}</span></div></div>`;
        } else if (k.unit === "i18n") {
          return `<div class="metric"><div class="label">${localized(k.label)}</div>
            <div class="value"><span class="tag low">${t(v)}</span></div></div>`;
        } else if (k.unit === "x") { display = `${fmt(v, 2)}x`; }
        else if (k.unit === "y") { display = `${fmt(v, 1)}`; }
        else { display = `${fmt(v, 0)}%`; }
        if (k.good && k.good(v)) cls = "good";
        else if (k.bad && k.bad(v)) cls = "bad";
        return `<div class="metric"><div class="label">${localized(k.label)}</div>
          <div class="value ${cls}">${display}</div></div>`;
      }).join("")}
    </div>
    ${stock.thesis ? `<div class="thesis-note"><strong>${t("thesisLabel")}</strong>${localized(stock.thesis)}</div>` : ""}`;
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
  if (!hasPrice(stock)) {
    document.getElementById("chart").innerHTML = `
      <h2>📈 ${t("priceChart")}</h2>
      <div class="pending-box">${t("needPrice")}</div>`;
    return;
  }
  const live = !!historyCache[stock.ticker];
  const hist = live ? historyCache[stock.ticker] : sampleHistory(stock);
  const prices = hist.map((d) => d.price);
  const fv = stock.fairValue;

  const W = 760, H = 260, padL = 6, padR = 6, padT = 18, padB = 26;
  const scaleVals = fv == null ? prices : [...prices, fv];
  const lo = Math.min(...scaleVals), hi = Math.max(...scaleVals);
  const range = hi - lo || 1;
  const X = (i) => padL + (i / (hist.length - 1)) * (W - padL - padR);
  const Y = (p) => padT + (1 - (p - lo) / range) * (H - padT - padB);

  const linePts = hist.map((d, i) => `${X(i).toFixed(1)},${Y(d.price).toFixed(1)}`).join(" ");
  const areaPts = `${X(0).toFixed(1)},${(H - padB)} ${linePts} ${X(hist.length - 1).toFixed(1)},${(H - padB)}`;
  const up = prices[prices.length - 1] >= prices[0];
  const color = up ? "var(--green)" : "var(--red)";
  const fvY = fv == null ? null : Y(fv).toFixed(1);

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
      ${fv == null ? "" : `<span style="color:var(--amber)">— ${t("chartFairValue")}: ${usd(fv)}</span>`}
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
      ${fvY === null ? "" : `<line x1="${padL}" y1="${fvY}" x2="${W - padR}" y2="${fvY}"
        stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="6 5" opacity="0.85" />`}
    </svg>
    <div class="chart-axis"><span>${firstDate}</span><span>${lastDate}</span></div>`;
}

/* 最新データ更新バー (静的テキスト + ステータス) */
function renderDataBar(stock) {
  document.getElementById("refreshLabel").textContent =
    dataMessage === "refreshing" ? t("refreshing") : t("refresh");
  document.getElementById("refreshBtn").disabled = dataMessage === "refreshing";
  document.getElementById("saveSnapLabel").textContent = t("saveSnapshot");
  setText("keyToggle", `⚙️ ${t("apiSettings")}`);
  setText("saveKeyBtn", t("saveKey"));
  setText("getKeyLink", t("getKey"));
  setText("liveNote", t("liveNote"));
  setPlaceholder("apiKeyInput", t("apiKeyPlaceholder"));
  setText("getFinnhubLink", t("getFinnhubKey"));
  // 古いHTMLがキャッシュされていると Finnhub 欄が存在しない。その場合は再読込を促す。
  if (!setPlaceholder("finnhubKeyInput", t("finnhubPlaceholder"))) staleHtml = true;

  // ステータス表示
  const el = document.getElementById("dataStatus");
  el.className = "data-status";
  if (dataMessage === "refreshing") {
    el.textContent = t("refreshing");
  } else if (dataMessage === "error") {
    el.textContent = t("dataError") + (dataDetail ? " — " + dataDetail : "");
    el.classList.add("error");
  } else if (dataMessage === "partial") {
    el.textContent = t("dataPartialFail") + (dataDetail ? " — " + dataDetail : "");
    el.classList.add("error");
  } else if (staleHtml) {
    el.textContent = t("staleHtml");
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
  if (!hasAnyKey()) {
    // キー未設定: 設定パネルを開いて促す
    document.getElementById("keyBox").open = true;
    document.getElementById("finnhubKeyInput").focus();
    const el = document.getElementById("dataStatus");
    el.className = "data-status error";
    el.textContent = t("noKeyMsg");
    return;
  }
  dataMessage = "refreshing";
  safeRender();
  const tickers = stocksInSector(currentSector).map((s) => s.ticker);
  dataDetail = "";
  try {
    const { ok, failed } = await fetchLiveStocks(tickers);
    Object.assign(liveOverrides, ok);
    clearValuationCache(); // ピアの倍率が変わったので統計を作り直す
    if (failed.length) {
      // 失敗理由をそのまま見せる (原因が分からないと直せないため)
      const reasons = [...new Set(failed.map((f) => f.reason || "unknown"))];
      dataDetail = `${failed.length}/${tickers.length}件失敗 — ${failed.slice(0, 3).map((f) => f.ticker).join(", ")}${failed.length > 3 ? "…" : ""} : ${reasons[0]}`;
    }
    dataMessage = failed.length === tickers.length ? "error" : failed.length ? "partial" : null;
  } catch (e) {
    dataMessage = "error";
    dataDetail = String(e && e.message ? e.message : e);
  }
  // 描画で例外が出ても「更新中…」のまま固まらせない
  if (dataMessage === "refreshing") dataMessage = null;
  safeRender();
}

/* render() の例外を握りつぶさず、画面に出す。無言で止まるのが一番たちが悪い。 */
function safeRender() {
  try {
    render();
  } catch (e) {
    const el = document.getElementById("dataStatus");
    if (el) {
      el.className = "data-status error";
      el.textContent = t("renderError") + " — " + (e && e.message ? e.message : e);
    }
    throw e;
  }
}

function saveApiKey() {
  // 空欄は「変更なし」。片方だけ入力したときに、もう片方を消さないため。
  [["fmp", "apiKeyInput"], ["finnhub", "finnhubKeyInput"]].forEach(([provider, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.value.trim()) setKey(provider, el.value);
    el.value = "";
  });
  if (hasAnyKey()) {
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

  // セクター特化KPIを汎用的に追加。数値は優劣判定つき、tag/i18n はテキスト行として並べる
  // (スクリーニング用途ではモデル区分やIP強度の横並びこそが要点になるため)
  if (cfg) {
    cfg.kpis.forEach((k) => {
      const isText = k.unit === "tag" || k.unit === "i18n";
      rows.push({
        label: localized(k.label),
        dir: isText ? "info" : k.good ? "up" : "info",
        val: (s) => {
          const v = (s[s.sectorKey] || {})[k.key];
          if (v === undefined || v === null) return { n: NaN, d: "—" };
          if (isText) return { n: NaN, d: t(v) };
          const suffix = k.unit === "x" ? "x" : k.unit === "y" ? "" : "%";
          const dec = k.unit === "x" ? 2 : k.unit === "y" ? 1 : 0;
          return { n: v, d: `${fmt(v, dec)}${suffix}` };
        },
      });
    });
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

/* ---------- メンター相談チャット ---------- */

// 現在の画面分析を、モデルに渡すテキストスナップショットに変換
function buildAnalysisContext(stock) {
  const m = stock.metrics;
  const up = upsidePct(stock);
  const fund = fundamentalScore(stock);
  const v = contrarianVerdict(stock);
  const rec = recommendation(stock);
  const verdictText = { contrarianBuy: "contrarian opportunity (weak sentiment, solid fundamentals)", crowdedTrade: "crowded trade (strong sentiment, stretched fundamentals)", aligned: "sentiment and fundamentals aligned", pendingData: "not yet assessable — market data / fair value missing" };
  const recText = { recBuy: "BUY", recHold: "HOLD", recAvoid: "AVOID", recPending: "NOT RATED (awaiting price / fair value)" };

  const lines = [
    `Ticker: ${stock.ticker} — ${stock.name.en} | Sector: ${stock.sector.en}`,
    `Price ${usd(stock.price)} | Fair value ${usd(stock.fairValue)} (${
      stock._fairValueSource === "auto" ? "MACHINE ESTIMATE from peer multiples, outside view only" : "analyst's own estimate"
    }) | Upside to fair value ${pct(up)}`,
    `Valuation: P/E ${fmt(m.pe)}, fwd P/E ${fmt(m.forwardPe)}, EV/EBITDA ${fmt(m.evEbitda)}, P/B ${fmt(m.pb, 1)}, P/S ${fmt(m.psales, 1)}, dividend yield ${fmt(m.divYield, 2)}%`,
    `Quality & growth: ROE ${fmt(m.roe, 1)}%, revenue growth ${fmt(m.revenueGrowth, 1)}%, net margin ${fmt(m.netMargin, 1)}%, debt/equity ${fmt(m.debtToEquity, 2)}, FCF yield ${fmt(m.fcfYield, 1)}%`,
    `Market sentiment ${stock.sentiment.sentimentScore}/100 (analyst rating: ${stock.sentiment.analystRating}) vs fundamental score ${fund === null ? "n/a" : fund + "/100"} → ${verdictText[v.key]}${v.gap === null ? "" : " (gap " + Math.round(v.gap) + ")"}`,
    `Model's overall read: ${recText[rec.key]}`,
  ];
  // セクター特化KPI (SECTORS の定義から汎用的に組み立て)
  const cfg = SECTORS[stock.sectorKey];
  const sd = stock[stock.sectorKey];
  if (cfg && sd) {
    const kpiText = cfg.kpis
      .map((k) => {
        const val = sd[k.key];
        if (val === undefined || val === null) return `${k.label.en}: not disclosed`;
        // タグ系(i18nキー)は英語ラベルに解決してからモデルへ渡す
        if (k.unit === "i18n" || k.unit === "tag") return `${k.label.en}: ${I18N.en[val] || val}`;
        const suffix = k.unit === "%" ? "%" : k.unit === "x" ? "x" : k.unit === "y" ? " yrs" : "";
        return `${k.label.en}: ${val}${suffix}`;
      })
      .join(", ");
    lines.push(`${cfg.name.en}-sector KPIs: ${kpiText}`);
  }
  if (stock.thesis) lines.push(`Structural note: ${stock.thesis.en}`);
  lines.push("Critical Factors (EPIC): " + stock.criticalFactors.map((f) => `${f.factor.en} [impact ${f.impact}, probability ${f.probability}%]`).join("; "));
  // 機械算出の適正価値を「確定した目標株価」として扱わせない
  if (stock._fairValueSource === "auto" && stock._valuation) {
    const v = stock._valuation;
    lines.push(
      `Valuation basis: outside view only — peer-median multiples at a relative multiple of ${v.relMultiple}. ` +
      `Methods: ${v.methods.map((m) => `${m.key} ${m.multiple}x -> ${usd(m.value)}`).join("; ")}. ` +
      `Cross-check range ${usd(v.low)}-${usd(v.high)}. ` +
      `Market currently applies ${v.marketRelative == null ? "n/a" : v.marketRelative + "x"} vs peers.`
    );
    if (v.caveats && v.caveats.length) {
      lines.push("Valuation caveats (peer multiple may not apply): " + v.caveats.map((c) =>
        `${c.driver} ${c.own} vs peer median ${c.peer} (${c.dir}) -> ${c.method} distorted`).join("; "));
    }
    lines.push("IMPORTANT: this fair value is a mechanical starting point, not a price target. " +
      "Do not present the resulting verdict as a conclusion. Guide the user toward setting the inside view " +
      "(earnings-power adjustment and the premium/discount the stock deserves) with reasons.");
  }
  lines.push(`Data status: ${stock._liveAt ? "live, as of " + new Date(stock._liveAt).toISOString().slice(0, 10) : "sample/snapshot data (not real-time)"}${stock._priceSource === "eod" ? " (price = daily close" + (stock._priceAsOf ? " " + stock._priceAsOf : "") + ", not intraday)" : ""}`);
  return lines.join("\n");
}

function renderChat() {
  document.getElementById("mentorTitle").textContent = t("mentorTitle");
  document.getElementById("mentorSub").textContent = t("mentorSub");
  document.getElementById("chatSend").textContent = chatBusy ? t("chatThinking") : t("chatSend");
  document.getElementById("chatSend").disabled = chatBusy;
  document.getElementById("chatInput").placeholder = t("chatPlaceholder");
  document.getElementById("anthropicKeyToggle").textContent = `⚙️ ${t("aiSettings")}`;
  document.getElementById("anthropicSaveBtn").textContent = t("saveKey");
  document.getElementById("anthropicGetKey").textContent = t("aiGetKey");
  document.getElementById("anthropicKeyInput").placeholder = t("aiKeyPlaceholder");
  document.getElementById("mentorDisclaimer").textContent = t("mentorDisclaimer");

  // 質問サジェスト
  const sug = document.getElementById("chatSuggests");
  sug.innerHTML = "";
  ["chatSuggest1", "chatSuggest2", "chatSuggest3"].forEach((k) => {
    const b = document.createElement("button");
    b.className = "suggest-chip";
    b.textContent = t(k);
    b.addEventListener("click", () => { if (!chatBusy) { document.getElementById("chatInput").value = t(k); sendChat(); } });
    sug.appendChild(b);
  });

  renderChatLog();
}

function renderChatLog() {
  const log = document.getElementById("chatLog");
  log.innerHTML = "";
  if (chatMessages.length === 0) {
    const w = document.createElement("div");
    w.className = "chat-msg assistant";
    w.textContent = t("chatWelcome");
    log.appendChild(w);
  }
  chatMessages.forEach((msg, i) => {
    const el = document.createElement("div");
    el.className = `chat-msg ${msg.role}`;
    // ストリーミング中の最後のアシスタントメッセージに目印を付ける
    if (chatBusy && msg.role === "assistant" && i === chatMessages.length - 1) el.id = "chatStreaming";
    el.textContent = msg.content || (chatBusy ? "…" : "");
    log.appendChild(el);
  });
  log.scrollTop = log.scrollHeight;
}

function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || chatBusy) return;

  if (!getAiKey()) {
    document.getElementById("anthropicKeyBox").open = true;
    document.getElementById("anthropicKeyInput").focus();
    const log = document.getElementById("chatLog");
    const note = document.createElement("div");
    note.className = "chat-msg note";
    note.textContent = t("chatNoKey");
    log.appendChild(note);
    log.scrollTop = log.scrollHeight;
    return;
  }

  chatMessages.push({ role: "user", content: text });
  input.value = "";
  const assistant = { role: "assistant", content: "" };
  chatMessages.push(assistant);
  chatBusy = true;
  renderChat();

  const stock = getStock(currentTicker);
  const system = mentorSystemPrompt(currentLang, buildAnalysisContext(stock));
  // API履歴は user/assistant のみ (note は除外)。末尾の空アシスタントも除く。
  const apiMessages = chatMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .map((m) => ({ role: m.role, content: m.content }));

  streamMentorChat({
    system,
    messages: apiMessages,
    onDelta: (chunk) => {
      assistant.content += chunk;
      const el = document.getElementById("chatStreaming");
      if (el) { el.textContent = assistant.content; el.parentElement.scrollTop = el.parentElement.scrollHeight; }
    },
    onNotice: (type, a, b) => {
      let text = "";
      if (type === "switch") text = t("chatSwitched").replace("{from}", a).replace("{to}", b);
      else if (type === "recovered") text = t("chatRecovered").replace("{model}", a);
      if (text) insertChatNote(text);
    },
    onDone: () => { chatBusy = false; renderChat(); },
    onError: (err) => {
      assistant.content = `⚠️ ${t("chatError")}${err && err !== "NO_KEY" ? "（" + err + "）" : ""}`;
      chatBusy = false;
      renderChat();
    },
  });
}

// ストリーミング中のアシスタント吹き出しの直前に、通知ノートを差し込む
function insertChatNote(text) {
  const idx = Math.max(0, chatMessages.length - 1);
  chatMessages.splice(idx, 0, { role: "note", content: text });
  renderChat();
}

function renderRecommendation(stock) {
  const rec = recommendation(stock);
  document.getElementById("recPill").className = `pill ${rec.pill}`;
  document.getElementById("recPill").textContent =
    t(rec.key) + (rec.provisional ? " (" + t("provisional") + ")" : "");
  document.getElementById("recDisclaimer").innerHTML =
    (rec.provisional ? `<span style="color:var(--amber)">${t("provisionalNote")}</span><br>` : "") +
    t("recDisclaimer");
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
  document.getElementById("saveSnapBtn").addEventListener("click", saveSnapshot);
  document.getElementById("saveKeyBtn").addEventListener("click", saveApiKey);

  // メンターチャット (Enterでは送信しない。送信は「送信」ボタンのみ。Enterは改行)
  document.getElementById("chatSend").addEventListener("click", sendChat);
  document.getElementById("anthropicSaveBtn").addEventListener("click", () => {
    const inp = document.getElementById("anthropicKeyInput");
    setAiKey(inp.value);
    inp.value = "";
    if (getAiKey()) document.getElementById("anthropicKeyBox").open = false;
    renderChat();
  });
  document.getElementById("langBtn").addEventListener("click", () => {
    currentLang = currentLang === "ja" ? "en" : "ja";
    localStorage.setItem("lang", currentLang);
    render();
  });
  render();
}

// 予期しない例外も画面に出す (コンソールを開かないと分からない状態を避ける)
if (typeof window !== "undefined") window.addEventListener("error", (ev) => {
  const el = document.getElementById("dataStatus");
  if (!el) return;
  el.className = "data-status error";
  el.textContent = t("renderError") + " — " + (ev.message || "unknown");
}); //

document.addEventListener("DOMContentLoaded", init);
