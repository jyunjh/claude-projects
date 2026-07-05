/* マンション検索 — 勝どき・晴海
 * data/listings.json（賃貸・重複グルーピング済み）と data/buy.json（中古販売）を
 * 読み込んで表示する。サーバー処理なしの静的アプリ。
 */

const state = {
  rooms: [],
  meta: {},
  buy: [],
  buyMeta: {},
  shown: 50,
  selectedBuy: null,
};

const yen = (n) => n == null ? "-" : n.toLocaleString("ja-JP");
const man = (n) => n == null ? "-" : (n / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 1 });

function ageYears(ageText) {
  if (/新築/.test(ageText || "")) return 0;
  const m = /築(\d+)年/.exec(ageText || "");
  return m ? +m[1] : null;
}

/* 初期費用の概算（円）: 敷金 + 礼金 + 前家賃(賃料+管理費) + 仲介手数料
 * 仲介手数料は詳細取得済みならその月数、未取得なら1.1ヶ月と仮定（assumed=true）。
 * 鍵交換・火災保険・保証会社費用は会社毎に幅があるため合計には含めない。 */
function initCost(l) {
  let months = 1.1, assumed = true;
  if (l.chukai) {
    if (/無料|不要/.test(l.chukai)) { months = 0; assumed = false; }
    else if (/半月/.test(l.chukai)) { months = 0.55; assumed = false; }
    else {
      const m = /([\d.]+)ヶ月/.exec(l.chukai);
      if (m) { months = +m[1]; assumed = false; }
    }
  }
  const chukai = Math.round(l.rent * months);
  return {
    total: l.deposit + l.reikin + l.rent + (l.admin || 0) + chukai,
    chukai, assumed,
  };
}

function bestListing(g) {
  let best = null;
  for (const l of g.listings) {
    const c = initCost(l);
    if (!best || c.total < best.cost.total) best = { l, cost: c };
  }
  return best;
}

/* ---------------------------------------------------------------- 賃貸タブ */

const LAYOUT_ORDER = ["ワンルーム", "1K", "1DK", "1LDK", "2K", "2DK", "2LDK", "3K", "3DK", "3LDK", "4LDK"];

function setupRentFilters() {
  const rentSel = [30, 50, 80, 100, 120, 150, 180, 200, 250, 300, 400, 500];
  const min = document.getElementById("f-rent-min");
  const max = document.getElementById("f-rent-max");
  for (const v of rentSel) {
    min.insertAdjacentHTML("beforeend", `<option value="${v * 1000}">${v / 10}万円</option>`);
    max.insertAdjacentHTML("beforeend", `<option value="${v * 1000}">${v / 10}万円</option>`);
  }
  const layouts = [...new Set(state.rooms.map(r => r.layout))]
    .sort((a, b) => (LAYOUT_ORDER.indexOf(a) + 99) - (LAYOUT_ORDER.indexOf(b) + 99) || a.localeCompare(b));
  const lay = document.getElementById("f-layout");
  lay.insertAdjacentHTML("beforeend", `<option value="" selected>すべて</option>`);
  for (const l of layouts) lay.insertAdjacentHTML("beforeend", `<option value="${l}">${l}</option>`);

  document.querySelectorAll("#tab-rent select, #tab-rent input").forEach(el =>
    el.addEventListener("input", () => { state.shown = 50; renderRooms(); }));
  document.getElementById("load-more").addEventListener("click", () => {
    state.shown += 50;
    renderRooms();
  });
}

function filteredRooms() {
  const area = document.getElementById("f-area").value;
  const rmin = +document.getElementById("f-rent-min").value || 0;
  const rmax = +document.getElementById("f-rent-max").value || Infinity;
  const layout = document.getElementById("f-layout").value;
  const amin = +document.getElementById("f-area-min").value || 0;
  const agemax = document.getElementById("f-age-max").value;
  const q = document.getElementById("f-name").value.trim();
  const sort = document.getElementById("f-sort").value;

  let rooms = state.rooms.filter(r =>
    (!area || r.address.includes(area)) &&
    r.min_rent >= rmin && r.min_rent <= rmax &&
    (!layout || r.layout === layout) &&
    r.area_m2 >= amin &&
    (!agemax || (ageYears(r.age) != null && ageYears(r.age) <= +agemax)) &&
    (!q || r.name.includes(q))
  );

  const keyFns = {
    "rent-asc": r => r.min_rent,
    "rent-desc": r => -r.min_rent,
    "init-asc": r => bestListing(r).cost.total,
    "unit-asc": r => r.area_m2 ? r.min_rent / r.area_m2 : Infinity,
    "area-desc": r => -r.area_m2,
    "age-asc": r => ageYears(r.age) ?? 999,
    "dup-desc": r => -r.listings.length,
  };
  const fn = keyFns[sort] || keyFns["rent-asc"];
  rooms.sort((a, b) => fn(a) - fn(b));
  return rooms;
}

