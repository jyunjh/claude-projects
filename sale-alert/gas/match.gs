/*
 * 品目 × 特売 の照合ロジック。
 * PWA（ブラウザ）と Google Apps Script の両方で同じファイルを使う。
 * gas/match.gs はこのファイルの完全な写し（verify.sh で一致を検査）。
 * モジュール構文は使わない（GASで動かすため）。
 */
var SaleMatch = (function () {
  'use strict';

  /** 照合用の正規化: NFKC → 小文字 → カタカナをひらがなへ → 空白・記号を除去 */
  function normalize(s) {
    if (s === null || s === undefined) return '';
    var t = String(s).normalize('NFKC').toLowerCase();
    t = t.replace(/[ァ-ヶ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    });
    return t.replace(/[\s・･\-‐－―ー〜~、。,.\/／()（）「」『』【】\[\]]/g, '');
  }

  // 照合だけに使う読み替え（表記ゆれ）。漢字→かな、濁点・半濁点は無視（「若どり」と「とり」を同一視）
  var SYNONYMS = [
    ['玉子', 'たまご'], ['卵', 'たまご'], ['鶏', 'とり'], ['豚', 'ぶた'], ['牛', 'ぎゅう'],
    ['胸', 'むね'], ['腿', 'もも'], ['挽', 'ひき'], ['挽き', 'ひき'], ['小間', 'こま'], ['細切', 'こまぎれ'],
    ['葱', 'ねぎ'], ['玉葱', 'たまねぎ'], ['人参', 'にんじん'], ['大根', 'だいこん'], ['白菜', 'はくさい'],
    ['胡瓜', 'きゅうり'], ['茄子', 'なす'], ['馬鈴薯', 'じゃがいも'], ['牛乳', 'ぎゅうにゅう'],
    ['納豆', 'なっとう'], ['豆腐', 'とうふ'], ['鮭', 'さけ'], ['米', 'こめ']
  ];
  SYNONYMS.sort(function (a, b) { return b[0].length - a[0].length; }); // 長い語から

  function canon(s) {
    var t = normalize(s);
    for (var i = 0; i < SYNONYMS.length; i++) t = t.split(SYNONYMS[i][0]).join(SYNONYMS[i][1]);
    return t.normalize('NFD').replace(/[\u3099\u309a]/g, '').normalize('NFC');
  }

  /** "卵,たまご 玉子" のような文字列 or 配列 → 照合用に正規化した語の配列 */
  function terms(v) {
    var arr = Array.isArray(v) ? v : String(v || '').split(/[,、，\n]/);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var n = canon(arr[i]);
      if (n && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }

  /** 品目の照合語（keywords が空なら name を使う） */
  function itemTerms(item) {
    var k = terms(item.keywords);
    return k.length ? k : terms(item.name);
  }

  function saleText(sale) {
    return canon([sale.title, sale.brand, sale.spec].filter(Boolean).join(' '));
  }

  function effectivePrice(sale) {
    if (typeof sale.price === 'number') return sale.price;
    if (typeof sale.priceTaxIncl === 'number') return sale.priceTaxIncl;
    return null;
  }

  /** 1品目と1特売が一致するか（日付・店舗の条件は含まない） */
  function itemMatches(item, sale) {
    var text = saleText(sale);
    if (!text) return false;
    var inc = itemTerms(item);
    var hit = false;
    for (var i = 0; i < inc.length; i++) if (text.indexOf(inc[i]) >= 0) { hit = true; break; }
    if (!hit) return false;
    var exc = terms(item.exclude);
    for (var j = 0; j < exc.length; j++) if (text.indexOf(exc[j]) >= 0) return false;
    var max = item.maxPrice === '' || item.maxPrice === null || item.maxPrice === undefined
      ? null : Number(item.maxPrice);
    if (max !== null && !isNaN(max)) {
      var p = effectivePrice(sale);
      if (p !== null && p > max) return false;
      // 価格不明（よりどり等）は残す。表示側で「価格不明」と出す
    }
    return true;
  }

  /** dateStr ("YYYY-MM-DD") に有効な特売か */
  function validOn(sale, dateStr) {
    return sale.status !== 'withdrawn' && sale.validFrom <= dateStr && dateStr <= sale.validTo;
  }

  function isEnabled(item) {
    return !(item.enabled === false || item.enabled === 'FALSE' || item.enabled === 'false' || item.enabled === 0);
  }

  /** 対象の店舗IDの集合（半径内・active） */
  function storeIndex(storesDoc, radiusKm) {
    var r = typeof radiusKm === 'number' ? radiusKm : (storesDoc.radiusKm || 2.0);
    var idx = {};
    (storesDoc.stores || []).forEach(function (s) {
      if (s.active !== false && (typeof s.distanceKm !== 'number' || s.distanceKm <= r)) idx[s.id] = s;
    });
    return idx;
  }

  function byPrice(a, b) {
    var pa = effectivePrice(a), pb = effectivePrice(b);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }

  /**
   * 指定日の一致を品目ごとにまとめる。
   * @return [{item, sales:[sale…(安い順)]}]（一致のある品目だけ）
   */
  function matchesOn(items, sales, storesDoc, dateStr, opts) {
    opts = opts || {};
    var stores = storeIndex(storesDoc, opts.radiusKm);
    var out = [];
    items.filter(isEnabled).forEach(function (item) {
      var hits = sales.filter(function (s) {
        return stores[s.storeId] && validOn(s, dateStr) && itemMatches(item, s);
      }).sort(byPrice);
      if (hits.length) out.push({ item: item, sales: hits });
    });
    return out;
  }

  /** dateStr の翌日以降に始まる一致（先の予定）。開始日順 */
  function upcoming(items, sales, storesDoc, dateStr, opts) {
    opts = opts || {};
    var stores = storeIndex(storesDoc, opts.radiusKm);
    var enabled = items.filter(isEnabled);
    var out = [];
    sales.forEach(function (s) {
      if (s.status === 'withdrawn' || !stores[s.storeId] || s.validFrom <= dateStr) return;
      for (var i = 0; i < enabled.length; i++) {
        if (itemMatches(enabled[i], s)) { out.push({ item: enabled[i], sale: s }); break; }
      }
    });
    out.sort(function (a, b) {
      return a.sale.validFrom < b.sale.validFrom ? -1 : a.sale.validFrom > b.sale.validFrom ? 1 : byPrice(a.sale, b.sale);
    });
    return out;
  }

  /** 価格の表示文字列 */
  function priceLabel(sale) {
    if (typeof sale.price === 'number') {
      var s = sale.price + '円';
      if (typeof sale.priceTaxIncl === 'number') s += '（税込' + sale.priceTaxIncl + '円）';
      return s;
    }
    if (typeof sale.priceTaxIncl === 'number') return '税込' + sale.priceTaxIncl + '円';
    return sale.priceText || '価格不明';
  }

  /** JST の YYYY-MM-DD（offsetDays 日後） */
  function jstDate(offsetDays, now) {
    var t = (now ? now.getTime() : Date.now()) + 9 * 3600 * 1000 + (offsetDays || 0) * 86400 * 1000;
    return new Date(t).toISOString().slice(0, 10);
  }

  return {
    normalize: normalize, canon: canon, terms: terms, itemMatches: itemMatches, validOn: validOn,
    isEnabled: isEnabled, storeIndex: storeIndex, matchesOn: matchesOn, upcoming: upcoming,
    effectivePrice: effectivePrice, priceLabel: priceLabel, jstDate: jstDate
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SaleMatch;
