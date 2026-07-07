/*
 * 児童館イベントカレンダー — 表示ロジック
 * --------------------------------------------------
 * data/wards.json（23区メタ）を読み、選択中の区の
 * data/centers/<ward>.json（児童館レジストリ）と data/events/<ward>.json（取り込み済みイベント）を
 * 遅延読み込みし、地図/距離/対象年齢で絞り込んでカレンダー（またはリスト）に表示する。
 * ビルド不要のバニラJS。地図は Leaflet + OpenStreetMap（APIキー不要）。
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DEFAULT_WARDS = ["edogawa", "koto"];   // 初回既定の対象区
const LEGEND_CAP = 12;                        // 凡例に常時出す上限（超過分は「他N館」）

const state = {
  wards: [],               // wards.json 全区（status 付き）
  wardById: {},
  activeWards: [],          // 対象として選択中の区ID（表示順を保つため配列）
  loadedWards: new Set(),   // centers/events を fetch 済みの区ID
  wardMeta: {},             // wardId -> { mode, generatedAt, hasEvents }
  centers: [],             // 読み込み済み区の全館
  events: [],              // 読み込み済み区の全イベント
  centerById: {},
  selected: new Set(),     // 表示対象の児童館ID
  view: "calendar",        // "calendar" | "list"
  age: "all",              // "all" | "0-2" | "3-5" | "6-12"
  month: null,             // 表示中の月（Date: その月の1日）
  ref: null,               // 距離の基準点 { lat, lng } | null
  maxDist: 3,              // km
  hidePast: false,         // 終了したイベントを隠す
  legendExpanded: false,   // 凡例の「他N館」を展開中か
};

const TODAY_KEY = dateKey(new Date());

let map, markerLayer, refMarker;

/* ---------- 起動 ---------- */
async function init() {
  const now = new Date();
  state.month = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    state.wards = await fetch("data/wards.json").then((r) => r.json());
  } catch (e) {
    document.querySelector("main").innerHTML =
      `<p class="empty-state">データの読み込みに失敗しました（${e.message}）。<br>ローカルサーバー経由で開いてください。</p>`;
    return;
  }
  state.wardById = Object.fromEntries(state.wards.map((w) => [w.id, w]));

  // 対象区の初期値: localStorage("selectedWards") ＞ 既定 ["edogawa","koto"]。
  // covered な区に限定し、1つも残らなければ covered 区の全体へフォールバック。
  const covered = state.wards.filter((w) => w.status === "covered").map((w) => w.id);
  const saved = readSelectedWards();
  let wanted = (saved || DEFAULT_WARDS).filter((id) => covered.includes(id));
  if (!wanted.length) wanted = covered.slice();
  state.activeWards = coveredOrder(wanted);

  // 選択中の区データを読み込む（未取得の区のみ fetch。events 404 は空扱い）。
  await Promise.all(state.activeWards.map(loadWard));
  rebuildCenterIndex();
  state.selected = new Set(state.centers.map((c) => c.id)); // 既定は読み込んだ全館を表示
  state.month = initialMonth(); // 当月にイベントが無ければ直近のある月へ

  // スマホ（狭い画面）では、全文が読めるリスト表示を初期選択にする
  if (window.matchMedia("(max-width: 640px)").matches) {
    state.view = "list";
    document.getElementById("viewCalendar").classList.remove("active");
    document.getElementById("viewList").classList.add("active");
    document.getElementById("calendarView").hidden = true;
    document.getElementById("listView").hidden = false;
  }

  // 公開サイト（localhost 以外）では取り込みAPIが無いため、更新UIを隠す。
  // ローカルの serve.py で開いたときだけ「🔄最新に更新／⚙️API設定」を表示。
  const isLocal = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  if (!isLocal) {
    const tools = document.querySelector(".data-tools");
    if (tools) tools.hidden = true;
  }

  renderWardChips();
  renderStatusBar();
  buildCenterList();
  bindControls();
  initMap();
  render();
}

/* ---------- 対象区（wards）の選択・遅延読み込み ---------- */
// localStorage から選択区を読む（不正・未設定なら null）。
function readSelectedWards() {
  try {
    const raw = localStorage.getItem("selectedWards");
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : null;
  } catch (e) {
    return null;
  }
}
function writeSelectedWards() {
  try { localStorage.setItem("selectedWards", JSON.stringify(state.activeWards)); }
  catch (e) { /* プライベートモード等では保存できないが致命的ではない */ }
}
// 与えた区IDを wards.json（covered）の並び順に整える。
function coveredOrder(ids) {
  const set = new Set(ids);
  return state.wards.filter((w) => w.status === "covered" && set.has(w.id)).map((w) => w.id);
}

