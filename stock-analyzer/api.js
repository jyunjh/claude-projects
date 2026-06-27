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

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

function getApiKey() {
  return (localStorage.getItem("fmpKey") || "").trim();
}
function setApiKey(k) {
  localStorage.setItem("fmpKey", (k || "").trim());
}

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (n) => typeof n === "number" && isFinite(n);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
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

  // --- 必須: 株価・時価総額・PER ---
  const quote = (await fetchJson(`${FMP_BASE}/quote/${ticker}?apikey=${key}`))[0];
  const patch = { metrics: {} };
  if (quote) {
    if (isNum(quote.price)) patch.price = round2(quote.price);
    if (isNum(quote.marketCap)) patch.marketCap = Math.round(quote.marketCap / 1e9); // 10億ドル単位
    if (isNum(quote.pe) && quote.pe > 0) patch.metrics.pe = round2(quote.pe);
  }

  // --- 任意: 各種レシオ (失敗してもサンプル維持) ---
  try {
    const r = (await fetchJson(`${FMP_BASE}/ratios-ttm/${ticker}?apikey=${key}`))[0];
    if (r) {
      const dy = r.dividendYieldTTM ?? r.dividendYielTTM; // FMPの表記ゆれに対応
      if (isNum(dy)) patch.metrics.divYield = round2(dy * 100);
      if (isNum(r.returnOnEquityTTM)) patch.metrics.roe = round2(r.returnOnEquityTTM * 100);
      if (isNum(r.debtEquityRatioTTM)) patch.metrics.debtToEquity = round2(r.debtEquityRatioTTM);
      if (isNum(r.priceToBookRatioTTM)) patch.metrics.pb = round2(r.priceToBookRatioTTM);
      if (isNum(r.priceToSalesRatioTTM)) patch.metrics.psales = round2(r.priceToSalesRatioTTM);
      if (isNum(r.netProfitMarginTTM)) patch.metrics.netMargin = round2(r.netProfitMarginTTM * 100);
      if (isNum(r.grossProfitMarginTTM)) patch.metrics.grossMargin = round2(r.grossProfitMarginTTM * 100);
    }
  } catch (e) {
    /* レシオ取得失敗時はサンプル値を維持 */
  }

  // --- 任意: EV/EBITDA・FCF利回り ---
  try {
    const m = (await fetchJson(`${FMP_BASE}/key-metrics-ttm/${ticker}?apikey=${key}`))[0];
    if (m) {
      if (isNum(m.enterpriseValueOverEBITDATTM)) patch.metrics.evEbitda = round2(m.enterpriseValueOverEBITDATTM);
      if (isNum(m.freeCashFlowYieldTTM)) patch.metrics.fcfYield = round2(m.freeCashFlowYieldTTM * 100);
    }
  } catch (e) {
    /* 取得失敗時はサンプル値を維持 */
  }

  patch._liveAt = new Date().toISOString();
  return patch;
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
