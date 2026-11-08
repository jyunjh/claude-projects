// osascript -l JavaScript tests/test_gas.js <sale-alertの絶対パス>
// Google の実行環境なしで gas/Code.gs を模擬環境で検証する。
ObjC.import('Foundation');
function run(argv) {
  var root = argv[0];
  function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(root + '/' + p, $.NSUTF8StringEncoding, null).js; }
  var G = (0, eval)('this');
  var fails = [], n = 0;
  function eq(a, b, msg) { n++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(msg + ': 実際 ' + JSON.stringify(a) + ' / 期待 ' + JSON.stringify(b)); }
  function ok(c, msg) { n++; if (!c) fails.push(msg); }

  // ───── モック ─────
  var sheets, props, fetchLog, data, triggers;
  function mkSheet(name) {
    var sh = { name: name, values: [], frozen: 0 };
    sh.appendRow = function (r) { sh.values.push(r.slice()); return sh; };
    sh.getDataRange = function () {
      var v = sh.values.length ? sh.values : [['']];
      return { getValues: function () { return v.map(function (r) { return r.slice(); }); } };
    };
    sh.getRange = function (row, col, nr, nc) {
      return {
        setValues: function (vs) {
          vs.forEach(function (r, i) {
            while (sh.values.length < row + i) sh.values.push([]);
            r.forEach(function (c, j) { sh.values[row - 1 + i][col - 1 + j] = c; });
          });
        },
        setValue: function (v) {
          while (sh.values.length < row) sh.values.push([]);
          sh.values[row - 1][col - 1] = v;
        }
      };
    };
    sh.deleteRow = function (r) { sh.values.splice(r - 1, 1); };
    sh.setFrozenRows = function (k) { sh.frozen = k; };
    return sh;
  }
  G.SpreadsheetApp = { getActiveSpreadsheet: function () { return {
    getSheetByName: function (nm) { return sheets[nm] || null; },
    insertSheet: function (nm) { return (sheets[nm] = mkSheet(nm)); }
  }; } };
  G.PropertiesService = { getScriptProperties: function () { return { getProperties: function () {
    var o = {}; Object.keys(props).forEach(function (k) { o[k] = props[k]; }); return o; } }; } };
  function resp(code, text) {
    return { getResponseCode: function () { return code; }, getContentText: function () { return text; },
      getBlob: function () { return { setName: function () { return this; }, getContentType: function () { return 'image/jpeg'; }, getBytes: function () { return [1, 2, 3]; } }; } };
  }
  G.UrlFetchApp = { fetch: function (url, opt) {
    fetchLog.push({ url: url, opt: opt || {} });
    if (url.indexOf('data/stores.json') >= 0) return resp(200, JSON.stringify(data.stores));
    if (url.indexOf('data/sales.json') >= 0) return resp(200, JSON.stringify(data.sales));
    if (url.indexOf('/profile/') >= 0 || url.indexOf('/member/') >= 0) return resp(200, JSON.stringify({ displayName: 'テスト太郎' }));
    return resp(200, '{}');
  } };
  function pad(x, w) { x = String(x); while (x.length < (w || 2)) x = '0' + x; return x; }
  G.Utilities = {
    formatDate: function (d, tz, fmt) {
      var j = new Date(d.getTime() + 9 * 3600000);
      var map = { yyyy: pad(j.getUTCFullYear(), 4), yy: pad(j.getUTCFullYear() % 100), MM: pad(j.getUTCMonth() + 1), M: String(j.getUTCMonth() + 1),
        dd: pad(j.getUTCDate()), d: String(j.getUTCDate()), HH: pad(j.getUTCHours()), mm: pad(j.getUTCMinutes()), ss: pad(j.getUTCSeconds()),
        u: String(j.getUTCDay() === 0 ? 7 : j.getUTCDay()) };
      return fmt.replace(/yyyy|yy|MM|M|dd|d|HH|mm|ss|u/g, function (t) { return map[t]; });
    },
    getUuid: function () { var s = ''; for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; },
    base64Encode: function (b) { return 'b64:' + b.length; }
  };
  G.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: function (s) { return { content: s, setMimeType: function () { return this; } }; } };
  G.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  G.ScriptApp = {
    getProjectTriggers: function () { return []; }, deleteTrigger: function () {},
    newTrigger: function (fn) { var t = { fn: fn }; var self = { timeBased: function () { return self; }, atHour: function () { return self; },
      everyDays: function () { return self; }, inTimezone: function () { return self; }, create: function () { triggers.push(t.fn); return t; } }; return self; }
  };
  G.DriveApp = {
    getFoldersByName: function () { return { hasNext: function () { return false; } }; },
    createFolder: function () { return { createFile: function () { return { getId: function () { return 'file1'; } }; } }; },
    getFileById: function () { return { getBlob: function () { return resp(200, '').getBlob(); } }; }
  };
  G.Logger = { log: function () {} };

  (0, eval)(read('gas/match.gs'));
  (0, eval)(read('gas/Code.gs'));
  var M = G.SaleMatch;

  // 朝のLINE配信のプレビュー: osascript -l JavaScript tests/test_gas.js <root> --preview [日数オフセット]
  // 実データ（data/stores.json, data/sales.json）と見本の品目（data/items.example.json）で文面を作る
  if (argv[1] === '--preview') {
    reset();
    data.stores = JSON.parse(read('data/stores.json'));
    data.sales = JSON.parse(read('data/sales.json'));
    props.DATA_BASE_URL = 'https://jyunjh.github.io/claude-projects/sale-alert/';
    var sh = G.SpreadsheetApp.getActiveSpreadsheet().insertSheet('items');
    sh.appendRow(G.SHEETS.items);
    JSON.parse(read('data/items.example.json')).items.forEach(function (it) {
      sh.appendRow([it.id, it.name, it.keywords, it.exclude, it.maxPrice === null ? '' : it.maxPrice, true, '見本', '']);
    });
    return G.buildDigest_(Number(argv[2] || 0), false);
  }

  // ───── ヘルパー ─────
  function reset() {
    sheets = {}; fetchLog = []; triggers = [];
    props = { LINE_TOKEN: 't', PASSCODE: 'pc', DATA_BASE_URL: 'https://example.test/sale-alert/' };
    data = {
      stores: { radiusKm: 2, stores: [
        { id: 'a', name: 'マルエツ勝どき店', short: 'マルエツ', distanceKm: 0.5 },
        { id: 'far', name: '遠い店', short: '遠方', distanceKm: 3 }] },
      sales: { generatedAt: new Date().toISOString(), sales: [] }
    };
  }
  function sale(o) {
    var d = { storeId: 'a', title: '', price: 100, validFrom: M.jstDate(0), validTo: M.jstDate(0), status: 'active' };
    Object.keys(o).forEach(function (k) { d[k] = o[k]; });
    return d;
  }
  function post(body) { return JSON.parse(G.doPost({ postData: { contents: JSON.stringify(body) } }).content); }
  function ev(text, srcType, id) {
    var s = srcType === 'group' ? { type: 'group', groupId: id || 'G1', userId: 'U1' } : { type: 'user', userId: id || 'U1' };
    return { type: 'message', replyToken: 'rt', source: s, message: { type: 'text', text: text } };
  }
  function line(e) { return post({ events: [e] }); }
  function sent(kind) {
    return fetchLog.filter(function (f) { return f.url.indexOf('/message/' + kind) >= 0; })
      .map(function (f) { var p = JSON.parse(f.opt.payload); return { to: p.to, text: p.messages[0].text }; });
  }
  function items() { return G.rows_('items'); }
  function recips() { return G.rows_('recipients'); }
  function addItem(o) { return post({ action: 'items.save', passcode: 'pc', item: o }); }
  function say(text, t, id) { fetchLog = []; line(ev(text, t, id)); return sent('reply'); }

  // 1. 追加
  reset();
  var r = say('追加 卵');
  eq(items().length, 1, '追加 卵: 行が増える');
  eq(items()[0].name, '卵', '追加 卵: name');
  eq(items()[0].maxPrice, '', '追加 卵: maxPrice は空');
  ok(r.length === 1 && r[0].text.indexOf('「卵」を追加しました') >= 0, '追加 卵: reply が返る ' + JSON.stringify(r));
  r = say('追加 豚こま 150');
  eq(items().length, 2, '追加 豚こま 150: 行が増える');
  eq(items()[1].maxPrice, 150, '追加 豚こま 150: maxPrice 150');
  ok(r[0].text.indexOf('150円以下') >= 0, '追加 豚こま 150: reply に価格');
  reset();
  addItem({ name: '卵', keywords: '卵,たまご', exclude: 'うずら' });
  say('追加 卵 200');
  eq(items().length, 1, '既存品目に価格追加: 行は増えない');
  eq([items()[0].keywords, items()[0].exclude, items()[0].maxPrice], ['卵,たまご', 'うずら', 200], '既存品目: keywords/exclude 保持・maxPrice 更新');
  say('追加 卵');
  eq([items()[0].keywords, items()[0].exclude, items()[0].maxPrice], ['卵,たまご', 'うずら', 200], '価格なし再追加: maxPrice 200 保持');

  // 2. 削除・一覧・ヘルプ・停止・再開
  reset();
  say('追加 卵'); say('追加 牛乳 180');
  r = say('一覧');
  ok(r[0].text.indexOf('卵') >= 0 && r[0].text.indexOf('牛乳 ≦180円') >= 0, '一覧: 品目が出る ' + JSON.stringify(r));
  r = say('削除 卵');
  eq(items().map(function (i) { return i.name; }), ['牛乳'], '削除 卵: 行が消える');
  ok(r[0].text.indexOf('削除しました') >= 0, '削除: reply');
  r = say('削除 存在しない');
  ok(r[0].text.indexOf('一覧にありません') >= 0, '削除: 無い品目');
  r = say('ヘルプ');
  ok(r[0].text.indexOf('使い方') >= 0, 'ヘルプ: 使い方を返す');
  reset();
  line({ type: 'follow', replyToken: 'rt', source: { type: 'user', userId: 'U1' } });
  say('停止');
  eq(recips()[0].enabled, false, '停止: enabled=false');
  say('再開');
  eq(recips()[0].enabled, true, '再開: enabled=true');
  eq(recips().length, 1, '再開: 行は増えない');

  // 3. follow / unfollow
  reset();
  fetchLog = [];
  line({ type: 'follow', replyToken: 'rt', source: { type: 'user', userId: 'U7' } });
  eq([recips().length, recips()[0].id, recips()[0].enabled, recips()[0].type], [1, 'U7', true, 'user'], 'follow: recipients に登録');
  ok(sent('reply').length === 1, 'follow: 挨拶を reply');
  line({ type: 'unfollow', source: { type: 'user', userId: 'U7' } });
  eq(recips()[0].enabled, false, 'unfollow: enabled=false');

  // 4. グループ / 1:1
  reset();
  r = say('今日の夕飯なに？', 'group');
  eq(r.length, 0, 'グループの無関係な会話には reply しない');
  r = say('今日の夕飯なに？', 'user');
  ok(r.length === 1 && r[0].text.indexOf('使い方') >= 0, '1:1 ではヘルプを返す');
  r = say('追加 卵', 'group');
  ok(r.length === 1, 'グループでも「追加」には反応');

  // 5. 今日 / この先
  reset();
  addItem({ name: '卵', keywords: '卵,たまご' });
  data.sales.sales = [
    sale({ title: '卵10個', price: 198 }),
    sale({ title: '卵6個', price: 128 }),
    sale({ storeId: 'far', title: '卵遠方特価', price: 50 }),
    sale({ title: '卵撤回品', price: 60, status: 'withdrawn' }),
    sale({ title: '卵Mサイズ', price: 178, validFrom: M.jstDate(1), validTo: M.jstDate(1) })
  ];
  r = say('今日');
  var t = r[0].text;
  ok(t.indexOf('■ 卵') >= 0, '今日: 品目見出し');
  ok(t.indexOf('卵6個') >= 0 && t.indexOf('卵6個') < t.indexOf('卵10個'), '今日: 安い順');
  ok(t.indexOf('卵遠方特価') < 0, '今日: 圏外店は出ない');
  ok(t.indexOf('卵撤回品') < 0, '今日: withdrawn は出ない');
  var fromNext = t.indexOf('📅 この先');
  ok(fromNext >= 0 && t.indexOf('明日 卵：マルエツ 卵Mサイズ') > fromNext, '今日: この先に明日開始が出る');
  ok(t.indexOf('卵Mサイズ') === t.lastIndexOf('卵Mサイズ'), '今日: 明日開始分は本体欄に出ない');
  r = say('明日');
  ok(r[0].text.indexOf('卵Mサイズ') >= 0, '明日: 明日分が出る');

  // 6. morningPush
  reset();
  addItem({ name: '卵' });
  data.sales.sales = [sale({ title: '卵10個', price: 198 })];
  sheets.recipients = undefined;
  G.addRecipient_('U1', 'user', 'a'); G.addRecipient_('U2', 'group', 'b'); G.addRecipient_('U3', 'user', 'c');
  G.setRecipientEnabled_('U3', false);
  fetchLog = [];
  G.morningPush();
  var ps = sent('push');
  eq(ps.map(function (p) { return p.to; }), ['U1', 'U2'], 'morningPush: enabled のみに push');
  ok(ps[0].text.indexOf('卵10個') >= 0, 'morningPush: 本文に特売');
  data.sales.sales = [];
  props.NOTIFY_WHEN_EMPTY = 'false';
  fetchLog = [];
  G.morningPush();
  eq(sent('push').length, 0, '一致なし＆NOTIFY_WHEN_EMPTY=false: push しない');
  delete props.NOTIFY_WHEN_EMPTY;
  fetchLog = [];
  G.morningPush();
  ps = sent('push');
  ok(ps.length === 2 && ps[0].text.indexOf('特売はありません') >= 0, '既定: 「特売はありません」を push');

  // 7. データ鮮度
  reset();
  addItem({ name: '卵' });
  data.sales.generatedAt = new Date(Date.now() - 4 * 86400000).toISOString();
  r = say('今日');
  ok(r[0].text.indexOf('⚠️ データが4日更新されていません') >= 0, '4日前: 警告が入る');
  data.sales.generatedAt = new Date().toISOString();
  r = say('今日');
  ok(r[0].text.indexOf('⚠️') < 0 && r[0].text.indexOf('最終更新') >= 0, '新しいデータ: 警告なし');

  // 8. doPost / doGet
  reset();
  var bad = post({ action: 'items.list', passcode: 'xx' });
  eq(bad.ok, false, '合言葉違い: ok:false');
  ok(String(bad.error).indexOf('合言葉') >= 0, '合言葉違い: エラー文言');
  eq(post({ action: 'items.list' }).ok, false, '合言葉なし: ok:false');
  var sv = post({ action: 'items.save', passcode: 'pc', item: { name: '牛乳', maxPrice: 200 }, by: 'テスト' });
  ok(sv.ok && sv.item.name === '牛乳' && sv.item.maxPrice === 200 && sv.item.keywords === '牛乳', 'items.save: 保存と戻り値');
  var ls = post({ action: 'items.list', passcode: 'pc' });
  eq([ls.ok, ls.items.length, ls.items[0].addedBy], [true, 1, 'テスト'], 'items.list');
  var upd = post({ action: 'items.save', passcode: 'pc', item: { id: sv.item.id, name: '牛乳', maxPrice: 150 } });
  eq([items().length, upd.item.maxPrice], [1, 150], 'items.save: id 指定で更新');
  eq(post({ action: 'items.delete', passcode: 'pc', id: sv.item.id }).ok, true, 'items.delete: ok');
  eq(items().length, 0, 'items.delete: 行が消える');
  eq(post({ action: 'nope', passcode: 'pc' }).ok, false, '未知 action: ok:false');
  eq(JSON.parse(G.doGet({ parameter: { action: 'ping' } }).content).ok, true, 'doGet ping: ok:true');
  eq(JSON.parse(G.doGet({ parameter: { action: 'items.list' } }).content).ok, false, 'doGet その他: エラー');
  eq(JSON.parse(G.doGet({}).content).ok, false, 'doGet パラメータなし: エラー');

  // 9. 曜日
  eq(G.fmtDate_('2026-11-08'), '11/8(日)', 'fmtDate_ 日曜');
  eq(G.fmtDate_('2026-11-09'), '11/9(月)', 'fmtDate_ 月曜');
  eq(G.fmtDate_('2026-11-14'), '11/14(土)', 'fmtDate_ 土曜');

  return (fails.length ? 'NG\n' + fails.join('\n') : 'OK') + ' (' + (n - fails.length) + '/' + n + ')';
}
