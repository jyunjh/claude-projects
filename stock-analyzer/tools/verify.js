/*
 * ローカル検証スクリプト (JavaScriptCore / JXA で実行)
 * ----------------------------------------------------
 * node/deno が無い環境でも macOS 標準の osascript だけで動く。
 * API もネットワークも使わないので、何度回してもコスト0。
 *
 * 実行: ./verify.sh   (または osascript -l JavaScript tools/verify.js)
 */
ObjC.import('Foundation');
ObjC.import('stdlib');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null);
  return s.js;
}

var BASE = $.NSString.stringWithString($('./')).stringByStandardizingPath.js + '/';
var FILES = ['data.js', 'snapshot.js', 'i18n.js', 'sectors.js', 'chat.js', 'api.js', 'app.js'];

var fails = [], warns = [], oks = [];
function ok(m) { oks.push('  ✅ ' + m); }
function fail(m) { fails.push('  ❌ ' + m); }
function warn(m) { warns.push('  ⚠️  ' + m); }

/* --- 1. 閉じ括弧の重複検出 (過去に2度混入した実バグ) --- */
FILES.forEach(function (f) {
  var lines = readFile(BASE + f).split('\n');
  for (var i = 1; i < lines.length; i++) {
    // インデントまで完全一致する閉じ括弧が連続している場合のみ重複とみなす
    // (インデントが異なる連続した閉じ括弧は入れ子の正常な終了)
    if (/^\s*\},?\s*$/.test(lines[i]) && lines[i] === lines[i - 1]) {
      fail(f + ':' + (i + 1) + ' 閉じ括弧が重複している可能性 → "' + lines[i].trim() + '" (同一インデントで連続)');
    }
  }
});
if (!fails.length) ok('閉じ括弧の重複なし');

/* --- 2. 全ファイルの構文チェック + グローバル読み込み --- */
var src = '';
FILES.forEach(function (f) { src += readFile(BASE + f) + '\n'; });
var stub = 'var localStorage={getItem:function(){return null;},setItem:function(){},removeItem:function(){}};'
         + 'var document={addEventListener:function(){},getElementById:function(){return null;},documentElement:{}};'
         + 'var fetch=function(){return Promise.resolve();};';

var R;
try {
  R = eval(stub + src + '\n({SAMPLE_STOCKS:SAMPLE_STOCKS,I18N:I18N,SECTORS:SECTORS,COMMON_GUIDE:COMMON_GUIDE,'
      + 'upsidePct:upsidePct,fundamentalScore:fundamentalScore,contrarianVerdict:contrarianVerdict,'
      + 'recommendation:recommendation,buildAnalysisContext:buildAnalysisContext,usd:usd,bn:bn,pct:pct,fmt:fmt,'
      + 'LIVE_SNAPSHOT:LIVE_SNAPSHOT,collectSnapshot:collectSnapshot,liveOverrides:liveOverrides})');
  ok('構文チェック: ' + FILES.length + 'ファイル読込成功');
} catch (e) {
  fail('構文エラー: ' + e);
  console.log(renderReport());
  $.exit(1);
}

var S = R.SAMPLE_STOCKS, I = R.I18N, SEC = R.SECTORS;
var tickers = Object.keys(S);

/* --- 3. 必須フィールドの存在 --- */
var REQUIRED = ['ticker', 'sectorKey', 'name', 'sector', 'marketCap', 'metrics', 'sentiment', 'criticalFactors'];
tickers.forEach(function (t) {
  REQUIRED.forEach(function (k) {
    if (S[t][k] === undefined) fail(t + ': 必須フィールド "' + k + '" が無い');
  });
  if (S[t].ticker !== t) fail(t + ': キーと ticker が不一致 (' + S[t].ticker + ')');
  if (!S[t].criticalFactors || !S[t].criticalFactors.length) fail(t + ': criticalFactors が空');
  ['name', 'sector'].forEach(function (k) {
    if (S[t][k] && (!S[t][k].en || !S[t][k].ja)) fail(t + ': ' + k + ' の en/ja が欠落');
  });
});
ok('必須フィールド: ' + tickers.length + '銘柄すべて充足');