function listingRows(g) {
  const rows = g.listings
    .map(l => ({ l, cost: initCost(l) }))
    .sort((a, b) => a.cost.total - b.cost.total);
  const best = rows[0];
  return { rows, best };
}

function renderRooms() {
  const rooms = filteredRooms();
  const listingCount = rooms.reduce((s, r) => s + r.listings.length, 0);

  document.getElementById("stats-bar").innerHTML = `
    ${state.meta.exclude_teishaku ? '<span class="badge">定期借家 除外</span>' : ""}
    <span><b>${rooms.length}</b> 部屋タイプ（掲載 ${listingCount} 件を重複整理）</span>
    <span>データ更新: ${(state.meta.generated_at || "").replace("T", " ").slice(0, 16)}</span>`;

  const el = document.getElementById("room-list");
  if (!rooms.length) {
    el.innerHTML = `<div class="empty">条件に合う部屋がありません</div>`;
    document.getElementById("load-more").hidden = true;
    return;
  }

  el.innerHTML = rooms.slice(0, state.shown).map((g, i) => {
    const { rows, best } = listingRows(g);
    const unitPrice = g.area_m2 ? Math.round(g.min_rent / g.area_m2).toLocaleString() : "-";
    const floorsText = g.floors && g.floors.length ? g.floors.join("・") : "階数 -";
    const agencyHtml = best.l.agency
      ? `<span class="agency">${best.l.agency}</span>`
      : `<a href="${best.l.url}" target="_blank" rel="noopener">SUUMOで確認</a>`;
    const table = rows.map((r, j) => `
      <tr class="${j === 0 ? "best" : ""}">
        <td>${j === 0 ? "🏆" : ""} ${r.l.agency || '<span class="room-sub">非公開</span>'}</td>
        <td>${man(r.l.rent)}万円</td>
        <td>敷 ${man(r.l.deposit)}万 / 礼 ${man(r.l.reikin)}万</td>
        <td>${r.l.chukai || "仲介 不明"}</td>
        <td class="total">約${man(r.cost.total)}万円${r.cost.assumed ? "※" : ""}</td>
        <td><a href="${r.l.url}" target="_blank" rel="noopener">SUUMO ↗</a></td>
      </tr>`).join("");

    return `
    <div class="card room-card">
      <div class="room-head">
        <span class="room-name">${g.name || "（建物名 非公開）"}</span>
        <span class="room-sub">${g.address} ／ ${g.age}</span>
        ${g.listings.length > 1 ? `<span class="dup-badge">${g.listings.length}社掲載</span>` : ""}
      </div>
      <div class="room-body">
        <span class="rent-price">${man(g.min_rent)}<small>万円${g.max_rent > g.min_rent ? `〜${man(g.max_rent)}万円` : ""} + 管理費${yen(best.l.admin)}円</small></span>
        <span class="spec"><b>${floorsText}</b> / ${g.layout} / ${g.area_m2}㎡</span>
        <span class="spec room-sub">㎡単価 ${unitPrice}円</span>
        <span class="spec room-sub">${(g.access[0] || "")}</span>
      </div>
      <div class="init-cost">
        初期費用最安: ${agencyHtml} — 敷 ${man(best.l.deposit)}万 + 礼 ${man(best.l.reikin)}万 + 前家賃 + 仲介${best.cost.assumed ? '<span class="assumed">(1.1ヶ月と仮定※)</span>' : `(${best.l.chukai})`}
        = <span class="total">約 ${man(best.cost.total)} 万円</span>
        <button class="listing-toggle" data-idx="${i}">掲載 ${g.listings.length} 件の比較 ▾</button>
        <div class="listing-detail" hidden>
          <table class="listing-table">
            <tr><th>不動産会社</th><th>賃料</th><th>敷金/礼金</th><th>仲介手数料</th><th>初期費用概算</th><th></th></tr>
            ${table}
          </table>
        </div>
      </div>
    </div>`;
  }).join("");

  document.getElementById("load-more").hidden = rooms.length <= state.shown;

  el.querySelectorAll(".listing-toggle").forEach(btn =>
    btn.addEventListener("click", () => {
      const d = btn.parentElement.querySelector(".listing-detail");
      d.hidden = !d.hidden;
    }));
}

