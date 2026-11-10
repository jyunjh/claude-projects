/* macro-monitor: 画面の組み立て。snapshot / knowledge の文字列は必ず textContent 経由で入れる。 */
(function () {
  "use strict";

  // ---- 設定 ----
  const REPO = { owner: "jyunjh", name: "claude-projects", workflow: "pages.yml", ref: "main" };
  const TOKEN_KEY = "macroMonitor.ghToken";
  const TAB_KEY = "macroMonitor.tab";
  const RANGE_KEY = "macroMonitor.range";
  const ACTIONS_URL = "https://github.com/jyunjh/claude-projects/actions/workflows/pages.yml";
  const POLL_MS = 10000;
  const MAX_WAIT_MS = 10 * 60 * 1000;
  const PAGES_WAIT_MS = 30 * 1000;

  const STATUS_TEXT = { safe: "安全", caution: "注意", warning: "警告", info: "参考" };
  const STATUS_RANK = { info: 0, safe: 1, caution: 2, warning: 3 };
  const CORE_IDS = ["yieldCurve", "cpi", "laborQuality"];
  const BT_LABELS = {
    ftpt: "フルタイム÷パート比率", govShare: "政府雇用比率", claims: "継続受給者数",
    laborQuality: "労働の質（3つのうち2つ以上）", pmi: "PMI", newOrders: "新規受注",
    nahb: "NAHB", nahbBelow50: "NAHB 50割れ", per: "PER"
  };
  const RANGES = [[5, "5年"], [10, "10年"], [20, "20年"], ["all", "全期間"]];

  // ---- 状態 ----
  let data = window.MACRO_SNAPSHOT || null;
  const know = () => window.MACRO_KNOWLEDGE || {};
  let currentTab = "summary";
  let range = 10;
  let charts = [];          // 描画中のグラフ
  let rangeBtnSets = [];    // 期間ボタン群
  let busy = false;

  // ---- ユーティリティ ----
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存不可でも動く */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return e;
  }
  const $ = (id) => document.getElementById(id);

  function safeUrl(u) {
    try { const x = new URL(u, location.href); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch (e) { return null; }
  }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString("ja-JP", { hour12: false });
  }
  function statusKey(s) { return STATUS_TEXT[s] ? s : "info"; }

  function lamp(status, text) {
    const k = statusKey(status);
    return h("span", { class: "lamp s-" + k },
      h("span", { class: "lamp-dot s-" + k, "aria-hidden": "true" }),
      text != null ? text : STATUS_TEXT[k]);
  }
  function basisTag(basis) {
    return h("span", { class: "tag" }, basis === "A" ? "A 講義・史実" : "B 当ツール較正");
  }
  function bullets(list) { return h("ul", null, (list || []).map((t) => h("li", { text: t }))); }

  // 「ⓘ 解説」ボタン + 開閉パネル
  function explainPair(kid) {
    const k = know()[kid];
    if (!k) return null;
    const panel = h("div", { class: "explain", hidden: true, id: "ex-" + kid + "-" + Math.random().toString(36).slice(2, 7) });
    if (k.howToRead && k.howToRead.length) panel.appendChild(bullets(k.howToRead));
    if (k.caveats && k.caveats.length) {
      panel.appendChild(h("h4", { text: "注意" }));
      panel.appendChild(bullets(k.caveats));
    }
    if (k.sources && k.sources.length) panel.appendChild(h("p", { class: "src", text: "講義の出典: " + k.sources.join(", ") }));
    const btn = h("button", { type: "button", class: "btn", "aria-expanded": "false", "aria-controls": panel.id }, "ⓘ 解説");
    btn.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    return { btn, panel, oneLiner: k.oneLiner || "" };
  }
  function oneLinerBlock(kid) {
    const p = explainPair(kid);
    if (!p) return null;
    return [h("div", { class: "oneliner" }, h("span", { class: "txt", text: p.oneLiner }), p.btn), p.panel];
  }

  // ---- 集計 ----
  function indicatorsOfTab(tab) {
    return (data.order || []).filter((id) => data.indicators[id] && data.indicators[id].tab === tab).map((id) => data.indicators[id]);
  }
  function worstStatus(tab) {
    const list = indicatorsOfTab(tab);
    if (!list.length) return null;
    let best = "info";
    for (const i of list) if (STATUS_RANK[statusKey(i.status)] > STATUS_RANK[best]) best = statusKey(i.status);
    return best;
  }

  // ---- ナビゲーション ----
  function goTo(tab, indicatorId) {
    setTab(tab, true);
    if (indicatorId) {
      const target = document.getElementById("ind-" + indicatorId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.remove("flash");
        void target.offsetWidth;
        target.classList.add("flash");
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    }
  }
  function setTab(id, force) {
    if (!data) return;
    if (!data.tabs.some((t) => t.id === id)) id = "summary";
    if (id === currentTab && !force) return;
    currentTab = id;
    lsSet(TAB_KEY, id);
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    renderTabs();
    renderPanel();
  }

  // ---- 描画: ヘッダ・タブ ----
  function renderHeader() {
    $("updated").textContent = data && data.generatedAt ? "最終更新: " + fmtDateTime(data.generatedAt) : "最終更新: 不明";
  }
  function renderTabs() {
    const box = $("tabs");
    box.textContent = "";
    data.tabs.forEach((t) => {
      const selected = t.id === currentTab;
      let dot = null;
      if (t.id !== "summary" && t.id !== "sources") {
        const w = worstStatus(t.id);
        if (w) dot = h("span", { class: "dot s-" + w, "aria-hidden": "true" });
      }
      const w = dot ? worstStatus(t.id) : null;
      const btn = h("button", {
        type: "button", class: "tab", role: "tab", id: "tab-" + t.id,
        "aria-selected": String(selected), "aria-controls": "panel", tabindex: selected ? "0" : "-1",
        title: w ? STATUS_TEXT[w] : null
      }, dot, t.label, w ? h("span", { class: "sr", text: "（" + STATUS_TEXT[w] + "）" }) : null);
      btn.addEventListener("click", () => setTab(t.id));
      btn.addEventListener("keydown", (e) => {
        const ids = data.tabs.map((x) => x.id);
        let i = ids.indexOf(t.id);
        if (e.key === "ArrowRight") i = (i + 1) % ids.length;
        else if (e.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
        else if (e.key === "Home") i = 0;
        else if (e.key === "End") i = ids.length - 1;
        else return;
        e.preventDefault();
        setTab(ids[i]);
        const nb = $("tab-" + ids[i]);
        if (nb) nb.focus();
      });
      box.appendChild(btn);
    });
    $("panel").setAttribute("aria-labelledby", "tab-" + currentTab);
  }

  // ---- 描画: パネル ----
  function clearCharts() {
    charts.forEach((c) => { try { c.destroy(); } catch (e) { /* noop */ } });
    charts = [];
    rangeBtnSets = [];
  }
  function renderPanel() {
    clearCharts();
    const p = $("panel");
    p.textContent = "";
    if (!data) { p.appendChild(h("p", { text: "データを読み込めませんでした。" })); return; }
    if (currentTab === "summary") renderSummary(p);
    else if (currentTab === "sources") renderSources(p);
    else renderIndicatorTab(p, currentTab);
  }

  function errorsBand(errors) {
    return h("section", { class: "errband", role: "alert" },
      h("h2", { text: "取得エラーがあります（" + errors.length + "件）" }),
      h("ul", null, errors.map((e) => h("li", { text: (e.source ? e.source + ": " : "") + (e.message || "") }))));
  }

  function renderSummary(p) {
    if (data.errors && data.errors.length) p.appendChild(errorsBand(data.errors));

    // 1. 景気局面
    const ph = data.phase;
    if (ph) {
      const kb = oneLinerBlock("phase");
      p.appendChild(h("section", { class: "box" },
        h("h2", { text: "景気局面" }),
        h("div", { class: "phase-label", text: ph.label || "—" }),
        h("p", { text: ph.reason || "" }),
        h("p", { class: "basis" }, basisTag(ph.basis || "B"), " ", ph.basisText || ""),
        ph.asOf ? h("p", { class: "asof", text: ph.asOf + " 時点" }) : null,
        kb));
    }

    // 2. 景気循環のサイン
    const v = data.verdict;
    if (v) {
      const lvl = statusKey(v.level);
      p.appendChild(h("section", { class: "box" },
        h("h2", { text: "景気循環のサイン" }),
        h("div", { class: "verdict-msg s-" + lvl }, lamp(lvl), " ", v.message || ""),
        h("p", { class: "muted small", text: v.rule || "" }),
        h("div", { class: "core" }, CORE_IDS.map((id) => {
          const ind = data.indicators[id];
          if (!ind) return null;
          return h("button", { type: "button", class: "core-item", onclick: () => goTo(ind.tab, id) },
            h("span", { class: "small muted", text: ind.title }),
            h("strong", { text: ind.valueText || "—" }),
            lamp(ind.status));
        }))));
    }

    // 3. ターニングポイント
    const tp = data.turningPoints;
    if (tp) {
      p.appendChild(h("section", { class: "box" },
        h("h2", { text: "ターニングポイント" }),
        h("div", { class: "tp-head", text: tp.lit + " / " + tp.of }),
        h("ul", { class: "tp-list" }, (tp.items || []).map((it) => {
          const ref = data.indicators[it.ref];
          const st = it.lit === true ? ["on", "● 点灯"] : it.lit === false ? ["off", "○ 消灯"] : ["na", "？ 取得できていない"];
          const row = h("button", { type: "button", class: "tp-row", onclick: () => { if (ref) goTo(ref.tab, it.ref); } },
            h("span", { class: "tp-mark " + st[0], text: st[1] }),
            h("span", { class: "tp-label", text: it.label }),
            it.text ? h("span", { class: "tp-text", text: it.text }) : null);
          return h("li", null, row);
        }))));
    }

    // 4. 全指標一覧
    const rows = (data.order || []).map((id) => data.indicators[id]).filter(Boolean).map((ind) => {
      const go = () => goTo(ind.tab, ind.id);
      const tr = h("tr", { class: "click", onclick: go },
        h("td", null, lamp(ind.status)),
        h("td", null, h("button", { type: "button", class: "rowbtn", text: ind.title, onclick: (e) => { e.stopPropagation(); go(); } })),
        h("td", { class: "num", text: ind.missing ? "—" : (ind.valueText || "—") }),
        h("td", { class: "hide-sm", text: ind.missing ? "取得できていない" : (ind.statusText || "") }),
        h("td", { class: "hide-sm", text: ind.asOf || "" }));
      return tr;
    });
    p.appendChild(h("section", { class: "box" },
      h("h2", { text: "全指標の一覧" }),
      h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", { text: "状態" }), h("th", { text: "指標" }), h("th", { class: "num", text: "値" }),
          h("th", { class: "hide-sm", text: "判定" }), h("th", { class: "hide-sm", text: "時点" }))),
        h("tbody", null, rows)))));
  }

  function renderIndicatorTab(p, tab) {
    const list = indicatorsOfTab(tab);
    if (!list.length) { p.appendChild(h("p", { class: "muted", text: "このタブに指標はありません。" })); return; }
    list.forEach((ind) => p.appendChild(card(ind)));
  }

  function card(ind) {
    const c = h("article", { class: "card", id: "ind-" + ind.id },
      h("h2", null, ind.title, ind.stale ? h("span", { class: "badge", text: "前回の値を表示中" }) : null),
      ind.subtitle ? h("p", { class: "sub", text: ind.subtitle }) : null);
    if (ind.missing) {
      c.appendChild(h("p", { class: "muted", text: "取得できていない" }));
      return c;
    }
    c.appendChild(h("div", { class: "valueRow" },
      h("span", { class: "value", text: ind.valueText || "—" }),
      ind.asOf ? h("span", { class: "asof", text: ind.asOf + " 時点" }) : null,
      lamp(ind.status), h("span", { text: ind.statusText || "" })));
    c.appendChild(h("div", null, oneLinerBlock(ind.id)));

    if (ind.components && ind.components.length) {
      c.appendChild(h("ul", { class: "comp" }, ind.components.map((co) => {
        const ol = oneLinerBlock(co.id);
        return h("li", null,
          h("div", { class: "c-head" },
            h("span", { class: "mark " + (co.lit ? "on" : "off"), text: co.lit ? "● 該当" : "○ 非該当" }),
            h("strong", { text: co.label }),
            h("span", { text: co.valueText || "" })),
          co.rule ? h("div", { class: "small muted", text: co.rule }) : null,
          ol);
      })));
    }

    if (ind.definition && ind.definition.length) {
      c.appendChild(h("details", null, h("summary", { text: "定義" }), bullets(ind.definition)));
    }
    if (ind.detail && ind.detail.length) {
      c.appendChild(h("table", { class: "kv" }, h("tbody", null,
        ind.detail.map((r) => h("tr", null, h("th", { text: r[0] }), h("td", { text: r[1] }))))));
    }
    if (ind.notes && ind.notes.length) c.appendChild(h("ul", { class: "plain" }, ind.notes.map((t) => h("li", { text: t }))));

    c.appendChild(h("p", { class: "basis" }, basisTag(ind.basis), " ", ind.basisText || ""));

    (ind.charts || []).forEach((spec) => {
      const holder = h("div");
      const btns = RANGES.map(([val, label]) => {
        const b = h("button", { type: "button", "aria-pressed": String(String(val) === String(range)), text: label });
        b.dataset.val = String(val);
        b.addEventListener("click", () => setRange(val));
        return b;
      });
      rangeBtnSets.push(btns);
      c.appendChild(h("div", { class: "chart-block" },
        h("div", { class: "chart-head" }, h("h3", { text: spec.title || "" }), h("div", { class: "ranges", role: "group", "aria-label": "表示期間" }, btns)),
        holder));
      if (window.MacroChart) {
        charts.push(window.MacroChart.render(holder, spec, { recessions: data.recessions || [], range }));
      } else {
        holder.textContent = "グラフを表示できません。";
      }
    });

    const srcs = (ind.sources || []).map((s) => {
      const u = safeUrl(s.url);
      return h("li", null, u ? h("a", { href: u, target: "_blank", rel: "noopener", text: s.name }) : (s.name || ""));
    });
    if (srcs.length) c.appendChild(h("ul", { class: "srcs" }, srcs));
    return c;
  }

  function setRange(val) {
    range = val;
    lsSet(RANGE_KEY, String(val));
    charts.forEach((ch) => ch.setRange(val));
    rangeBtnSets.forEach((set) => set.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.val === String(val)))));
  }

  function renderSources(p) {
    // 出典
    const rows = [];
    (data.order || []).forEach((id) => {
      const ind = data.indicators[id];
      if (!ind) return;
      (ind.sources || []).forEach((s) => {
        const u = safeUrl(s.url);
        rows.push(h("tr", null,
          h("td", { text: ind.title }),
          h("td", null, u ? h("a", { href: u, target: "_blank", rel: "noopener", text: s.name }) : (s.name || "")),
          h("td", { text: fmtDateTime(s.retrievedAt) }),
          h("td", { text: s.stale ? "古い（前回の値）" : "—" })));
      });
    });
    p.appendChild(h("section", { class: "box" }, h("h2", { text: "データの出典" }),
      h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", { text: "指標" }), h("th", { text: "出典" }), h("th", { text: "取得日時" }), h("th", { text: "stale" }))),
        h("tbody", null, rows)))));

    // エラー
    const errs = data.errors || [];
    p.appendChild(h("section", { class: "box" }, h("h2", { text: "エラー" }),
      errs.length ? h("ul", { class: "plain" }, errs.map((e) => h("li", { text: (e.source ? e.source + ": " : "") + (e.message || "") })))
        : h("p", { class: "muted", text: "エラーなし" })));

    // バックテスト
    const bt = data.backtest || {};
    const brow = Object.keys(bt).map((k) => {
      const b = bt[k] || {};
      return h("tr", null,
        h("td", { text: BT_LABELS[k] ? BT_LABELS[k] + "（" + k + "）" : k }),
        h("td", { class: "num", text: b.hits + " / " + b.of }),
        h("td", { class: "num", text: b.false + " 回" }),
        h("td", { text: (b.leads || []).map((x) => (x == null ? "—" : x)).join("、") }));
    });
    p.appendChild(h("section", { class: "box" }, h("h2", { text: "過去との突き合わせ" }),
      h("p", { class: "muted small", text: "過去の景気後退（NBERの山）との突き合わせ。条件が3ヶ月続いた発生を、山の24ヶ月前〜3ヶ月後なら的中、それ以外を誤報と数える" }),
      h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", { text: "指標" }), h("th", { class: "num", text: "的中" }), h("th", { class: "num", text: "誤報" }), h("th", { text: "先行（ヶ月、山ごと）" }))),
        h("tbody", null, brow)))));

    p.appendChild(h("section", { class: "box" }, h("h2", { text: "注意" }),
      h("ul", { class: "plain" },
        h("li", { text: "過去のランプや線は、最新の改定後データで計算し直したもの（当時の速報値ではない）。" }),
        h("li", { text: "学習・観測用のツールで、投資助言ではない。" }),
        h("li", { text: "しきい値Bは当ツールが過去データで置いた目安。" }))));
  }

  function renderAll() {
    if (!data) { $("panel").textContent = "データを読み込めませんでした。"; return; }
    renderHeader();
    renderTabs();
    renderPanel();
  }

  // ---- 更新ボタン ----
  function setStatus(text, extra) {
    const s = $("updateStatus");
    s.textContent = "";
    if (text) s.appendChild(document.createTextNode(text));
    if (extra) s.appendChild(extra);
  }
  function linkNode(url, label) {
    const u = safeUrl(url);
    return u ? h("a", { href: u, target: "_blank", rel: "noopener", text: label }) : null;
  }

  function reloadSnapshot() {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "data/snapshot.js?t=" + Date.now();
      s.onload = () => {
        s.remove();
        if (window.MACRO_SNAPSHOT) { data = window.MACRO_SNAPSHOT; renderAll(); }
        resolve(true);
      };
      s.onerror = () => { s.remove(); resolve(false); };
      document.head.appendChild(s);
    });
  }

  async function onReload() {
    setStatus("読み込み中…");
    const ok = await reloadSnapshot();
    setStatus(ok ? "最新のデータを読み込みました（" + fmtDateTime(data && data.generatedAt) + "）" : "読み込みに失敗しました。");
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function authError() {
    setStatus("トークンが無効か、権限が足りません。",
      h("button", { type: "button", class: "linkbtn", onclick: openTokenDialog, text: "設定を開く" }));
  }

  async function onFetch() {
    if (busy) return;
    const token = lsGet(TOKEN_KEY);
    if (!token) { openTokenDialog(); return; }
    busy = true;
    $("btnFetch").disabled = true;
    $("btnReload").disabled = true;
    const base = "https://api.github.com/repos/" + REPO.owner + "/" + REPO.name + "/actions/workflows/" + REPO.workflow;
    const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
    try {
      const startedAt = Date.now();
      let res;
      try {
        res = await fetch(base + "/dispatches", {
          method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers),
          body: JSON.stringify({ ref: REPO.ref })
        });
      } catch (e) {
        setStatus("GitHubに接続できませんでした。通信状態を確認してください。");
        return;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) { authError(); return; }
      if (res.status !== 204) { setStatus("起動に失敗しました（HTTP " + res.status + "）。"); return; }

      setStatus("起動しました");
      let run = null;
      let lastPoll = 0;
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        const sec = Math.round((Date.now() - startedAt) / 1000);
        if (run && run.status === "completed") break;
        if (Date.now() - lastPoll >= POLL_MS || lastPoll === 0 && sec >= 4) {
          lastPoll = Date.now();
          try {
            const r = await fetch(base + "/runs?event=workflow_dispatch&per_page=5", { headers });
            if (r.status === 401 || r.status === 403 || r.status === 404) { authError(); return; }
            if (r.ok) {
              const j = await r.json();
              const mine = (j.workflow_runs || []).filter((w) => Date.parse(w.created_at) >= startedAt - 5000);
              if (mine.length) run = mine[0];
            }
          } catch (e) { /* 次の周期で再試行 */ }
          if (run && run.status === "completed") break;
        }
        setStatus(run ? "実行中（" + sec + "秒）" : "起動しました → 実行を探しています（" + sec + "秒）");
        await sleep(1000);
      }
      if (!run || run.status !== "completed") {
        setStatus("10分待っても完了を確認できませんでした。", linkNode(run ? run.html_url : ACTIONS_URL, "GitHubで確認する"));
        return;
      }
      if (run.conclusion !== "success") {
        setStatus("取得に失敗しました（" + run.conclusion + "）。", linkNode(run.html_url, "実行の詳細を見る"));
        return;
      }
      for (let left = PAGES_WAIT_MS / 1000; left > 0; left--) {
        setStatus("完了。読み込み直します（反映待ち あと" + left + "秒）");
        await sleep(1000);
      }
      const ok = await reloadSnapshot();
      setStatus(ok ? "最新のデータを読み込みました（" + fmtDateTime(data && data.generatedAt) + "）" : "読み込みに失敗しました。もう一度「最新を読み込む」を押してください。");
    } finally {
      busy = false;
      $("btnFetch").disabled = false;
      $("btnReload").disabled = false;
    }
  }

  // ---- トークン設定ダイアログ ----
  function tokenStateText() {
    $("tokenState").textContent = lsGet(TOKEN_KEY) ? "トークンはこの端末に保存済みです。" : "トークンは未設定です。";
  }
  function openTokenDialog() {
    $("tokenInput").value = "";
    tokenStateText();
    const d = $("tokenDialog");
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  }
  function closeTokenDialog() {
    const d = $("tokenDialog");
    $("tokenInput").value = "";
    if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  }

  // ---- 起動 ----
  function init() {
    const r = lsGet(RANGE_KEY);
    if (r) range = r === "all" ? "all" : (Number(r) || 10);
    $("btnReload").addEventListener("click", onReload);
    $("btnFetch").addEventListener("click", onFetch);
    $("btnSettings").addEventListener("click", openTokenDialog);
    $("tokenForm").addEventListener("submit", (e) => e.preventDefault());
    $("tokenClose").addEventListener("click", closeTokenDialog);
    $("tokenSave").addEventListener("click", () => {
      const v = $("tokenInput").value.trim();
      if (!v) { $("tokenState").textContent = "トークンを入力してください。"; return; }
      lsSet(TOKEN_KEY, v);
      $("tokenInput").value = "";
      tokenStateText();
    });
    $("tokenDelete").addEventListener("click", () => { lsDel(TOKEN_KEY); $("tokenInput").value = ""; tokenStateText(); });

    if (!data) { $("updated").textContent = "最終更新: 不明"; $("panel").textContent = "data/snapshot.js を読み込めませんでした。"; return; }
    const fromHash = location.hash.replace(/^#/, "");
    const saved = lsGet(TAB_KEY);
    const valid = (id) => id && data.tabs.some((t) => t.id === id);
    currentTab = valid(fromHash) ? fromHash : valid(saved) ? saved : "summary";
    window.addEventListener("hashchange", () => {
      const id = location.hash.replace(/^#/, "");
      if (valid(id)) setTab(id);
    });
    renderAll();
  }
  init();
})();
