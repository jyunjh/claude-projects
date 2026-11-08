/**
 * 特売アラート — Google Apps Script（Googleシートに紐づけて使う）
 *
 * 役割:
 *  1. 品目リストの保管（シート「items」）と、PWA向けの読み書きAPI（合言葉つき）
 *  2. LINE公式アカウントの webhook（追加/削除/一覧/今日/明日/停止/再開、写真・投稿の受付）
 *  3. 毎朝の配信（時間トリガー → morningPush）
 *  4. 受付箱（シート「inbox」＋Driveフォルダ）を手元の取り込みへ渡すAPI
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *  LINE_TOKEN        … Messaging API のチャネルアクセストークン（長期）
 *  PASSCODE          … PWA・取り込みスクリプトが使う合言葉（自分で決める。推測されにくい長さで）
 *  DATA_BASE_URL     … 例 https://jyunjh.github.io/claude-projects/sale-alert/  （末尾 / ）
 *  NOTIFY_WHEN_EMPTY … "false" にすると一致なしの日は送らない（既定 true）
 *
 * このファイルと同じプロジェクトに match.gs（= リポジトリの sale-alert/match.js の写し）を置くこと。
 * 手順は SETUP.md。
 */

var SHEETS = {
  items: ['id', 'name', 'keywords', 'exclude', 'maxPrice', 'enabled', 'addedBy', 'updatedAt'],
  recipients: ['id', 'type', 'name', 'enabled', 'addedAt'],
  inbox: ['id', 'receivedAt', 'from', 'kind', 'text', 'fileId', 'status', 'note'],
  log: ['at', 'event', 'detail']
};
var INBOX_FOLDER = '特売アラート受付箱';

// ───────────────────────── 初期設定（エディタから1回実行） ─────────────────────────

/** シートの作成と、毎朝7時台のトリガー登録 */
function setup() {
  Object.keys(SHEETS).forEach(function (name) { sheet_(name); });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'morningPush') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('morningPush').timeBased().atHour(7).everyDays(1)
    .inTimezone('Asia/Tokyo').create();
  var p = props_();
  var missing = ['LINE_TOKEN', 'PASSCODE', 'DATA_BASE_URL'].filter(function (k) { return !p[k]; });
  Logger.log(missing.length ? '未設定のスクリプトプロパティ: ' + missing.join(', ') : '設定OK');
}

/** 配信の試し打ち（エディタから実行） */
function testPush() { morningPush(); }

// ───────────────────────── HTTP 入口 ─────────────────────────