/* ---------------------------------------------------------------- 比較タブ */

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function renderMarketSummary() {
  const rentUnit = median(state.rooms.filter(r => r.area_m2 > 0)
    .map(r => r.min_rent / r.area_m2));
  const buyUnit = median(state.buy.filter(b => b.area_m2 > 0)
    .map(b => b.price / b.area_m2));
  const gross = rentUnit && buyUnit ? (rentUnit * 12) / buyUnit * 100 : null;
  const per = gross ? 100 / gross : null;

  document.getElementById("market-summary").innerHTML = `
    <div class="metric"><div class="m-label">賃料相場（中央値）</div>
      <div class="m-value">${rentUnit ? Math.round(rentUnit).toLocaleString() : "-"}円/㎡</div>
      <div class="m-note">賃貸 ${state.rooms.length} 部屋から</div></div>
    <div class="metric"><div class="m-label">中古販売相場（中央値）</div>
      <div class="m-value">${buyUnit ? man(Math.round(buyUnit)) : "-"}万円/㎡</div>
      <div class="m-note">販売中 ${state.buy.length} 件から</div></div>
    <div class="metric"><div class="m-label">表面利回り（相場比）</div>
      <div class="m-value">${gross ? gross.toFixed(2) : "-"}%</div>
      <div class="m-note">年間賃料 ÷ 販売価格</div></div>
    <div class="metric"><div class="m-label">価格は家賃の何年分か</div>
      <div class="m-value">${per ? per.toFixed(1) : "-"}年</div>
      <div class="m-note">低いほど購入が有利</div></div>`;
}

