/*
 * 最新データ取得レイヤー (Live data layer)
 * ----------------------------------------------------
 * 複数の無料APIを併用して最新の株価・指標を取得します。
 *
 *   Finnhub (優先) — 60call/分・日次上限なし。株価 + 基本ファンダメンタルズ。
 *   FMP      (補完) — 無料プランでは quote が402になるため、日次終値とレシオを担当。
 *
 * 方針:
 * - 先に応答したプロバイダの値を優先し、後続は「空いている項目だけ」を埋める。
 * - 取れなかった項目は null のまま。推測値では埋めない（判定を汚さないため）。
 * - APIキーはブラウザの localStorage に保存（個人利用向け）。
 * - どのプロバイダも株価を返せなかった場合のみ、その銘柄を失敗として扱う。
 */

const FMP_BASE = "https://financialmodelingprep.com/stable";
const FINNHUB_BASE = "https://finnhub.io/api/v1";

const KEY_STORE = { fmp: "fmpKey", finnhub: "finnhubKey" };
// 優先順。Finnhub の無料枠のほうが広いため先に試す。
const PROVIDER_ORDER = ["finnhub", "fmp"];

function getKey(provider) {
  return (localStorage.getItem(KEY_STORE[provider]) || "").trim();
}
function setKey(provider, value) {
  localStorage.setItem(KEY_STORE[provider], (value || "").trim());
}
function hasAnyKey() {
  return PROVIDER_ORDER.some((p) => !!getKey(p));
}
// 後方互換 (既存の呼び出し元は FMP キーを指す)
function getApiKey() {
  return getKey("fmp");
}
function setApiKey(k) {
  setKey("fmp", k);
}

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (n) => typeof n === "number" && isFinite(n);

/*
 * プロバイダ間でフィールド名に表記ゆれがある (pb / pbAnnual / pbQuarterly 等)。
 * 候補名を順に探し、最初に見つかった有限数だけを採用する。
 * 見つからなければ null = 未取得。推測で埋めない。
 */
function pick(obj, names, scale = 1) {
  if (!obj) return null;
  for (const n of names) {
    const v = obj[n];
    if (isNum(v)) return round2(v * scale);
  }
  return null;
}

/* patch.metrics に「まだ空の項目だけ」を書き込む */
function putMetric(patch, key, value) {
  if (value != null && patch.metrics[key] == null) patch.metrics[key] = value;
}

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

/* ============================ Finnhub ============================
 * 無料枠: 60call/分・日次上限なし。米国株のリアルタイム株価と
 * 基本ファンダメンタルズ (stock/metric) が使える。
 * ローソク足 (stock/candle) は有料なので、チャートは FMP 側が担当。
 *
 * 単位の前提: marketCapitalization は百万ドル。利益率・ROE・配当利回り・
 * 増収率は「％で表現済み」(例 ROE 25.5 = 25.5%)。debtToEquity は倍率。
 */
