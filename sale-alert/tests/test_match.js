// osascript -l JavaScript tests/test_match.js <path-to-match.js>
ObjC.import('Foundation');
function run(argv) {
  var src = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  eval(src.replace('var SaleMatch =', 'this.SaleMatch ='));
  var M = this.SaleMatch, fails = [], n = 0;
  function eq(a, b, msg) { n++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); }

  eq(M.normalize('タマゴ　ＬＬ'), 'たまごll', 'カタカナ→ひらがな・全角→半角・空白除去');
  var egg = { id: 'e', name: '卵', keywords: '卵,たまご,玉子', exclude: '卵焼,うずら', maxPrice: 200, enabled: true };
  eq(M.itemMatches(egg, { title: '国産 タマゴ Lサイズ10個', price: 198 }), true, 'カタカナ表記でも一致');
  eq(M.itemMatches(egg, { title: '厚焼き卵焼', price: 98 }), false, '除外語');
  eq(M.itemMatches(egg, { title: 'うずら卵', price: 98 }), false, '除外語2');
  eq(M.itemMatches(egg, { title: '玉子 10個', price: 248 }), false, '上限価格超え');
  eq(M.itemMatches(egg, { title: '玉子 10個', price: null, priceTaxIncl: 210.6 }), false, '税込のみは税込で比較');
  eq(M.itemMatches(egg, { title: '玉子 よりどり', price: null, priceText: '3点500円' }), true, '価格不明は残す');
  eq(M.itemMatches({ name: '牛乳' }, { title: '明治おいしい牛乳', price: 238 }), true, 'keywords 空なら name');
  eq(M.isEnabled({ enabled: 'FALSE' }), false, 'シートの FALSE');
  eq(M.itemMatches({ name: '鶏むね' }, { title: '国産若どりむね肉', price: 78 }), true, '漢字かな・濁点のゆれ（鶏むね ↔ 若どりむね）');
  eq(M.itemMatches({ name: '豚こま' }, { title: '国産豚小間切れ', price: 98 }), true, '小間 ↔ こま');
  eq(M.itemMatches({ name: '玉ねぎ', keywords: 'たまねぎ' }, { title: '北海道産 玉葱', price: 38 }), true, '玉葱 ↔ たまねぎ');
  eq(M.itemMatches({ name: '卵', exclude: '玉子焼' }, { title: '厚焼き卵焼', price: 98 }), false, '除外語も読み替え（卵焼 ↔ 玉子焼）');
  eq(M.itemMatches({ name: '牛乳' }, { title: '豚肉ロース', price: 98 }), false, '無関係は一致しない');

  var stores = { radiusKm: 2, stores: [{ id: 'a', distanceKm: 0.5 }, { id: 'far', distanceKm: 2.4 }, { id: 'x', distanceKm: 1, active: false }] };
  var sales = [
    { storeId: 'a', title: '卵10個', price: 198, validFrom: '2026-11-08', validTo: '2026-11-10', status: 'active' },
    { storeId: 'a', title: 'たまご6個', price: 128, validFrom: '2026-11-09', validTo: '2026-11-09', status: 'active' },
    { storeId: 'far', title: '卵10個', price: 98, validFrom: '2026-11-08', validTo: '2026-11-10', status: 'active' },
    { storeId: 'x', title: '卵10個', price: 98, validFrom: '2026-11-08', validTo: '2026-11-10', status: 'active' },
    { storeId: 'a', title: '卵10個', price: 150, validFrom: '2026-11-08', validTo: '2026-11-10', status: 'withdrawn' },
    { storeId: 'a', title: '卵Mサイズ', price: 178, validFrom: '2026-11-12', validTo: '2026-11-12', status: 'active' }
  ];
  var d8 = M.matchesOn([egg], sales, stores, '2026-11-08');
  eq(d8.length === 1 && d8[0].sales.map(function (s) { return s.price; }), [198], '圏外・休止店・withdrawn を除く');
  var d9 = M.matchesOn([egg], sales, stores, '2026-11-09');
  eq(d9[0].sales.map(function (s) { return s.price; }), [128, 198], '安い順');
  eq(M.upcoming([egg], sales, stores, '2026-11-08').map(function (u) { return u.sale.price; }), [128, 178], '先の予定は翌日以降に始まるもの');
  eq(M.jstDate(0, new Date('2026-11-08T15:30:00Z')), '2026-11-09', 'JST の日付（UTC15:30=翌0:30）');
  eq(M.priceLabel({ price: 98, priceTaxIncl: 105.84 }), '98円（税込105.84円）', '価格表示');

  return (fails.length ? 'NG\n' + fails.join('\n') : 'OK') + ' (' + (n - fails.length) + '/' + n + ')';
}
