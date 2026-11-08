/* 特売アラート PWA。ビルド不要のバニラJS。照合は match.js（SaleMatch）。 */
(function () {
  'use strict';
  var M = SaleMatch;
  var LS = { settings: 'saleAlert.settings', items: 'saleAlert.localItems' };
  var WD = '日月火水木金土';

  var state = {
    stores: { stores: [] }, storeById: {}, sales: [], generatedAt: null,
    items: [], shared: false, day: M.jstDate(0), settings: loadSettings()
  };

  // ───────── util ─────────
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDay(iso) {
    var d = new Date(iso + 'T00:00:00+09:00');
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD.charAt(d.getDay()) + ')';
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(LS.settings)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) { localStorage.setItem(LS.settings, JSON.stringify(s)); state.settings = s; }

  /** 複数のチラシに同じ品が載っていても一覧では1件にまとめる */
  function dedupe(sales) {
    var seen = {};
    return sales.filter(function (s) {
      var k = [s.storeId, M.normalize(s.title), M.normalize(s.spec), s.price, s.priceTaxIncl, s.validFrom, s.validTo].join('|');
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  // ───────── データ読み込み ─────────
  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return r.json();
    });
  }

  function gas(action, extra) {
    var s = state.settings;
    var body = Object.assign({ action: action, passcode: s.passcode, by: s.me || 'アプリ' }, extra || {});
    // text/plain にして CORS のプリフライトを避ける（Apps Script は OPTIONS に応答しない）
    return fetch(s.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '失敗'); return j; });
  }

  function loadItems() {
    if (state.settings.gasUrl && state.settings.passcode) {
      return gas('items.list').then(function (j) {
        state.items = j.items; state.shared = true;
      }).catch(function (e) {
        state.shared = false;
        toast('共有の品目を読めませんでした: ' + e.message);
        return loadLocalItems();
      });
    }
    state.shared = false;
    return loadLocalItems();
  }

  function loadLocalItems() {
    var local = null;
    try { local = JSON.parse(localStorage.getItem(LS.items)); } catch (e) { local = null; }
    if (local) { state.items = local; return Promise.resolve(); }
    return getJson('data/items.example.json').then(function (d) { state.items = d.items; })
      .catch(function () { state.items = []; });
  }

  function loadAll() {
    return Promise.all([
      getJson('data/stores.json').then(function (d) {
        state.stores = d;
        state.storeById = {};
        d.stores.forEach(function (s) { state.storeById[s.id] = s; });
      }),
      getJson('data/sales.json').then(function (d) {
        state.sales = d.sales || [];
        state.generatedAt = d.generatedAt;
      }),
      loadItems()
    ]).then(render).catch(function (e) {
      $('#status').innerHTML = '<span class="warn">データを読み込めませんでした（' + esc(e.message) + '）</span>';
    });
  }

  // ───────── 描画 ─────────
  function storeName(id) {
    var s = state.storeById[id];
    return s ? (s.short || s.name) : id;
  }

  function priceHtml(s) {
    if (typeof s.price === 'number') {
      return esc(s.price) + '円' + (typeof s.priceTaxIncl === 'number' ? '<small>税込' + esc(s.priceTaxIncl) + '円</small>' : '');
    }
    return esc(M.priceLabel(s));
  }

  function saleCard(s, opts) {
    opts = opts || {};
    var st = state.storeById[s.storeId] || {};
    var period = s.validFrom === s.validTo ? fmtDay(s.validFrom) : fmtDay(s.validFrom) + '〜' + fmtDay(s.validTo);
    var cond = (s.conditions || []).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    var hist = (s.history || []).length ? '<span class="chip changed">更新あり</span>' : '';
    var src = s.source && s.source.url ? ' · <a href="' + esc(s.source.url) + '" target="_blank" rel="noopener">チラシ</a>' : '';
    return '<li class="sale">' +
      '<div class="sale-main"><span class="sale-title">' + esc(s.title) + (s.spec ? ' <small>' + esc(s.spec) + '</small>' : '') + '</span>' +
      '<span class="price">' + priceHtml(s) + '</span></div>' +
      '<div class="sale-sub">' + (opts.item ? '<b>' + esc(opts.item) + '</b> · ' : '') + esc(storeName(s.storeId)) +
      (typeof st.distanceKm === 'number' ? ' (' + st.distanceKm.toFixed(1) + 'km)' : '') + ' · ' + period + src + '</div>' +
      (cond || hist ? '<div class="chips">' + cond + hist + '</div>' : '') +
      '</li>';
  }

  function renderStatus() {
    var parts = [];
    if (state.generatedAt) {
      var g = new Date(state.generatedAt);
      var age = Math.floor((Date.now() - g.getTime()) / 86400000);
      parts.push((age >= 3 ? '<span class="warn">⚠️ ' : '<span>') + '最終更新 ' + (g.getMonth() + 1) + '/' + g.getDate() + ' ' +
        ('0' + g.getHours()).slice(-2) + ':' + ('0' + g.getMinutes()).slice(-2) + '</span>');
    } else {
      parts.push('<span class="warn">まだ特売データがありません</span>');
    }
    parts.push(state.shared ? '<span class="ok">品目: 共有中</span>' : '<span class="warn">品目: この端末だけ</span>');
    $('#status').innerHTML = parts.join(' · ');
  }

  function renderToday() {
    $('#dayLabel').textContent = fmtDay(state.day) + (state.day === M.jstDate(0) ? ' 今日' : '');
    var hits = M.matchesOn(state.items, state.sales, state.stores, state.day);
    var el = $('#todayList');
    if (!state.items.filter(M.isEnabled).length) {
      el.innerHTML = '<p class="empty">品目がありません。「品目」タブで追加してください。</p>';
      return;
    }
    if (!hits.length) {
      el.innerHTML = '<p class="empty">この日の対象品目の特売はありません。</p>';
      return;
    }
    el.innerHTML = hits.map(function (h) {
      return '<h3>' + esc(h.item.name) + ' <small>' + h.sales.length + '件</small></h3><ul class="sales">' +
        dedupe(h.sales).map(function (s) { return saleCard(s); }).join('') + '</ul>';
    }).join('');
  }

  function renderUpcoming() {
    var ups = M.upcoming(state.items, state.sales, state.stores, M.jstDate(0));
    var el = $('#upcomingList');
    if (!ups.length) { el.innerHTML = '<p class="empty">先の日付の一致はまだありません。</p>'; return; }
    var html = '', cur = null, seen = {};
    ups.forEach(function (u) {
      var k = u.sale.storeId + M.normalize(u.sale.title) + u.sale.price + u.sale.validFrom;
      if (seen[k]) return;
      seen[k] = 1;
      if (u.sale.validFrom !== cur) {
        if (cur) html += '</ul>';
        cur = u.sale.validFrom;
        html += '<h3>' + fmtDay(cur) + ' から</h3><ul class="sales">';
      }
      html += saleCard(u.sale, { item: u.item.name });
    });
    el.innerHTML = html + '</ul>';
  }

  function renderAll() {
    var sel = $('#allDay');
    var days = {};
    var today = M.jstDate(0);
    state.sales.forEach(function (s) {
      if (s.status === 'withdrawn') return;
      for (var d = s.validFrom < today ? today : s.validFrom; d <= s.validTo; d = addDays(d, 1)) days[d] = 1;
    });
    var keys = Object.keys(days).sort();
    var prev = sel.value;
    sel.innerHTML = '<option value="">すべての日</option>' + keys.map(function (d) {
      return '<option value="' + d + '">' + fmtDay(d) + '</option>';
    }).join('');
    if (keys.indexOf(prev) >= 0) sel.value = prev;
    var q = M.canon($('#q').value);
    var day = sel.value;
    var list = dedupe(state.sales.filter(function (s) {
      if (s.status === 'withdrawn' || s.validTo < today) return false;
      if (day && !M.validOn(s, day)) return false;
      return !q || M.canon([s.title, s.brand, s.spec].join(' ')).indexOf(q) >= 0;
    })).sort(function (a, b) { return a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : (M.effectivePrice(a) || 1e9) - (M.effectivePrice(b) || 1e9); });
    $('#allList').innerHTML = list.length
      ? '<p class="hint">' + list.length + '件</p><ul class="sales">' + list.slice(0, 300).map(function (s) { return saleCard(s); }).join('') + '</ul>'
      : '<p class="empty">該当なし</p>';
  }

  function renderItems() {
    $('#itemsNote').innerHTML = state.shared
      ? '品目は家族と共有されています（LINE で「追加 卵」と送っても追加できます）。'
      : '⚠️ 品目はこの端末だけに保存されています。家族と共有するには「設定」で Apps Script を接続してください。';
    $('#itemList').innerHTML = state.items.map(function (it) {
      var on = M.isEnabled(it);
      return '<li class="' + (on ? '' : 'off') + '"><div><b>' + esc(it.name) + '</b>' +
        (it.maxPrice ? ' <span class="chip">≦' + esc(it.maxPrice) + '円</span>' : '') +
        '<div class="sale-sub">語: ' + esc(it.keywords || it.name) + (it.exclude ? ' ／ 除外: ' + esc(it.exclude) : '') +
        (it.addedBy ? ' ／ ' + esc(it.addedBy) : '') + '</div></div>' +
        '<div class="item-actions"><button data-act="toggle" data-id="' + esc(it.id) + '" class="ghost">' + (on ? '停止' : '再開') + '</button>' +
        '<button data-act="edit" data-id="' + esc(it.id) + '" class="ghost">編集</button>' +
        '<button data-act="del" data-id="' + esc(it.id) + '" class="ghost danger">削除</button></div></li>';
    }).join('') || '<li class="empty">品目がありません</li>';
  }

  function renderStores() {
    var st = state.stores;
    $('#storesNote').textContent = (st.origin ? st.origin.label + ' から' : '') + '半径' + (st.radiusKm || 2) + 'km以内の ' +
      st.stores.filter(function (s) { return s.active !== false && s.distanceKm <= (st.radiusKm || 2); }).length + ' 店（うちチラシ自動取得 ' +
      st.stores.filter(function (s) { return s.distanceKm <= (st.radiusKm || 2) && (s.sources || []).length; }).length + ' 店）';
    var counts = {};
    var today = M.jstDate(0);
    state.sales.forEach(function (s) { if (s.status !== 'withdrawn' && s.validTo >= today) counts[s.storeId] = (counts[s.storeId] || 0) + 1; });
    var radius = st.radiusKm || 2;
    $('#storeList').innerHTML = st.stores.filter(function (s) { return s.distanceKm <= radius; }).sort(function (a, b) { return (a.distanceKm || 99) - (b.distanceKm || 99); }).map(function (s) {
      var links = (s.sources || []).map(function (x) {
        return '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.label || x.kind) + '</a>';
      }).join(' · ');
      return '<li class="' + (s.active === false ? 'off' : '') + '"><div><b>' + esc(s.name) + '</b> <small>' +
        (typeof s.distanceKm === 'number' ? s.distanceKm.toFixed(2) + 'km' : '') + '</small>' +
        '<div class="sale-sub">' + esc(s.address || '') + (s.hours ? ' ／ ' + esc(s.hours) : '') + '</div>' +
        '<div class="sale-sub">特売 ' + (counts[s.id] || 0) + '件' + (links ? ' · ' + links : ' · <span class="warn">チラシ自動取得なし</span>（LINEにチラシ・店頭の写真を送ると取り込み）') + '</div></div></li>';
    }).join('');
  }

  function renderSettings() {
    var f = $('#settingsForm');
    f.gasUrl.value = state.settings.gasUrl || '';
    f.passcode.value = state.settings.passcode || '';
    f.me.value = state.settings.me || '';
  }

  function render() {
    renderStatus(); renderToday(); renderUpcoming(); renderAll(); renderItems(); renderStores(); renderSettings();
  }

  // ───────── 品目の編集 ─────────
  function persistLocal() { localStorage.setItem(LS.items, JSON.stringify(state.items)); }

  function saveItem(item) {
    if (state.shared) {
      return gas('items.save', { item: item }).then(loadItems);
    }
    if (!item.id) item.id = 'local-' + Date.now().toString(36);
    item.addedBy = item.addedBy || state.settings.me || '';
    var i = state.items.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) state.items[i] = Object.assign({}, state.items[i], item); else state.items.push(item);
    persistLocal();
    return Promise.resolve();
  }

  function deleteItem(id) {
    if (state.shared) return gas('items.delete', { id: id }).then(loadItems);
    state.items = state.items.filter(function (x) { return x.id !== id; });
    persistLocal();
    return Promise.resolve();
  }

  function bindItems() {
    var f = $('#itemForm');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var item = {
        id: f.itemId.value || undefined, name: f.itemName.value.trim(), keywords: f.keywords.value.trim() || f.itemName.value.trim(),
        exclude: f.exclude.value.trim(), maxPrice: f.maxPrice.value ? Number(f.maxPrice.value) : null
      };
      if (!item.name) return;
      var old = state.items.find(function (x) { return x.id === item.id; });
      item.enabled = old ? M.isEnabled(old) : true;
      saveItem(item).then(function () { f.reset(); f.itemId.value = ''; render(); toast('保存しました'); })
        .catch(function (err) { toast('保存できませんでした: ' + err.message); });
    });
    $('#itemReset').addEventListener('click', function () { f.reset(); f.itemId.value = ''; });
    $('#itemList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var it = state.items.find(function (x) { return String(x.id) === b.dataset.id; });
      if (!it) return;
      if (b.dataset.act === 'edit') {
        f.itemId.value = it.id; f.itemName.value = it.name; f.keywords.value = it.keywords || '';
        f.exclude.value = it.exclude || ''; f.maxPrice.value = it.maxPrice || '';
        f.scrollIntoView({ behavior: 'smooth' });
      } else if (b.dataset.act === 'toggle') {
        saveItem(Object.assign({}, it, { enabled: !M.isEnabled(it) })).then(render)
          .catch(function (err) { toast('変更できませんでした: ' + err.message); });
      } else if (b.dataset.act === 'del' && confirm('「' + it.name + '」を削除しますか？')) {
        deleteItem(it.id).then(function () { render(); toast('削除しました'); })
          .catch(function (err) { toast('削除できませんでした: ' + err.message); });
      }
    });
  }

  // ───────── 設定・共有リンク ─────────
  function shareLink() {
    var s = state.settings;
    var payload = btoa(unescape(encodeURIComponent(JSON.stringify({ gasUrl: s.gasUrl, passcode: s.passcode }))));
    return location.origin + location.pathname + '#setup=' + payload;
  }

  function importSetupFromHash() {
    var m = location.hash.match(/#setup=([A-Za-z0-9+/=]+)/);
    if (!m) return;
    try {
      var cfg = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      saveSettings(Object.assign({}, state.settings, { gasUrl: cfg.gasUrl, passcode: cfg.passcode }));
      toast('共有の設定を読み込みました。「設定」で名前を入れてください');
    } catch (e) {
      toast('共有リンクを読めませんでした');
    }
    history.replaceState(null, '', location.pathname); // 合言葉をアドレスバーに残さない
  }

  function bindSettings() {
    var f = $('#settingsForm');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      saveSettings({ gasUrl: f.gasUrl.value.trim(), passcode: f.passcode.value, me: f.me.value.trim() });
      $('#settingsResult').textContent = '接続を確認中…';
      loadItems().then(function () {
        $('#settingsResult').textContent = state.shared ? '✅ 接続できました。品目は共有されています。' : '❌ 接続できませんでした。URL と合言葉を確認してください。';
        render();
      });
    });
    $('#copyShare').addEventListener('click', function () {
      if (!state.settings.gasUrl || !state.settings.passcode) { toast('先に Apps Script を接続してください'); return; }
      var link = shareLink();
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () {
        toast('コピーしました。LINE で家族に送ってください');
      }).catch(function () { prompt('このリンクをコピーしてください', link); });
    });
  }

  // ───────── 起動 ─────────
  function bindTabs() {
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab); });
      });
    });
    $('#dayPrev').addEventListener('click', function () { state.day = addDays(state.day, -1); renderToday(); });
    $('#dayNext').addEventListener('click', function () { state.day = addDays(state.day, 1); renderToday(); });
    $('#q').addEventListener('input', renderAll);
    $('#allDay').addEventListener('change', renderAll);
  }

  importSetupFromHash();
  bindTabs(); bindItems(); bindSettings();
  loadAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
