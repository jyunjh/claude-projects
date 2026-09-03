/*
 * 最新データ取得レイヤー (Live data layer)
 * ----------------------------------------------------
 * 無料API (Financial Modeling Prep) から最新の株価・指標を取得します。
 * - APIキーはブラウザの localStorage に保存 (個人利用向け)。
 * - 取得できた項目だけをサンプルデータに上書きし、取得できない項目
 *   (適正価値・センチメント・重要ファクター等) はサンプル値を維持します。
 * - キーが無い/取得失敗時は呼び出し元がサンプルにフォールバックします。
 *
 * 無料キー取得: https://site.financialmodelingprep.com/developer/docs
 */

// 新しい "stable" エンドポイント (v3レガシーは2025/8で廃止)
const FMP_BASE = "https://financialmodelingprep.com/stable";

function getApiKey() {
  return (localStorage.getItem("fmpKey") || "").trim();
}
function setApiKey(k) {
  localStorage.setItem("fmpKey", (k || "").trim());
}

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (n) => typeof n === "number" && isFinite(n);

// APIの生の応答本文からエラー理由を取り出す。
// FMPは 401/402/403 でも本文に理由 ("Exclusive Endpoint" 等) を返すので、
// ステータスだけでなく本文も拾わないと原因が分からなくなる。
function apiReason(status, body) {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = j["Error Message"] || j.message || j.error || "";
  } catch (_) {
    detail = (body || "").trim().slice(0, 120);
  }
  return "HTTP " + status + (detail ? " — " + detail : "");
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(apiReason(res.status, body));

  let json;
  try {
    json = JSON.parse(body);
  } catch (_) {
    throw new Error("不正な応答 — " + body.trim().slice(0, 80));
  }
  if (json && json["Error Message"]) throw new Error(json["Error Message"]);
  if (Array.isArray(json) && json.length === 0) throw new Error("EMPTY");
  return json;
}

/*
 * 1銘柄の最新データを取得し、サンプルに重ねる「差分(patch)」を返す。
 * quote = 必須 (株価/時価総額/PER)。ratios・key-metrics はベストエフォート。
 */
async function fetchLiveStock(ticker) {
  const key = getApiKey();
  if (!key) throw new Error("NO_KEY");
  const q = (s) => `${FMP_BASE}/${s}?symbol=${ticker}&apikey=${key}`;

  // --- 必須: 株価・時価総額 ---
  // quote は無料プランで 402 (Exclusive Endpoint) になることがある。
  // その場合は日次終値エンドポイントに切り替えて、最低限 株価だけは取る。
  const patch = { metrics: {} };
  let quoteErr = null;
  try {
    const quote = (await fetchJson(q("quote")))[0];
    if (quote) {
      if (isNum(quote.price)) patch.price = round2(quote.price);
      if (isNum(quote.marketCap)) patch.marketCap = Math.round(quote.marketCap / 1e9); // 10億ドル単位
      patch._priceSource = "quote";
    }
  } catch (e) {
    quoteErr = e;
  }

  if (patch.price == null) {
    try {
      const hist = await fetchPriceHistory(ticker, 10);
      const last = hist[hist.length - 1];
      if (last && isNum(last.price)) {
        patch.price = round2(last.price);
        patch._priceSource = "eod";       // 終値ベース (リアルタイムではない)
        patch._priceAsOf = last.date;
      }
    } catch (e) {
      // 終値も取れない = このキーでは株価を取得できない。理由は quote 側を優先して返す。
      throw new Error((quoteErr && quoteErr.message) || e.message);
    }
  }
  if (patch.price == null) throw new Error((quoteErr && quoteErr.message) || "株価を取得できませんでした");

  // --- 任意: 各種レシオ (失敗してもサンプル維持) ---
  try {
    const r = (await fetchJson(q("ratios-ttm")))[0];
    if (r) {
      if (isNum(r.priceToEarningsRatioTTM) && r.priceToEarningsRatioTTM > 0) patch.metrics.pe = round2(r.priceToEarningsRatioTTM);
      if (isNum(r.dividendYieldTTM)) patch.metrics.divYield = round2(r.dividendYieldTTM * 100);
      if (isNum(r.debtToEquityRatioTTM)) patch.metrics.debtToEquity = round2(r.debtToEquityRatioTTM);
      if (isNum(r.priceToBookRatioTTM)) patch.metrics.pb = round2(r.priceToBookRatioTTM);
      if (isNum(r.priceToSalesRatioTTM)) patch.metrics.psales = round2(r.priceToSalesRatioTTM);
      if (isNum(r.netProfitMarginTTM)) patch.metrics.netMargin = round2(r.netProfitMarginTTM * 100);
      if (isNum(r.grossProfitMarginTTM)) patch.metrics.grossMargin = round2(r.grossProfitMarginTTM * 100);
    }
  } catch (e) {
    /* レシオ取得失敗時はサンプル値を維持 */
  }

  // --- 任意: EV/EBITDA・ROE・FCF利回り ---
  try {
    const m = (await fetchJson(q("key-metrics-ttm")))[0];
    if (m) {
      if (isNum(m.evToEBITDATTM)) patch.metrics.evEbitda = round2(m.evToEBITDATTM);
      if (isNum(m.returnOnEquityTTM)) patch.metrics.roe = round2(m.returnOnEquityTTM * 100);
      if (isNum(m.freeCashFlowYieldTTM)) patch.metrics.fcfYield = round2(m.freeCashFlowYieldTTM * 100);
    }
  } catch (e) {
    /* 取得失敗時はサンプル値を維持 */
  }

  patch._liveAt = new Date().toISOString();
  return patch;
}

/* 過去株価 (日次終値) を取得。古い順の [{date, price}] を返す */
async function fetchPriceHistory(ticker, fromDays = 365) {
  const key = getApiKey();
  if (!key) throw new Error("NO_KEY");
  const from = new Date(Date.now() - fromDays * 864e5).toISOString().slice(0, 10);
  const arr = await fetchJson(`${FMP_BASE}/historical-price-eod/light?symbol=${ticker}&from=${from}&apikey=${key}`);
  // API は新しい順。古い順に並べ替えて返す。
  return arr
    .filter((d) => isNum(d.price))
    .map((d) => ({ date: d.date, price: d.price }))
    .reverse();
}

/* 現在のセクターの全銘柄を並列で更新。{ ok: [...], failed: [...] } を返す */
async function fetchLiveStocks(tickers) {
  const results = await Promise.allSettled(tickers.map((tk) => fetchLiveStock(tk)));
  const ok = {}, failed = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") ok[tickers[i]] = res.value;
    else failed.push({ ticker: tickers[i], reason: res.reason && res.reason.message });
  });
  return { ok, failed };
}