// 1区分の centers/events を読み込む（未取得の区のみ）。events が無ければ(404)空扱い。
async function loadWard(wardId) {
  if (state.loadedWards.has(wardId)) return;
  let centers = [];
  try {
    centers = await fetch(`data/centers/${wardId}.json`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  } catch (e) {
    console.warn(`区データの読み込みに失敗: ${wardId}`, e);
    centers = [];
  }
  // 各館に wardId を付与（区見出し・グルーピング用）
  for (const c of centers) c.wardId = wardId;
  state.centers.push(...centers);

  // events は無い区もある（covered だが未取込）。404/失敗は空扱い。
  let mode = "sample", generatedAt = null, hasEvents = false;
  try {
    const raw = await fetch(`data/events/${wardId}.json`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    const evs = Array.isArray(raw) ? raw : (raw.events || []);
    state.events.push(...evs);
    mode = Array.isArray(raw) ? "sample" : (raw.mode || "sample");
    generatedAt = Array.isArray(raw) ? null : (raw.generatedAt || null);
    hasEvents = evs.length > 0;
  } catch (e) {
    hasEvents = false; // events が無い/取れない区は未取込扱い（落とさない）
  }
  state.wardMeta[wardId] = { mode, generatedAt, hasEvents };
  state.loadedWards.add(wardId);
}

// centerById を読み込み済み全館から作り直す。
function rebuildCenterIndex() {
  state.centerById = Object.fromEntries(state.centers.map((c) => [c.id, c]));
}

// 表示中（activeWards）の館のみを返す（未選択区を外した後の掃除に使う）。
function activeCenters() {
  const set = new Set(state.activeWards);
  return state.centers.filter((c) => set.has(c.wardId));
}

// 区チップの選択状態を切り替える。
async function toggleWard(wardId, on) {
  if (on) {
    if (!state.activeWards.includes(wardId)) {
      state.activeWards = coveredOrder([...state.activeWards, wardId]);
      await loadWard(wardId);
      rebuildCenterIndex();
      // 新たに読み込んだ区の館を選択状態に加える
      for (const c of state.centers) if (c.wardId === wardId) state.selected.add(c.id);
    }
  } else {
    state.activeWards = state.activeWards.filter((id) => id !== wardId);
    // 外した区の館を選択状態から除外
    for (const c of state.centers) if (c.wardId === wardId) state.selected.delete(c.id);
  }
  writeSelectedWards();
  state.month = initialMonth();
  renderWardChips();
  buildCenterList();
  rebuildMarkers();
  renderStatusBar();
  render();
}

// 対象の区チップ行を描画（covered の区のみ）。
function renderWardChips() {
  const row = document.getElementById("wardChips");
  if (!row) return;
  const active = new Set(state.activeWards);
  row.innerHTML = "";
  for (const w of state.wards) {
    if (w.status !== "covered") continue;
    const btn = document.createElement("button");
    btn.className = "ward-chip" + (active.has(w.id) ? " on" : "");
    btn.type = "button";
    btn.textContent = w.name;
    btn.setAttribute("aria-pressed", active.has(w.id) ? "true" : "false");
    btn.onclick = () => toggleWard(w.id, !active.has(w.id));
    row.appendChild(btn);
  }
  updateWardSummary();
}

// wardPanel の summary ヒントに、選択中の区名を「・」区切りで表示（未選択なら「未選択」）。
function updateWardSummary() {
  const hint = document.getElementById("wardSummary");
  if (!hint) return;
  const names = state.activeWards
    .map((id) => state.wardById[id] && state.wardById[id].name)
    .filter(Boolean);
  hint.textContent = names.length ? names.join("・") : "未選択";
}

// 初期表示する月を決める: 当月にイベントがあれば当月、無ければ
// 今日以降で最も近いイベントの月へ。未来が無ければ直近過去の月、最後は当月。
function initialMonth() {
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!state.events.length) return cur;
  // イベント件数が最も多い月を初期表示（同数なら新しい月）。
  // 月刊の予定表データでは、その月が「いま見たい月」になることが多い。
  const byYM = {};
  for (const e of state.events) {
    const ym = e.date.slice(0, 7);
    byYM[ym] = (byYM[ym] || 0) + 1;
  }
  let best = null, bestN = -1;
  for (const ym of Object.keys(byYM).sort()) {
    if (byYM[ym] >= bestN) { bestN = byYM[ym]; best = ym; }
  }
  const [y, m] = best.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/* ---------- データ状態バー（対象区 / モード / 最終更新） ---------- */
function renderStatusBar() {
  const bar = document.getElementById("statusBar");
  // 選択区のどれか一つでも live なら「実データ」バッジ
  const live = state.activeWards.some((id) => (state.wardMeta[id] || {}).mode === "live");
  bar.className = "status-bar " + (live ? "live" : "sample");

  // 「対象: 江戸川区・江東区」（wards.json の並び順）
  const names = state.activeWards.map((id) => (state.wardById[id] || { name: id }).name);
  const target = names.length ? names.join("・") : "（区を選択してください）";

  // 最終更新は選択区の generatedAt の最大（ISO文字列は辞書順比較でよい）
  let latest = null;
  for (const id of state.activeWards) {
    const g = (state.wardMeta[id] || {}).generatedAt;
    if (g && (!latest || g > latest)) latest = g;
  }
  const updated = latest ? fmtDateTime(latest) : "—";

  // イベント未取込（events が無い/空）の区は注記を後置
  const pendingNames = state.activeWards
    .filter((id) => !(state.wardMeta[id] || {}).hasEvents)
    .map((id) => (state.wardById[id] || { name: id }).name);
  const pending = pendingNames.length
    ? `<span class="st-pending">（${esc(pendingNames.join("・"))}は予定未取込）</span>` : "";

  bar.innerHTML =
    `<span class="st-badge">${live ? "実データ" : "サンプル"}</span>` +
    `<span class="st-target">対象: ${esc(target)}</span>` +
    `<span class="st-updated">最終更新: ${esc(updated)}</span>` +
    pending +
    (live ? "" :
      `<span>実データ化するには <code>python3 ingest/ingest.py --ward &lt;区ID&gt;</code> を実行してください。</span>`);
}

/* ---------- Gemini APIキー & 取り込み更新 ---------- */
function getApiKey() { return (localStorage.getItem("geminiKey") || "").trim(); }
function setApiKey(k) { localStorage.setItem("geminiKey", (k || "").trim()); }

function setUpdateStatus(msg, cls) {
  const el = document.getElementById("updateStatus");
  el.textContent = msg;
  el.className = "update-status" + (cls ? " " + cls : "");
}

// 「🔄 最新に更新」: 選択中の区を1区ずつローカルサーバーの /api/ingest へ投げ、
// 失敗しても次の区へ進み、最後に結果を集約表示する。
async function runUpdate() {
  const key = getApiKey();
  if (!key) {
    document.getElementById("keyBox").open = true;
    setUpdateStatus("先に Gemini APIキーを保存してください（⚙️API設定）。", "err");
    return;
  }
  if (!state.activeWards.length) {
    setUpdateStatus("対象の区が選択されていません。", "err");
    return;
  }
  const btn = document.getElementById("updateBtn");
  btn.disabled = true;

  let totalEv = 0, okCenters = 0, failCenters = 0;
  const failedWards = [];
  try {
    for (let i = 0; i < state.activeWards.length; i++) {
      const wardId = state.activeWards[i];
      const wardName = (state.wardById[wardId] || { name: wardId }).name;
      setUpdateStatus(`取り込み中… ${wardName}（${i + 1}/${state.activeWards.length} 区。各館のPDFを解析します）`);
      try {
        const res = await fetch("api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: key, ward: wardId }),
        });
        if (res.status === 404) {
          setUpdateStatus("このサーバーでは更新できません。`python3 serve.py` で起動してください。", "err");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failedWards.push(`${wardName}: ${data.error || `HTTP ${res.status}`}`);
          continue; // 失敗しても次の区へ
        }
        totalEv += data.total || 0;
        okCenters += (data.ok || []).length;
        failCenters += (data.failed || []).length;
      } catch (e) {
        failedWards.push(`${wardName}: ${e.message}`);
      }
    }
    await refreshEvents();
    let msg = `更新しました（${totalEv} 件 / 成功 ${okCenters} 館${failCenters ? ` ・失敗 ${failCenters} 館` : ""}）。`;
    if (failedWards.length) msg += ` 失敗した区: ${failedWards.join(" / ")}`;
    setUpdateStatus(msg, (failedWards.length || failCenters) ? "err" : "ok");
  } catch (e) {
    setUpdateStatus("更新に失敗しました: " + e.message + "（serve.py で起動していますか？）", "err");
  } finally {
    btn.disabled = false;
  }
}

// 選択区の events/<ward>.json を読み直して画面を更新（ページ全体はリロードしない）
async function refreshEvents() {
  for (const wardId of state.activeWards) {
    let mode = "sample", generatedAt = null, hasEvents = false, evs = [];
    try {
      const raw = await fetch(`data/events/${wardId}.json`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      evs = Array.isArray(raw) ? raw : (raw.events || []);
      mode = Array.isArray(raw) ? "sample" : (raw.mode || "sample");
      generatedAt = Array.isArray(raw) ? null : (raw.generatedAt || null);
      hasEvents = evs.length > 0;
    } catch (e) {
      /* 未取込の区は空扱い */
    }
    // この区の旧イベントを入れ替える
    const centerIds = new Set(state.centers.filter((c) => c.wardId === wardId).map((c) => c.id));
    state.events = state.events.filter((e) => !centerIds.has(e.centerId));
    state.events.push(...evs);
    state.wardMeta[wardId] = { mode, generatedAt, hasEvents };
  }
  state.month = initialMonth();
  renderStatusBar();
  render();
}

/* ---------- 児童館リスト（区ごとの見出しでグルーピング） ---------- */
function buildCenterList() {
  const ul = document.getElementById("centerList");
  ul.innerHTML = "";
  for (const wardId of state.activeWards) {
    const wardCenters = state.centers.filter((c) => c.wardId === wardId);
    if (!wardCenters.length) continue;
    // 区見出し
    const head = document.createElement("li");
    head.className = "ward-head";
    head.textContent = (state.wardById[wardId] || { name: wardId }).name;
    ul.appendChild(head);
    for (const c of wardCenters) {
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
}

function toggleCenter(id, on) {
  if (on) state.selected.add(id); else state.selected.delete(id);
  syncCenterListChecks();
  updateMarkerStyles();
  render();
}

function syncCenterListChecks() {
  document.querySelectorAll("#centerList li[data-id]").forEach((li) => {
    li.querySelector("input").checked = state.selected.has(li.dataset.id);
  });
}

/* ---------- 地図 ---------- */
const NISHIKASAI = [35.6646, 139.8593]; // 西葛西駅（初期データ時代の中心・フォールバック）

// 地図の既定中心: 選択区の施設の重心（施設が無ければ区の代表座標、それも無ければ西葛西）
function defaultMapCenter() {
  const cs = activeCenters();
  if (cs.length) {
    const lat = cs.reduce((s, c) => s + c.lat, 0) / cs.length;
    const lng = cs.reduce((s, c) => s + c.lng, 0) / cs.length;
    return [lat, lng];
  }
  if (state.activeWards.length === 1) {
    const w = state.wardById[state.activeWards[0]];
    if (w) return [w.lat, w.lng];
  }
  return NISHIKASAI;
}

function initMap() {
  map = L.map("map").setView(defaultMapCenter(), 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  rebuildMarkers({ recenter: false });

  // 地図クリックで基準点を設定
  map.on("click", (e) => setRef(e.latlng.lat, e.latlng.lng, "地図上の地点"));

  // 折りたたみを開いたとき地図サイズを再計算（detailsで初期非表示のため）
  document.getElementById("centerPanel").addEventListener("toggle", (e) => {
    if (e.target.open) setTimeout(() => map.invalidateSize(), 50);
  });
}

// 選択区の館のマーカーだけを描き直す（区の切替時に呼ぶ）。
function rebuildMarkers({ recenter = true } = {}) {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  for (const c of activeCenters()) {
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
  // 基準地の指定が無いときは、選択区の重心へ寄せ直す
  if (recenter && !state.ref) map.setView(defaultMapCenter(), map.getZoom());
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
  // 距離解除時は選択区内の全館を選択し直す
  state.selected = new Set(activeCenters().map((c) => c.id));
  syncCenterListChecks();
  updateMarkerStyles();
  render();
}

// 基準点から maxDist 以内の館（選択区内）だけを選択状態にする
function applyDistance() {
  if (!state.ref) return;
  const next = new Set();
  for (const c of activeCenters()) {
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
    // 読み込み済みの選択区内で全選択
    state.selected = new Set(activeCenters().map((c) => c.id));
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

  const sel = state.selected.size, total = activeCenters().length;
  document.getElementById("selectedSummary").textContent =
    sel === total ? "すべての児童館を表示中" : `${sel} / ${total} 館を表示中`;

  // 当月の表示対象を取得し、連続開催（期間中の催し）と単発に分ける
  const monthEvs = visibleEvents().filter((e) => {
    const d = new Date(e.date + "T00:00:00");
    return d.getFullYear() === y && d.getMonth() === m;
  });
  const { ranges, singles } = splitRanges(monthEvs);

  const totalCount = singles.length + ranges.length;
  document.getElementById("countHint").textContent =
    `今月 ${totalCount} 件` + (ranges.length ? `（うち期間中 ${ranges.length} 件）` : "");

  renderLegend();
  renderOngoing(ranges);

  if (state.view === "calendar") renderCalendar(y, m, byDate(singles));
  else renderList(byDate(singles));
}

// 連続する同一イベント（同じ館・名称・時間が3日以上ほぼ連日）を1件の「期間中の催し」にまとめる。
// 週1回などの定期開催（日付に間隔がある）は単発のまま残す。
function splitRanges(evs) {
  const ranges = [], singles = [];

  // 取り込み側が dateEnd を持つ連日イベントは、そのまま期間として扱う
  const groupable = [];
  for (const e of evs) {
    if (e.dateEnd && e.dateEnd > e.date) {
      ranges.push({ ...e, isRange: true, from: e.date, to: e.dateEnd, count: daysBetween(e.date, e.dateEnd) + 1 });
    } else {
      groupable.push(e);
    }
  }

  // dateEnd の無いものは、連日で重複する同一イベントをまとめる（旧データ・保険）
  const groups = {};
  for (const e of groupable) {
    const k = `${e.centerId}|${e.title}|${e.start || ""}|${e.end || ""}`;
    (groups[k] ||= []).push(e);
  }
  for (const arr of Object.values(groups)) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    let run = [arr[0]];
    const runs = [];
    for (let i = 1; i < arr.length; i++) {
      const gap = daysBetween(arr[i - 1].date, arr[i].date);
      if (gap >= 1 && gap <= 2) run.push(arr[i]); // 連日（最大1日の休館を許容）
      else { runs.push(run); run = [arr[i]]; }
    }
    runs.push(run);
    for (const r of runs) {
      if (r.length >= 3) {
        const f = r[0], l = r[r.length - 1];
        ranges.push({ ...f, id: f.id + "-range", isRange: true, from: f.date, to: l.date, count: r.length });
      } else {
        singles.push(...r);
      }
    }
  }
  return { ranges, singles };
}

// イベント配列 → { "YYYY-MM-DD": [ev,...] }
function byDate(evs) {
  const map = {};
  for (const e of evs) (map[e.date] ||= []).push(e);
  return map;
}

// 「期間中の催し」をカレンダー上部の別枠に表示
function renderOngoing(ranges) {
  const sec = document.getElementById("ongoing");
  const list = document.getElementById("ongoingList");
  if (!ranges.length) { sec.hidden = true; list.innerHTML = ""; return; }
  sec.hidden = false;
  ranges.sort((a, b) => a.from.localeCompare(b.from) || a.centerId.localeCompare(b.centerId));
  list.innerHTML = "";
  for (const ev of ranges) {
    const c = state.centerById[ev.centerId];
    const past = ev.to < TODAY_KEY;
    const btn = document.createElement("button");
    btn.className = "ongoing-chip" + (past ? " past" : "");
    btn.style.borderLeftColor = c ? c.color : "#888";
    btn.innerHTML =
      `<span class="oc-range">${fmtMD(ev.from)}〜${fmtMD(ev.to)}</span>` +
      `<span class="oc-title">${esc(ev.title)}</span>` +
      `<span class="oc-meta">${esc(c ? c.name : "")}${ev.start ? " ・" + ev.start + (ev.end ? "〜" + ev.end : "") : ""}・${esc(ev.ageLabel || "対象年齢の記載なし")}</span>`;
    btn.onclick = () => openEvent(ev);
    list.appendChild(btn);
  }
}

// 表示中の児童館を「色 → 館名」の凡例として並べる。
// クリックすると、その館の元の予定表ページ（sourcePage / officialUrl）を新規タブで開く。
// 12館を超えたら「他 N 館」ボタンで折りたたむ（将来100館超に耐えるため）。
function renderLegend() {
  const el = document.getElementById("legend");
  const shown = activeCenters().filter((c) => state.selected.has(c.id));
  const capped = !state.legendExpanded && shown.length > LEGEND_CAP;
  const visible = capped ? shown.slice(0, LEGEND_CAP) : shown;

  el.innerHTML = visible.map((c) => {
    const href = c.sourcePage || c.officialUrl;
    const inner =
      `<span class="dot" style="background:${c.color}"></span>${esc(c.name)}` +
      `<span class="lg-region">${esc(c.region)}</span>`;
    return href
      ? `<a class="lg" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(c.name)}の元の予定表を開く">${inner}<span class="lg-ext">↗</span></a>`
      : `<span class="lg">${inner}</span>`;
  }).join("");

  if (shown.length > LEGEND_CAP) {
    const btn = document.createElement("button");
    btn.className = "lg lg-more";
    btn.type = "button";
    btn.textContent = capped ? `他 ${shown.length - LEGEND_CAP} 館` : "折りたたむ";
    btn.onclick = () => { state.legendExpanded = !state.legendExpanded; renderLegend(); };
    el.appendChild(btn);
  }
}

function renderCalendar(y, m, byDateMap) {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

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

    const evs = document.createElement("div");
    evs.className = "evs";
    const list = (byDateMap[key] || []);
    const shown = list.slice(0, 3);
    for (const ev of shown) {
      const c = state.centerById[ev.centerId];
      const btn = document.createElement("button");
      btn.className = "ev" + (past ? " past" : "");
      btn.style.background = c ? c.color : "#888";
      btn.title = ev.title;
      btn.innerHTML = `${ev.start ? `<span class="ev-time">${ev.start}</span>` : ""}${esc(ev.title)}`;
      btn.onclick = () => openEvent(ev);
      evs.appendChild(btn);
    }
    if (list.length > shown.length) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = `他 ${list.length - shown.length} 件`;
      evs.appendChild(more);
    }
    cell.appendChild(evs);
    grid.appendChild(cell);
  }
}

function renderList(byDateMap) {
  const wrap = document.getElementById("listView");
  wrap.innerHTML = "";
  const dates = Object.keys(byDateMap).sort();

  if (!dates.length) {
    wrap.innerHTML = `<p class="empty-state">この月に表示できる単発イベントがありません。<br>（期間中の催しは上部にまとめて表示されます）</p>`;
    return;
  }

  for (const key of dates) {
    const date = new Date(key + "T00:00:00");
    const dow = date.getDay();
    const day = document.createElement("div");
    day.className = "agenda-day";
    const wdClass = dow === 0 ? "wd-sun" : dow === 6 ? "wd-sat" : "";
    day.innerHTML = `<div class="agenda-date">${date.getMonth() + 1}/${date.getDate()} <span class="${wdClass}">(${WEEKDAYS[dow]})</span></div>`;

    for (const ev of byDateMap[key]) {
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
  const timeStr = ev.start ? `${ev.start}${ev.end ? "〜" + ev.end : ""}` : "時間未定";
  const dateStr = ev.isRange
    ? `${fmtFull(ev.from)} 〜 ${fmtFull(ev.to)}（期間中の催し・連日）`
    : fmtFull(ev.date);

  document.getElementById("eventBody").innerHTML = `
    <h2>${esc(ev.title)}</h2>
    <span class="ev-center"><span class="dot" style="background:${c.color || "#888"}"></span>${esc(c.name || "")}（${esc(c.region || "")}）</span>
    <div class="detail-row"><span class="k">${ev.isRange ? "期間" : "日付"}</span><span class="v">${dateStr}</span></div>
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
// "YYYY-MM-DD" 同士の日数差
function daysBetween(k1, k2) {
  return (new Date(k2 + "T00:00:00") - new Date(k1 + "T00:00:00")) / 86400000;
}
// "2026-07-01" → "7/1"
function fmtMD(key) {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
}
// "2026-07-01" → "2026年7月1日（火）"
function fmtFull(key) {
  const dt = new Date(key + "T00:00:00");
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${WEEKDAYS[dt.getDay()]}）`;
}
// ISO文字列 → "2026年6月29日 09:00"。失敗時は元の文字列を返す。
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

init();
