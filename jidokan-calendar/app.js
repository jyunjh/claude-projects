/*
 * 児童館イベントカレンダー — 表示ロジック
 * --------------------------------------------------
 * data/centers.json（児童館レジストリ）と data/events.json（取り込み済みイベント）を
 * 読み込み、地図/距離/対象年齢で絞り込んでカレンダー（またはリスト）に表示する。
 * ビルド不要のバニラJS。地図は Leaflet + OpenStreetMap（APIキー不要）。
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const state = {
  centers: [],
  events: [],
  centerById: {},
  selected: new Set(),     // 表示対象の児童館ID
  view: "calendar",        // "calendar" | "list"
  age: "all",              // "all" | "0-2" | "3-5" | "6-12"
  month: null,             // 表示中の月（Date: その月の1日）
  ref: null,               // 距離の基準点 { lat, lng } | null
  maxDist: 3,              // km
  hidePast: false,         // 終了したイベントを隠す
  meta: { mode: "sample", generatedAt: null }, // events.json のメタ情報
};

const TODAY_KEY = dateKey(new Date());

let map, markerLayer, refMarker;

/* ---------- 起動 ---------- */
async function init() {
  const now = new Date();
  state.month = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const [centers, events] = await Promise.all([
      fetch("data/centers.json").then((r) => r.json()),
      fetch("data/events.json").then((r) => r.json()),
    ]);
    state.centers = centers;
    // events.json は {mode, generatedAt, events} 形式 / 旧配列形式の両対応
    if (Array.isArray(events)) {
      state.events = events;
    } else {
      state.events = events.events || [];
      state.meta = { mode: events.mode || "sample", generatedAt: events.generatedAt || null };
    }
  } catch (e) {
    document.querySelector("main").innerHTML =
      `<p class="empty-state">データの読み込みに失敗しました（${e.message}）。<br>ローカルサーバー経由で開いてください。</p>`;
    return;
  }

  state.centerById = Object.fromEntries(state.centers.map((c) => [c.id, c]));
  state.selected = new Set(state.centers.map((c) => c.id)); // 既定は全館表示
  state.month = initialMonth(); // 当月にイベントが無ければ直近のある月へ

  renderStatusBar();
  buildCenterList();
  bindControls();
  initMap();
  render();
}

// 初期表示する月を決める: 当月にイベントがあれば当月、無ければ
// 今日以降で最も近いイベントの月へ。未来が無ければ直近過去の月、最後は当月。
function initialMonth() {
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!state.events.length) return cur;
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dates = state.events.map((e) => e.date).sort();
  if (dates.some((d) => d.startsWith(curYM))) return cur;
  const upcoming = dates.find((d) => d >= TODAY_KEY) || dates[dates.length - 1];
  const [y, m] = upcoming.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/* ---------- データ状態バー（モード / 最終更新） ---------- */
function renderStatusBar() {
  const bar = document.getElementById("statusBar");
  const live = state.meta.mode === "live";
  bar.className = "status-bar " + (live ? "live" : "sample");
  const updated = state.meta.generatedAt ? fmtDateTime(state.meta.generatedAt) : "—";
  if (live) {
    bar.innerHTML =
      `<span class="st-badge">実データ</span>` +
      `<span class="st-updated">最終更新: ${esc(updated)}</span>` +
      `<span>各館のPDF予定表から自動取得しています。</span>`;
  } else {
    bar.innerHTML =
      `<span class="st-badge">サンプル</span>` +
      `<span class="st-updated">最終更新: ${esc(updated)}</span>` +
      `<span>実データ化するには <code>data/centers.json</code> を確認し、<code>python3 ingest/ingest.py</code> を実行してください。</span>`;
  }
}

/* ---------- Gemini APIキー & 取り込み更新 ---------- */
function getApiKey() { return (localStorage.getItem("geminiKey") || "").trim(); }
function setApiKey(k) { localStorage.setItem("geminiKey", (k || "").trim()); }

function setUpdateStatus(msg, cls) {
  const el = document.getElementById("updateStatus");
  el.textContent = msg;
  el.className = "update-status" + (cls ? " " + cls : "");
}