function renderBuyList() {
  const area = document.getElementById("b-area").value;
  const sort = document.getElementById("b-sort").value;
  let units = state.buy.filter(b => !area || b.address.includes(area));
  const keyFns = {
    "price-asc": b => b.price,
    "price-desc": b => -b.price,
    "unit-asc": b => b.area_m2 ? b.price / b.area_m2 : Infinity,
    "area-desc": b => -b.area_m2,
  };
  units.sort((a, b) => keyFns[sort](a) - keyFns[sort](b));

  const el = document.getElementById("buy-list");
  if (!units.length) {
    el.innerHTML = `<div class="empty">購入データがありません（ingest を実行してください）</div>`;
    return;
  }
  el.innerHTML = units.map((b, i) => `
    <div class="buy-card ${state.selectedBuy === b.url ? "selected" : ""}" data-i="${i}">
      <div class="buy-name">${b.name}</div>
      <div class="buy-price">${man(b.price)}万円 <small>（${b.area_m2 ? man(Math.round(b.price / b.area_m2)) : "-"}万円/㎡）</small></div>
      <div class="buy-specs">${b.layout} / ${b.area_m2}㎡ / ${b.built} ／ ${b.address}</div>
      <div class="buy-specs">${b.access} <a href="${b.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">SUUMO ↗</a></div>
    </div>`).join("");

  el.querySelectorAll(".buy-card").forEach(card =>
    card.addEventListener("click", () => {
      const b = units[+card.dataset.i];
      state.selectedBuy = b.url;
      document.getElementById("c-price").value = Math.round(b.price / 10000);
      // 同エリア・±20%面積の賃貸中央値を「比較する家賃」に自動セット
      const similar = state.rooms.filter(r =>
        r.area_m2 > b.area_m2 * 0.8 && r.area_m2 < b.area_m2 * 1.2);
      const m = median(similar.map(r => r.min_rent + (r.listings[0].admin || 0)));
      if (m) document.getElementById("c-rent").value = Math.round(m / 10000);
      renderBuyList();
      calc();
      document.querySelector(".calc").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
}

function calc() {
  const price = +document.getElementById("c-price").value * 10000;
  const down = +document.getElementById("c-down").value * 10000;
  const rate = +document.getElementById("c-rate").value / 100 / 12;
  const years = +document.getElementById("c-years").value;
  const hoa = +document.getElementById("c-hoa").value * 10000;
  const tax = +document.getElementById("c-tax").value * 10000;
  const feesPct = +document.getElementById("c-fees").value / 100;
  const rent = +document.getElementById("c-rent").value * 10000;
  const horizon = +document.getElementById("c-horizon").value;
  const resalePct = +document.getElementById("c-resale").value / 100;

  const n = years * 12;
  const principal = Math.max(0, price - down);
  const pay = rate > 0
    ? principal * rate * Math.pow(1 + rate, n) / (Math.pow(1 + rate, n) - 1)
    : principal / n;

  const monthlyOwn = pay + hoa + tax / 12;

  // 居住期間終了時のローン残高（元利均等）
  const m = Math.min(horizon * 12, n);
  const balance = rate > 0
    ? principal * (Math.pow(1 + rate, n) - Math.pow(1 + rate, m)) / (Math.pow(1 + rate, n) - 1)
    : principal * (1 - m / n);

  // 購入の実質コスト = 頭金 + 諸費用 + 支払累計 + 残債返済 − 売却額
  const buyCost = down + price * feesPct + (pay + hoa + tax / 12) * m + balance - price * resalePct;
  // 賃貸コスト = 家賃累計 + 初期費用(敷礼仲介で家賃4ヶ月と仮定) + 更新料(2年毎に1ヶ月)
  const rentCost = rent * m + rent * 4 + rent * Math.floor(horizon / 2);

  const diff = rentCost - buyCost;
  const verdict = diff > 0
    ? `<div class="verdict buy">購入が約 ${man(Math.round(diff))} 万円 有利（${horizon}年住んだ場合）</div>`
    : `<div class="verdict rent">賃貸が約 ${man(Math.round(-diff))} 万円 有利（${horizon}年住んだ場合）</div>`;

  document.getElementById("calc-result").innerHTML = `
    <div class="result-row"><span>月々の支払い（購入: ローン+管理修繕+固税）</span><b>${man(Math.round(monthlyOwn))}万円/月</b></div>
    <div class="result-row"><span>月々の支払い（賃貸）</span><b>${man(rent)}万円/月</b></div>
    <div class="result-row"><span>ローン返済額（月）</span><span>${man(Math.round(pay))}万円</span></div>
    <div class="result-row"><span>${horizon}年後のローン残高</span><span>${man(Math.round(balance))}万円</span></div>
    <div class="result-row"><span>購入 実質コスト（売却額 ${Math.round(resalePct * 100)}% で手放した場合）</span><b>${man(Math.round(buyCost))}万円</b></div>
    <div class="result-row"><span>賃貸 総コスト（初期費用+更新料込み）</span><b>${man(Math.round(rentCost))}万円</b></div>
    ${verdict}
    <div class="m-note" style="margin-top:8px">前提: 家賃上昇なし・購入諸費用${Math.round(feesPct * 100)}%・賃貸初期費用は家賃4ヶ月分・更新料は2年毎に1ヶ月分。税制優遇（住宅ローン控除等）は含みません。</div>`;
}

/* ---------------------------------------------------------------- 初期化 */

function setupTabs() {
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
      document.querySelectorAll(".tab-panel").forEach(p =>
        p.classList.toggle("active", p.id === "tab-" + t.dataset.tab));
    }));
}

async function loadJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function init() {
  setupTabs();
  const [rent, buy] = await Promise.all([
    loadJson("data/listings.json"),
    loadJson("data/buy.json"),
  ]);
  if (rent) {
    state.meta = rent;
    state.rooms = rent.rooms || [];
  }
  if (buy) {
    state.buyMeta = buy;
    state.buy = buy.units || [];
  }
  if (!rent) {
    document.getElementById("room-list").innerHTML =
      `<div class="empty">data/listings.json がありません。<br><code>python3 ingest/scrape_suumo.py</code> を実行してください。</div>`;
  }
  setupRentFilters();
  renderRooms();
  renderMarketSummary();
  renderBuyList();
  document.getElementById("b-area").addEventListener("input", renderBuyList);
  document.getElementById("b-sort").addEventListener("input", renderBuyList);
  document.querySelectorAll(".calc-inputs input").forEach(el =>
    el.addEventListener("input", calc));
  calc();
}

init();