async function finnhubPatch(ticker) {
  const key = getKey("finnhub");
  if (!key) return null;
  const patch = { metrics: {} };
  const errors = [];

  try {
    const q = await fetchJson(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`);
    // 未知のティッカーでもエラーにはならず c:0 が返るため、0は無効として扱う。
    if (isNum(q.c) && q.c > 0) {
      patch.price = round2(q.c);
      patch._priceSource = "quote";
    } else {
      errors.push("Finnhub: ティッカー未認識または株価なし");
    }
  } catch (e) {
    errors.push("Finnhub quote: " + e.message);
  }

  try {
    const res = await fetchJson(`${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${key}`);
    const m = res && res.metric;
    if (m) {
      const cap = pick(m, ["marketCapitalization"]);
      if (cap != null) patch.marketCap = Math.round(cap / 100) / 10; // 百万 → 10億ドル
      putMetric(patch, "pe", pick(m, ["peTTM", "peBasicExclExtraTTM", "peNormalizedAnnual"]));
      putMetric(patch, "pb", pick(m, ["pbQuarterly", "pbAnnual", "pb"]));
      putMetric(patch, "psales", pick(m, ["psTTM", "psAnnual", "ps"]));
      putMetric(patch, "roe", pick(m, ["roeTTM", "roeRfy", "roeAnnual"]));
      putMetric(patch, "netMargin", pick(m, ["netProfitMarginTTM", "netProfitMarginAnnual"]));
      putMetric(patch, "grossMargin", pick(m, ["grossMarginTTM", "grossMarginAnnual"]));
      putMetric(patch, "divYield", pick(m, ["dividendYieldIndicatedAnnual", "currentDividendYieldTTM"]));
      putMetric(patch, "revenueGrowth", pick(m, ["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy", "revenueGrowth5Y"]));
      putMetric(patch, "debtToEquity", pick(m, [
        "totalDebt/totalEquityQuarterly", "totalDebt/totalEquityAnnual",
        "totalDebtToEquityQuarterly", "totalDebtToEquityAnnual", "totalDebtToEquity",
      ]));
      // EV/EBITDA と FCF利回りは基本ファンダメンタルズに含まれないため未取得のまま。
    }
  } catch (e) {
    errors.push("Finnhub metric: " + e.message);
  }

  if (patch.price == null && !Object.keys(patch.metrics).length && patch.marketCap == null) {
    throw new Error(errors[0] || "Finnhub: 取得できませんでした");
  }
  return patch;
}

/* ============================== FMP ==============================
 * 無料プランでは quote / ratios-ttm / key-metrics-ttm が 402
 * (Exclusive Endpoint) になることがある。日次終値は使えるので、
 * 株価のフォールバックとチャートを担当する。
 */
async function fmpPatch(ticker) {
  const key = getKey("fmp");
  if (!key) return null;
  const q = (s) => `${FMP_BASE}/${s}?symbol=${encodeURIComponent(ticker)}&apikey=${key}`;
  const patch = { metrics: {} };
  const errors = [];

  try {
    const quote = (await fetchJson(q("quote")))[0];
    if (quote) {
      if (isNum(quote.price)) {
        patch.price = round2(quote.price);
        patch._priceSource = "quote";
      }
      if (isNum(quote.marketCap)) patch.marketCap = Math.round(quote.marketCap / 1e8) / 10; // 10億ドル単位
    }
  } catch (e) {
    errors.push(e.message);
  }

  // quote が使えないプランでも、日次終値なら取れることが多い。
  if (patch.price == null) {
    try {
      const hist = await fetchPriceHistory(ticker, 10);
      const last = hist[hist.length - 1];
      if (last && isNum(last.price)) {
        patch.price = round2(last.price);
        patch._priceSource = "eod"; // 終値ベース (リアルタイムではない)
        patch._priceAsOf = last.date;
      }
    } catch (e) {
      errors.push(e.message);
    }
  }

  // レシオ類はベストエフォート。失敗しても他プロバイダ/サンプル値を維持。
  try {
    const r = (await fetchJson(q("ratios-ttm")))[0];
    if (r) {
      const pe = pick(r, ["priceToEarningsRatioTTM"]);
      putMetric(patch, "pe", pe != null && pe > 0 ? pe : null);
      putMetric(patch, "divYield", pick(r, ["dividendYieldTTM"], 100));
      putMetric(patch, "debtToEquity", pick(r, ["debtToEquityRatioTTM"]));
      putMetric(patch, "pb", pick(r, ["priceToBookRatioTTM"]));
      putMetric(patch, "psales", pick(r, ["priceToSalesRatioTTM"]));
      putMetric(patch, "netMargin", pick(r, ["netProfitMarginTTM"], 100));
      putMetric(patch, "grossMargin", pick(r, ["grossProfitMarginTTM"], 100));
    }
  } catch (e) {
    /* サンプル値を維持 */
  }

  try {
    const m = (await fetchJson(q("key-metrics-ttm")))[0];
    if (m) {
      putMetric(patch, "evEbitda", pick(m, ["evToEBITDATTM"]));
      putMetric(patch, "roe", pick(m, ["returnOnEquityTTM"], 100));
      putMetric(patch, "fcfYield", pick(m, ["freeCashFlowYieldTTM"], 100));
    }
  } catch (e) {
    /* サンプル値を維持 */
  }

  if (patch.price == null && !Object.keys(patch.metrics).length && patch.marketCap == null) {
    throw new Error(errors[0] || "FMP: 取得できませんでした");
  }
  return patch;
}

const PROVIDER_FETCH = { finnhub: finnhubPatch, fmp: fmpPatch };

/*
 * 1銘柄の最新データを取得し、サンプルに重ねる「差分(patch)」を返す。
 * 優先順にプロバイダを回し、先に取れた値を優先。後続は空欄だけを埋める。
 */
async function fetchLiveStock(ticker) {
  if (!hasAnyKey()) throw new Error("NO_KEY");

  const merged = { metrics: {} };
  const used = [];
  const errors = [];

  for (const name of PROVIDER_ORDER) {
    if (!getKey(name)) continue;
    let patch;
    try {
      patch = await PROVIDER_FETCH[name](ticker);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      continue;
    }
    if (!patch) continue;

    let contributed = false;
    // 株価の出所メタデータは株価と一体。先に別プロバイダが株価を取っていれば捨てる。
    const priceMeta = ["_priceSource", "_priceAsOf"];
    const takesPrice = merged.price == null && patch.price != null;
    Object.keys(patch).forEach((k) => {
      if (k === "metrics") return;
      if (priceMeta.includes(k) && !takesPrice) return;
      if (merged[k] == null && patch[k] != null) {
        merged[k] = patch[k];
        contributed = true;
      }
    });
    Object.keys(patch.metrics).forEach((k) => {
      if (merged.metrics[k] == null && patch.metrics[k] != null) {
        merged.metrics[k] = patch.metrics[k];
        contributed = true;
      }
    });
    if (contributed) used.push(name);
  }

  if (merged.price == null) throw new Error(errors.join(" / ") || "株価を取得できませんでした");

  merged._liveAt = new Date().toISOString();
  merged._providers = used.join("+");
  return merged;
}

/* 過去株価 (日次終値) を取得。古い順の [{date, price}] を返す。
 * Finnhub のローソク足は有料のため、これは FMP 専用。 */
async function fetchPriceHistory(ticker, fromDays = 365) {
  const key = getKey("fmp");
  if (!key) throw new Error("NO_KEY");
  const from = new Date(Date.now() - fromDays * 864e5).toISOString().slice(0, 10);
  const arr = await fetchJson(
    `${FMP_BASE}/historical-price-eod/light?symbol=${encodeURIComponent(ticker)}&from=${from}&apikey=${key}`
  );
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