/* --- 4. データ方針: 財務数値を推測で埋めていないか --- */
// price があるのに fairValue が無い / その逆は設計上OK。ただし price は「実データ由来」であるべき。
var priced = tickers.filter(function (t) { return S[t].price != null; });
var unpriced = tickers.filter(function (t) { return S[t].price == null; });
ok('株価あり ' + priced.length + '銘柄 / 未取得(null) ' + unpriced.length + '銘柄');
unpriced.forEach(function (t) {
  var m = S[t].metrics || {};
  var filled = Object.keys(m).filter(function (k) { return m[k] != null; });
  if (filled.length) fail(t + ': 株価が未取得なのに財務指標が入っている(推測値の疑い) → ' + filled.join(','));
});
if (!unpriced.length || fails.length === 0) ok('未取得銘柄に推測の財務指標なし');

/* --- 5. 未取得銘柄が投資判断を捏造しないこと --- */
unpriced.forEach(function (t) {
  if (R.fundamentalScore(S[t]) !== null) fail(t + ': 株価が無いのにファンダスコアが算出されている');
  if (R.recommendation(S[t]).key !== 'recPending') fail(t + ': 株価が無いのに投資判断が出ている');
});
if (unpriced.length) ok('未取得' + unpriced.length + '銘柄: 判定保留 (捏造なし)');

/* --- 6. 株価あり銘柄は判定が算出できること --- */
priced.forEach(function (t) {
  if (S[t].fairValue == null) { warn(t + ': 株価はあるが適正価値が未設定 → 判定保留になる'); return; }
  var f = R.fundamentalScore(S[t]);
  if (f === null || isNaN(f)) fail(t + ': ファンダスコアが算出できない');
  var rec = R.recommendation(S[t]).key;
  if (['recBuy', 'recHold', 'recAvoid'].indexOf(rec) < 0) fail(t + ': 想定外の判定 ' + rec);
});
ok('株価あり銘柄: 判定が正常に算出');

/* --- 7. セクター整合性 --- */
var usedSectors = {};
tickers.forEach(function (t) { usedSectors[S[t].sectorKey] = true; });
Object.keys(SEC).forEach(function (key) {
  var cfg = SEC[key];
  if (!cfg.name || !cfg.name.en || !cfg.name.ja) fail('SECTORS.' + key + ': name の en/ja が欠落');
  if (!cfg.kpis || !cfg.kpis.length) fail('SECTORS.' + key + ': kpis が空');
  if (!cfg.environment || !cfg.environment.length) fail('SECTORS.' + key + ': environment が空');
  if (!usedSectors[key]) warn('SECTORS.' + key + ': 定義はあるが該当銘柄が無い');
  // KPIが参照するフィールドが銘柄側にあるか
  var members = tickers.filter(function (t) { return S[t].sectorKey === key; });
  cfg.kpis.forEach(function (kpi) {
    var present = members.filter(function (t) { return (S[t][key] || {})[kpi.key] !== undefined; });
    if (!present.length) fail('SECTORS.' + key + ': KPI "' + kpi.key + '" を持つ銘柄が1つも無い');
    var validUnits = ['%', 'x', 'y', 'tag', 'i18n'];
    if (validUnits.indexOf(kpi.unit) < 0) fail('SECTORS.' + key + ': KPI "' + kpi.key + '" の unit が不正 (' + kpi.unit + ')');
  });
  // 特化セクターの銘柄は sectorKey と同名のデータブロックを持つべき
  members.forEach(function (t) {
    if (!S[t][key]) fail(t + ': セクター特化データ "' + key + '" ブロックが無い');
  });
});
ok('セクター定義: ' + Object.keys(SEC).join(', ') + ' すべて整合');

/* --- 8. i18n キーの網羅 (tag/i18n 型の値 + 環境statusが両言語にあるか) --- */
var needKeys = {};
Object.keys(SEC).forEach(function (key) {
  SEC[key].kpis.forEach(function (kpi) {
    if (kpi.unit !== 'tag' && kpi.unit !== 'i18n') return;
    tickers.filter(function (t) { return S[t].sectorKey === key; }).forEach(function (t) {
      var v = (S[t][key] || {})[kpi.key];
      if (v != null) needKeys[v] = true;
    });
  });
  SEC[key].environment.forEach(function (e) { needKeys[e.status] = true; });
});
var missing = Object.keys(needKeys).filter(function (k) { return !I.ja[k] || !I.en[k]; });
if (missing.length) fail('i18n未定義キー: ' + missing.join(', '));
else ok('i18nキー: 参照される' + Object.keys(needKeys).length + 'キーすべて両言語で定義済み');