// 「🔄 最新に更新」: ローカルサーバーの /api/ingest を叩いて取り込み → 画面を再読込
async function runUpdate() {
  const key = getApiKey();
  if (!key) {
    document.getElementById("keyBox").open = true;
    setUpdateStatus("先に Gemini APIキーを保存してください（⚙️API設定）。", "err");
    return;
  }
  const btn = document.getElementById("updateBtn");
  btn.disabled = true;
  setUpdateStatus("取り込み中…（各館のPDFを解析。30〜60秒ほどかかります）");
  try {
    const res = await fetch("api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    if (res.status === 404) {
      setUpdateStatus("このサーバーでは更新できません。`python3 serve.py` で起動してください。", "err");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUpdateStatus("更新に失敗しました: " + (data.error || `HTTP ${res.status}`), "err");
      return;
    }
    await refreshEvents();
    const okN = (data.ok || []).length, failN = (data.failed || []).length;
    setUpdateStatus(
      `更新しました（${data.total} 件 / 成功 ${okN} 館${failN ? ` ・失敗 ${failN} 館` : ""}）。`,
      failN ? "err" : "ok"
    );
  } catch (e) {
    setUpdateStatus("更新に失敗しました: " + e.message + "（serve.py で起動していますか？）", "err");
  } finally {
    btn.disabled = false;
  }
}

// events.json を読み直して画面を更新（ページ全体はリロードしない）
async function refreshEvents() {
  const raw = await fetch("data/events.json", { cache: "no-store" }).then((r) => r.json());
  if (Array.isArray(raw)) {
    state.events = raw;
  } else {
    state.events = raw.events || [];
    state.meta = { mode: raw.mode || "sample", generatedAt: raw.generatedAt || null };
  }
  state.month = initialMonth();
  renderStatusBar();
  render();
}

/* ---------- 児童館リスト ---------- */
function buildCenterList() {
  const ul = document.getElementById("centerList");
  ul.innerHTML = "";
  for (const c of state.centers) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.innerHTML = `
      <input type="checkbox" ${state.selected.has(c.id) ? "checked" : ""} />
      <span class="dot" style="background:${c.color}"></span>
      <span>
        <span class="c-name">${esc(c.name)}</span><br>
        <span class="c-meta">${esc(c.region)}</span>
      </span>
      <span class="c-dist" data-dist></span>`;
    li.querySelector("input").addEventListener("change", (ev) => {
      toggleCenter(c.id, ev.target.checked);
    });
    li.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT") return;
      const cb = li.querySelector("input");
      cb.checked = !cb.checked;
      toggleCenter(c.id, cb.checked);
    });
    ul.appendChild(li);
  }
}

function toggleCenter(id, on) {
  if (on) state.selected.add(id); else state.selected.delete(id);
  syncCenterListChecks();
  updateMarkerStyles();
  render();
}

function syncCenterListChecks() {
  document.querySelectorAll("#centerList li").forEach((li) => {
    li.querySelector("input").checked = state.selected.has(li.dataset.id);
  });
}