function doGet(e) {
  var q = (e && e.parameter) || {};
  try {
    // 合言葉をURLに載せないため、読み取りも POST で行う。GET は疎通確認だけ
    if (q.action === 'ping') return json_({ ok: true });
    return json_({ ok: false, error: 'POST を使ってください' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { body = {}; }
  // LINE の webhook
  if (Array.isArray(body.events)) {
    body.events.forEach(function (ev) {
      try { handleLineEvent_(ev); } catch (err) { log_('lineError', String(err && err.stack || err)); }
    });
    return json_({ ok: true });
  }
  // PWA / 取り込みスクリプトからの API（Content-Type: text/plain で送られてくる）
  try {
    requirePasscode_(body.passcode);
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      switch (body.action) {
        case 'items.list': return json_({ ok: true, items: readItems_() });
        case 'inbox.list': return json_({ ok: true, inbox: pendingInbox_(!!body.withFiles) });
        case 'items.save': return json_({ ok: true, item: saveItem_(body.item || {}, body.by || 'アプリ') });
        case 'items.delete': deleteItem_(body.id); return json_({ ok: true });
        case 'inbox.done': markInbox_(body.id, body.status || 'done', body.note || ''); return json_({ ok: true });
        default: return json_({ ok: false, error: 'unknown action' });
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// ───────────────────────── 品目 ─────────────────────────

function readItems_() {
  return rows_('items').filter(function (r) { return r.id && r.name; }).map(function (r) {
    return {
      id: String(r.id), name: String(r.name), keywords: String(r.keywords || ''),
      exclude: String(r.exclude || ''),
      maxPrice: r.maxPrice === '' || r.maxPrice === null ? null : Number(r.maxPrice),
      enabled: !(r.enabled === false || String(r.enabled).toUpperCase() === 'FALSE'),
      addedBy: String(r.addedBy || ''), updatedAt: r.updatedAt ? String(r.updatedAt) : ''
    };
  });
}

function saveItem_(item, by) {
  var name = String(item.name || '').trim();
  if (!name) throw new Error('品目名が空です');
  var sh = sheet_('items');
  var data = sh.getDataRange().getValues();
  var now = new Date().toISOString();
  var row = [
    item.id || 'i-' + Utilities.getUuid().slice(0, 8), name,
    String(item.keywords || name), String(item.exclude || ''),
    item.maxPrice === null || item.maxPrice === undefined || item.maxPrice === '' ? '' : Number(item.maxPrice),
    item.enabled === false ? false : true, item.addedBy || by, now
  ];
  for (var i = 1; i < data.length; i++) {
    if (item.id ? String(data[i][0]) === String(item.id) : String(data[i][1]) === name) {
      row[0] = data[i][0];
      // LINEの「追加 卵 200」のように一部だけ指定されたときは、指定の無い列を残す
      if (item.keywords === undefined) row[2] = data[i][2];
      if (item.exclude === undefined) row[3] = data[i][3];
      if (item.enabled === undefined) row[5] = data[i][5];
      if (item.maxPrice === undefined) row[4] = data[i][4];
      row[6] = data[i][6] || by;
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return rowToObj_(SHEETS.items, row);
    }
  }
  sh.appendRow(row);
  return rowToObj_(SHEETS.items, row);
}

function deleteItem_(idOrName) {
  var sh = sheet_('items');
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(idOrName) || String(data[i][1]) === String(idOrName)) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ───────────────────────── LINE ─────────────────────────

function handleLineEvent_(ev) {
  var src = ev.source || {};
  var targetId = src.groupId || src.roomId || src.userId;
  if (ev.type === 'follow' || ev.type === 'join') {
    addRecipient_(targetId, src.type, ev.type === 'join' ? 'グループ' : displayName_(src));
    reply_(ev.replyToken, '登録しました。毎朝7時台に、指定した品目の特売をお知らせします。\n\n' + helpText_());
    return;
  }
  if (ev.type === 'unfollow' || ev.type === 'leave') { setRecipientEnabled_(targetId, false); return; }
  if (ev.type !== 'message') return;

  var m = ev.message;
  if (m.type === 'image') {
    var id = saveInboxImage_(m.id, displayName_(src));
    reply_(ev.replyToken, '写真を受け付けました（' + id + '）。次回の取り込みで読み取ります。\n店名が写っていなければ「店: マルエツ勝どき」のように続けて送ってください。');
    return;
  }
  if (m.type !== 'text') return;
  var text = String(m.text || '').trim();
  var by = displayName_(src);
  var mm;

  if ((mm = text.match(/^(?:追加|ついか|add)\s+(.+?)(?:\s+(\d+)\s*円?)?$/i))) {
    var saved = saveItem_({ name: mm[1], maxPrice: mm[2] ? Number(mm[2]) : undefined }, by);
    reply_(ev.replyToken, '「' + saved.name + '」を追加しました' + (saved.maxPrice ? '（' + saved.maxPrice + '円以下で通知）' : '') + '。');
  } else if ((mm = text.match(/^(?:削除|さくじょ|けす|消す|del)\s+(.+)$/i))) {
    reply_(ev.replyToken, deleteItem_(mm[1].trim()) ? '「' + mm[1].trim() + '」を削除しました。' : '「' + mm[1].trim() + '」は一覧にありません。');
  } else if (/^(一覧|いちらん|リスト|list)$/i.test(text)) {
    var items = readItems_();
    reply_(ev.replyToken, items.length ? '対象品目（' + items.length + '）\n' + items.map(function (it) {
      return (it.enabled ? '・' : '（停止）') + it.name + (it.maxPrice ? ' ≦' + it.maxPrice + '円' : '');
    }).join('\n') : '品目はまだありません。「追加 卵」のように送ってください。');
  } else if (/^(今日|きょう|today)$/i.test(text)) {
    reply_(ev.replyToken, buildDigest_(0, true));
  } else if (/^(明日|あした|tomorrow)$/i.test(text)) {
    reply_(ev.replyToken, buildDigest_(1, true));
  } else if (/^(停止|ていし|stop)$/i.test(text)) {
    setRecipientEnabled_(targetId, false);
    reply_(ev.replyToken, '朝の通知を止めました。「再開」で戻ります。');
  } else if (/^(再開|さいかい|start)$/i.test(text)) {
    addRecipient_(targetId, src.type, by);
    reply_(ev.replyToken, '朝の通知を再開しました。');
  } else if (/^(ヘルプ|help|使い方|\?|？)$/i.test(text)) {
    reply_(ev.replyToken, helpText_());
  } else if (/^店[:：]/.test(text) || /円|https?:\/\//.test(text)) {
    var tid = addInbox_(by, 'text', text, '');
    reply_(ev.replyToken, '受け付けました（' + tid + '）。次回の取り込みで読み取ります。');
  } else if (src.type === 'user') {
    reply_(ev.replyToken, helpText_());  // グループでは関係ない会話に反応しない
  }
}

function helpText_() {
  return [
    '使い方',
    '・追加 卵　… 品目を追加',
    '・追加 豚こま 150　… 150円以下のときだけ通知',
    '・削除 卵 ／ 一覧',
    '・今日 ／ 明日　… 特売を表示',
    '・停止 ／ 再開　… 朝の通知',
    '・チラシやSNSのスクショ・店頭の写真を送る → 次回の取り込みで読み取り',
    props_().DATA_BASE_URL ? '▶ アプリ: ' + props_().DATA_BASE_URL : ''
  ].filter(Boolean).join('\n');
}

function displayName_(src) {
  try {
    var url = src.groupId
      ? 'https://api.line.me/v2/bot/group/' + src.groupId + '/member/' + src.userId
      : 'https://api.line.me/v2/bot/profile/' + src.userId;
    var res = lineApi_('get', url);
    return JSON.parse(res.getContentText()).displayName || 'LINE';
  } catch (e) { return 'LINE'; }
}

function lineApi_(method, url, payload) {
  var opt = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + props_().LINE_TOKEN }
  };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch(url, opt);
  if (res.getResponseCode() >= 300) log_('lineApi ' + res.getResponseCode(), url + ' ' + res.getContentText().slice(0, 500));
  return res;
}

function reply_(token, text) {
  if (!token) return;
  lineApi_('post', 'https://api.line.me/v2/bot/message/reply',
    { replyToken: token, messages: [{ type: 'text', text: clip_(text) }] });
}

function push_(to, text) {
  return lineApi_('post', 'https://api.line.me/v2/bot/message/push',
    { to: to, messages: [{ type: 'text', text: clip_(text) }] });
}

function clip_(t) { t = String(t); return t.length > 4900 ? t.slice(0, 4890) + '\n…（以下略）' : t; }

// ───────────────────────── 宛先 ─────────────────────────

function addRecipient_(id, type, name) {
  if (!id) return;
  var sh = sheet_('recipients');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { sh.getRange(i + 1, 4).setValue(true); return; }
  }
  sh.appendRow([id, type || 'user', name || '', true, new Date().toISOString()]);
}

function setRecipientEnabled_(id, on) {
  var sh = sheet_('recipients');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === id) sh.getRange(i + 1, 4).setValue(on);
}

// ───────────────────────── 朝の配信 ─────────────────────────

function morningPush() {
  var p = props_();
  var text = buildDigest_(0, false);
  if (!text) { log_('push', '一致なしのため送信せず'); return; }
  var sent = 0;
  rows_('recipients').forEach(function (r) {
    if (r.id && !(r.enabled === false || String(r.enabled).toUpperCase() === 'FALSE')) {
      push_(String(r.id), text);
      sent++;
    }
  });
  log_('push', '送信 ' + sent + ' 件');
}

/** offset日後の一覧。interactive=false（朝の配信）で一致なし＆NOTIFY_WHEN_EMPTY=false なら '' */
function buildDigest_(offset, interactive) {
  var p = props_();
  var base = p.DATA_BASE_URL;
  if (!base) return 'DATA_BASE_URL が未設定です。';
  var stores, salesDoc;
  try {
    stores = fetchJson_(base + 'data/stores.json');
    salesDoc = fetchJson_(base + 'data/sales.json');
  } catch (e) {
    return '⚠️ 特売データを取得できませんでした（' + e.message + '）';
  }
  var items = readItems_();
  var day = SaleMatch.jstDate(offset);
  var storeById = {};
  stores.stores.forEach(function (s) { storeById[s.id] = s; });
  var hits = SaleMatch.matchesOn(items, salesDoc.sales, stores, day);
  var lines = ['🛒 ' + fmtDate_(day) + ' の特売（対象品目）'];

  if (!items.filter(SaleMatch.isEnabled).length) {
    lines.push('品目がまだありません。「追加 卵」のように送ってください。');
  } else if (!hits.length) {
    if (!interactive && String(p.NOTIFY_WHEN_EMPTY).toLowerCase() === 'false') return '';
    lines.push('対象品目の特売はありません。');
  } else {
    hits.forEach(function (h) {
      lines.push('', '■ ' + h.item.name);
      h.sales.slice(0, 3).forEach(function (s) { lines.push('・' + saleLine_(s, storeById, day)); });
      if (h.sales.length > 3) lines.push('　ほか' + (h.sales.length - 3) + '件');
    });
  }

  if (offset === 0) {
    var tomorrow = SaleMatch.jstDate(1);
    var next = SaleMatch.upcoming(items, salesDoc.sales, stores, day).filter(function (u) {
      return u.sale.validFrom <= SaleMatch.jstDate(3);
    });
    if (next.length) {
      lines.push('', '📅 この先（3日以内に始まる）');
      next.slice(0, 5).forEach(function (u) {
        lines.push('・' + (u.sale.validFrom === tomorrow ? '明日' : fmtDate_(u.sale.validFrom)) + ' ' + u.item.name + '：' + saleLine_(u.sale, storeById));
      });
    }
  }

  var gen = salesDoc.generatedAt ? new Date(salesDoc.generatedAt) : null;
  if (gen) {
    var ageDays = Math.floor((Date.now() - gen.getTime()) / 86400000);
    lines.push('', (ageDays >= 3 ? '⚠️ データが' + ageDays + '日更新されていません（最終 ' : '最終更新 ') +
      Utilities.formatDate(gen, 'Asia/Tokyo', 'M/d HH:mm') + (ageDays >= 3 ? '）' : ''));
  }
  lines.push('▶ ' + base);
  return lines.join('\n');
}

function saleLine_(s, storeById, day) {
  var st = storeById[s.storeId];
  var name = st ? (st.short || st.name) : s.storeId;
  var t = name + ' ' + s.title + (s.spec ? '（' + s.spec + '）' : '') + ' ' + SaleMatch.priceLabel(s);
  if (s.conditions && s.conditions.length) t += ' ※' + s.conditions.join('・');
  if (s.validTo > (day || s.validFrom)) t += ' 〜' + fmtDate_(s.validTo);
  return t;
}

function fmtDate_(iso) {
  var d = new Date(iso + 'T00:00:00+09:00');
  return Utilities.formatDate(d, 'Asia/Tokyo', 'M/d') + '(' + '日月火水木金土'.charAt(Number(Utilities.formatDate(d, 'Asia/Tokyo', 'u')) % 7) + ')';
}

function fetchJson_(url) {
  var res = UrlFetchApp.fetch(url + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' ' + url);
  return JSON.parse(res.getContentText());
}

// ───────────────────────── 受付箱 ─────────────────────────

function inboxFolder_() {
  var it = DriveApp.getFoldersByName(INBOX_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(INBOX_FOLDER);
}

function saveInboxImage_(messageId, by) {
  var res = lineApi_('get', 'https://api-data.line.me/v2/bot/message/' + messageId + '/content');
  var blob = res.getBlob().setName('line-' + messageId + '.jpg');
  var file = inboxFolder_().createFile(blob);
  return addInbox_(by, 'image', '', file.getId());
}

function addInbox_(by, kind, text, fileId) {
  var id = 'in-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 4);
  sheet_('inbox').appendRow([id, new Date().toISOString(), by, kind, text, fileId, 'pending', '']);
  return id;
}

/** 未処理の受付分。直後に送られた「店: …」テキストは前の写真の補足として text に入れる */
function pendingInbox_(withFiles) {
  var rows = rows_('inbox').filter(function (r) { return r.status === 'pending'; });
  return rows.map(function (r) {
    var o = { id: r.id, receivedAt: String(r.receivedAt), from: r.from, kind: r.kind, text: r.text, fileId: r.fileId };
    if (withFiles && r.fileId) {
      var blob = DriveApp.getFileById(r.fileId).getBlob();
      o.mimeType = blob.getContentType();
      o.base64 = Utilities.base64Encode(blob.getBytes());
    }
    return o;
  });
}

function markInbox_(id, status, note) {
  var sh = sheet_('inbox');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.getRange(i + 1, 7, 1, 2).setValues([[status, note]]);
      return;
    }
  }
  throw new Error('inbox に無い id: ' + id);
}

// ───────────────────────── 共通 ─────────────────────────

function props_() { return PropertiesService.getScriptProperties().getProperties(); }

function requirePasscode_(given) {
  var pc = props_().PASSCODE;
  if (!pc) throw new Error('PASSCODE が未設定です');
  if (String(given || '') !== pc) throw new Error('合言葉が違います');
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  var data = sheet_(name).getDataRange().getValues();
  var head = data[0];
  return data.slice(1).map(function (r) { return rowToObj_(head, r); });
}

function rowToObj_(head, r) {
  var o = {};
  head.forEach(function (h, i) { o[h] = r[i]; });
  return o;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function log_(event, detail) {
  try { sheet_('log').appendRow([new Date().toISOString(), event, String(detail).slice(0, 2000)]); } catch (e) { /* noop */ }
}