// ja/en のキー差分
var jaOnly = Object.keys(I.ja).filter(function (k) { return I.en[k] === undefined; });
var enOnly = Object.keys(I.en).filter(function (k) { return I.ja[k] === undefined; });
if (jaOnly.length) warn('日本語のみのキー: ' + jaOnly.join(', '));
if (enOnly.length) warn('英語のみのキー: ' + enOnly.join(', '));
if (!jaOnly.length && !enOnly.length) ok('i18n: ja/en のキーが完全一致');

/* --- 9. フォーマッタの null 安全 --- */
var nullSafe = (R.usd(null) === '—') && (R.bn(null) === '—') && (R.pct(null) === '—') && (R.fmt(null) === '—');
if (nullSafe) ok('フォーマッタ: null安全 (usd/bn/pct/fmt)');
else fail('フォーマッタが null で "—" を返さない');

/* --- 10. メンター文脈が全銘柄でクラッシュしないこと --- */
var ctxErr = 0;
tickers.forEach(function (t) {
  try {
    var c = R.buildAnalysisContext(S[t]);
    if (!c || c.indexOf(t) < 0) { fail(t + ': メンター文脈にティッカーが含まれない'); ctxErr++; }
  } catch (e) { fail(t + ': メンター文脈の生成に失敗 — ' + e); ctxErr++; }
});
if (!ctxErr) ok('メンター文脈: ' + tickers.length + '銘柄すべて生成成功');

/* --- 11. snapshot.js に手書きの分析が混入していないこと ---
 * snapshot.js は自動生成の「市場データ」。collectSnapshot() が誤って
 * data.js と合成後の銘柄から集めると、手書きの推定値が焼き付き、
 * しかも snapshot 層は data.js より優先されるため静かに上書きしてしまう。
 * 各プロバイダが実際に返しうる項目だけに限定されているかを検査する。
 */
var FINNHUB_KEYS = ['pe', 'pb', 'psales', 'roe', 'netMargin', 'grossMargin',
                    'divYield', 'revenueGrowth', 'debtToEquity'];
var FMP_EXTRA = ['evEbitda', 'fcfYield'];
var snapTickers = Object.keys(R.LIVE_SNAPSHOT || {});
var leaked = 0;
snapTickers.forEach(function (t) {
  var entry = R.LIVE_SNAPSHOT[t];
  var provs = entry._providers || '';
  var allowed = FINNHUB_KEYS.slice();
  if (provs.indexOf('fmp') >= 0) allowed = allowed.concat(FMP_EXTRA);
  Object.keys(entry.metrics || {}).forEach(function (k) {
    if (allowed.indexOf(k) < 0) {
      fail('snapshot.js: ' + t + '.' + k + ' は取得元(' + (provs || 'なし') + ')が返さない値 — 手書きの混入');
      leaked++;
    }
  });
  if (entry.price != null && !entry._liveAt) {
    fail('snapshot.js: ' + t + ' に _liveAt が無い'); leaked++;
  }
});
if (!leaked) {
  ok(snapTickers.length
    ? 'snapshot: ' + snapTickers.length + '銘柄すべて取得値のみ (手書きの混入なし)'
    : 'snapshot: 空 (検査対象なし)');
}

/* --- 出力 --- */
function renderReport() {
  var out = ['', '━━━ stock-analyzer ローカル検証 ━━━', ''];
  out = out.concat(oks);
  if (warns.length) { out.push(''); out.push('【警告】'); out = out.concat(warns); }
  if (fails.length) { out.push(''); out.push('【失敗】'); out = out.concat(fails); }
  out.push('');
  out.push(fails.length ? '結果: ❌ 失敗 ' + fails.length + '件 / 警告 ' + warns.length + '件'
                        : '結果: ✅ 全チェック合格 (警告 ' + warns.length + '件)');
  out.push('');
  return out.join('\n');
}
console.log(renderReport());
if (fails.length) $.exit(1);