/* ---------- 地図 ---------- */
function initMap() {
  const center = state.centers.length
    ? [avg(state.centers.map((c) => c.lat)), avg(state.centers.map((c) => c.lng))]
    : [35.68, 139.76];
  map = L.map("map").setView(center, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  for (const c of state.centers) {
    const m = L.circleMarker([c.lat, c.lng], markerStyle(c, state.selected.has(c.id)))
      .addTo(markerLayer)
      .bindTooltip(`${c.name}<br>${c.region}`);
    m._centerId = c.id;
    m.on("click", () => {
      const on = !state.selected.has(c.id);
      if (on) state.selected.add(c.id); else state.selected.delete(c.id);
      syncCenterListChecks();
      updateMarkerStyles();
      render();
    });
  }
  // 地図クリックで基準点を設定
  map.on("click", (e) => setRef(e.latlng.lat, e.latlng.lng, "地図上の地点"));

  // 折りたたみを開いたとき地図サイズを再計算（detailsで初期非表示のため）
  document.getElementById("centerPanel").addEventListener("toggle", (e) => {
    if (e.target.open) setTimeout(() => map.invalidateSize(), 50);
  });
}

function markerStyle(c, selected) {
  return {
    radius: selected ? 9 : 6,
    color: "#fff",
    weight: 2,
    fillColor: c.color,
    fillOpacity: selected ? 0.95 : 0.35,
  };
}

function updateMarkerStyles() {
  if (!markerLayer) return;
  markerLayer.eachLayer((m) => {
    const c = state.centerById[m._centerId];
    if (c) m.setStyle(markerStyle(c, state.selected.has(c.id)));
  });
}

/* ---------- 基準点 & 距離 ---------- */
function setRef(lat, lng, label) {
  state.ref = { lat, lng, label };
  if (refMarker) refMarker.remove();
  refMarker = L.marker([lat, lng]).addTo(map).bindTooltip(label || "基準地").openTooltip();
  document.getElementById("distRow").hidden = false;
  applyDistance();
  map.setView([lat, lng], 13);
}

function clearRef() {
  state.ref = null;
  if (refMarker) { refMarker.remove(); refMarker = null; }
  document.getElementById("distRow").hidden = true;
  document.querySelectorAll("#centerList [data-dist]").forEach((el) => (el.textContent = ""));
  // 距離解除時は全館を選択し直す
  state.selected = new Set(state.centers.map((c) => c.id));
  syncCenterListChecks();
  updateMarkerStyles();
  render();
}

// 基準点から maxDist 以内の館だけを選択状態にする
function applyDistance() {
  if (!state.ref) return;
  const next = new Set();
  for (const c of state.centers) {
    const d = haversine(state.ref.lat, state.ref.lng, c.lat, c.lng);
    const el = document.querySelector(`#centerList li[data-id="${c.id}"] [data-dist]`);
    if (el) el.textContent = `${d.toFixed(1)} km`;
    if (d <= state.maxDist) next.add(c.id);
  }
  state.selected = next;
  syncCenterListChecks();
  updateMarkerStyles();
  render();
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------- コントロール ---------- */
function bindControls() {
  document.getElementById("prevMonth").onclick = () => shiftMonth(-1);
  document.getElementById("nextMonth").onclick = () => shiftMonth(1);
  document.getElementById("todayBtn").onclick = () => {
    const n = new Date();
    state.month = new Date(n.getFullYear(), n.getMonth(), 1);
    render();
  };

  document.getElementById("ageSelect").onchange = (e) => { state.age = e.target.value; render(); };
  document.getElementById("hidePast").onchange = (e) => { state.hidePast = e.target.checked; render(); };

  document.getElementById("viewCalendar").onclick = () => switchView("calendar");
  document.getElementById("viewList").onclick = () => switchView("list");

  document.getElementById("selectAll").onclick = () => {
    state.selected = new Set(state.centers.map((c) => c.id));
    syncCenterListChecks(); updateMarkerStyles(); render();
  };
  document.getElementById("selectNone").onclick = () => {
    state.selected = new Set();
    syncCenterListChecks(); updateMarkerStyles(); render();
  };

  document.getElementById("locateBtn").onclick = locateMe;
  document.getElementById("placeBtn").onclick = searchPlace;
  document.getElementById("placeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchPlace();
  });
  document.getElementById("clearRefBtn").onclick = clearRef;

  const slider = document.getElementById("distSlider");
  slider.oninput = (e) => {
    state.maxDist = +e.target.value;
    document.getElementById("distVal").textContent = state.maxDist;
    applyDistance();
  };

  // Gemini APIキーの保存 & 取り込み更新
  const keyInput = document.getElementById("apiKeyInput");
  keyInput.value = getApiKey();
  document.getElementById("saveKeyBtn").onclick = () => {
    setApiKey(keyInput.value);
    setUpdateStatus("APIキーを保存しました。", "ok");
  };
  document.getElementById("updateBtn").onclick = runUpdate;

  document.getElementById("eventClose").onclick = closeEvent;
  document.getElementById("eventOverlay").addEventListener("click", (e) => {
    if (e.target.id === "eventOverlay") closeEvent();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEvent(); });
}

function shiftMonth(delta) {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  render();
}

function switchView(v) {
  state.view = v;
  document.getElementById("viewCalendar").classList.toggle("active", v === "calendar");
  document.getElementById("viewList").classList.toggle("active", v === "list");
  document.getElementById("calendarView").hidden = v !== "calendar";
  document.getElementById("listView").hidden = v !== "list";
  render();
}

function locateMe() {
  if (!navigator.geolocation) { alert("この端末では現在地を取得できません。"); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => setRef(pos.coords.latitude, pos.coords.longitude, "現在地"),
    () => alert("現在地の取得に失敗しました。位置情報の許可をご確認ください。"),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Nominatim（OpenStreetMap）で地名→座標。無料・キー不要。
async function searchPlace() {
  const q = document.getElementById("placeInput").value.trim();
  if (!q) return;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ja&q=${encodeURIComponent(q + " 日本")}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await res.json();
    if (!data.length) { alert("場所が見つかりませんでした。"); return; }
    setRef(+data[0].lat, +data[0].lon, q);
  } catch (e) {
    alert("地名検索に失敗しました（" + e.message + "）。");
  }
}

/* ---------- 絞り込み ---------- */
function ageMatches(ev) {
  if (state.age === "all") return true;
  if (ev.ageMin == null && ev.ageMax == null) return true; // 「どなたでも」は常に表示
  const [lo, hi] = state.age.split("-").map(Number);
  const evLo = ev.ageMin ?? 0, evHi = ev.ageMax ?? 18;
  return evLo <= hi && evHi >= lo; // 範囲が重なれば該当
}

function isPast(ev) {
  return ev.date < TODAY_KEY;
}

function visibleEvents() {
  return state.events
    .filter((e) => state.selected.has(e.centerId) && ageMatches(e))
    .filter((e) => !(state.hidePast && isPast(e)))
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
}

/* ---------- 描画 ---------- */
function render() {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  document.getElementById("monthLabel").textContent = `${y}年 ${m + 1}月`;

  const sel = state.selected.size, total = state.centers.length;
  document.getElementById("selectedSummary").textContent =
    sel === total ? "すべての児童館を表示中" : `${sel} / ${total} 館を表示中`;

  renderLegend();

  if (state.view === "calendar") renderCalendar(y, m);
  else renderList(y, m);
}

// 表示中の児童館を「色 → 館名」の凡例として並べる
function renderLegend() {
  const el = document.getElementById("legend");
  const shown = state.centers.filter((c) => state.selected.has(c.id));
  el.innerHTML = shown.map((c) =>
    `<span class="lg"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}<span class="lg-region">${esc(c.region)}</span></span>`
  ).join("");
}

function eventsByDate(y, m) {
  const map = {};
  for (const e of visibleEvents()) {
    const d = new Date(e.date + "T00:00:00");
    if (d.getFullYear() === y && d.getMonth() === m) (map[e.date] ||= []).push(e);
  }
  return map;
}

function renderCalendar(y, m) {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  const byDate = eventsByDate(y, m);
  const monthCount = Object.values(byDate).reduce((s, a) => s + a.length, 0);
  document.getElementById("countHint").textContent = `今月 ${monthCount} 件`;

  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  for (let i = 0; i < startPad; i++) {
    const cell = document.createElement("div");
    cell.className = "day empty";
    grid.appendChild(cell);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const key = dateKey(date);
    const dow = date.getDay();
    const past = key < TODAY_KEY;
    const cell = document.createElement("div");
    cell.className = "day" + (dow === 0 ? " sun" : dow === 6 ? " sat" : "") +
      (key === TODAY_KEY ? " today" : "") + (past ? " past" : "");
    cell.innerHTML = `<span class="num">${d}</span>`;

    const list = (byDate[key] || []);
    const shown = list.slice(0, 3);
    for (const ev of shown) {
      const c = state.centerById[ev.centerId];
      const btn = document.createElement("button");
      btn.className = "ev" + (past ? " past" : "");
      btn.style.background = c ? c.color : "#888";
      btn.innerHTML = `${ev.start ? `<span class="ev-time">${ev.start}</span>` : ""}${esc(ev.title)}`;
      btn.onclick = () => openEvent(ev);
      cell.appendChild(btn);
    }
    if (list.length > shown.length) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = `他 ${list.length - shown.length} 件`;
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
}

function renderList(y, m) {
  const wrap = document.getElementById("listView");
  wrap.innerHTML = "";
  const byDate = eventsByDate(y, m);
  const dates = Object.keys(byDate).sort();
  const monthCount = dates.reduce((s, k) => s + byDate[k].length, 0);
  document.getElementById("countHint").textContent = `今月 ${monthCount} 件`;

  if (!dates.length) {
    wrap.innerHTML = `<p class="empty-state">この月に表示できるイベントがありません。<br>対象の児童館や対象年齢の条件をご確認ください。</p>`;
    return;
  }

  for (const key of dates) {
    const date = new Date(key + "T00:00:00");
    const dow = date.getDay();
    const day = document.createElement("div");
    day.className = "agenda-day";
    const wdClass = dow === 0 ? "wd-sun" : dow === 6 ? "wd-sat" : "";
    day.innerHTML = `<div class="agenda-date">${date.getMonth() + 1}/${date.getDate()} <span class="${wdClass}">(${WEEKDAYS[dow]})</span></div>`;

    for (const ev of byDate[key]) {
      const c = state.centerById[ev.centerId];
      const item = document.createElement("button");
      item.className = "agenda-item" + (isPast(ev) ? " past" : "");
      item.style.borderLeftColor = c ? c.color : "#888";
      item.innerHTML = `
        <span class="ai-time">${ev.start || ""}${ev.end ? "〜" + ev.end : ""}</span>
        <span>
          <span class="ai-title">${esc(ev.title)}</span><br>
          <span class="ai-meta">${esc(c ? c.name : "")}・${esc(ev.ageLabel || "対象年齢の記載なし")}</span>
        </span>`;
      item.onclick = () => openEvent(ev);
      day.appendChild(item);
    }
    wrap.appendChild(day);
  }
}

/* ---------- イベント詳細 ---------- */
function openEvent(ev) {
  const c = state.centerById[ev.centerId] || {};
  const date = new Date(ev.date + "T00:00:00");
  const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
  const timeStr = ev.start ? `${ev.start}${ev.end ? "〜" + ev.end : ""}` : "時間未定";

  document.getElementById("eventBody").innerHTML = `
    <h2>${esc(ev.title)}</h2>
    <span class="ev-center"><span class="dot" style="background:${c.color || "#888"}"></span>${esc(c.name || "")}（${esc(c.region || "")}）</span>
    <div class="detail-row"><span class="k">日付</span><span class="v">${dateStr}</span></div>
    <div class="detail-row"><span class="k">時間</span><span class="v">${timeStr}</span></div>
    <div class="detail-row"><span class="k">対象</span><span class="v">${esc(ev.ageLabel || "記載なし")}</span></div>
    ${ev.description ? `<div class="detail-row"><span class="k">内容</span><span class="v">${esc(ev.description)}</span></div>` : ""}
    ${c.address ? `<div class="detail-row"><span class="k">場所</span><span class="v">${esc(c.address)}</span></div>` : ""}
    <div class="ev-links">
      ${c.pdfUrl ? `<a class="pdf" href="${esc(c.pdfUrl)}" target="_blank" rel="noopener">📄 元の予定表</a>` : ""}
      ${c.officialUrl ? `<a class="site" href="${esc(c.officialUrl)}" target="_blank" rel="noopener">🔗 公式ページ</a>` : ""}
    </div>`;
  document.getElementById("eventOverlay").hidden = false;
}

function closeEvent() {
  document.getElementById("eventOverlay").hidden = true;
}

/* ---------- ユーティリティ ---------- */
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// ISO文字列 → "2026年6月29日 09:00"。失敗時は元の文字列を返す。
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

init();
