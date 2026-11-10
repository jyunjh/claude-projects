/* macro-monitor: 自作の折れ線グラフ（外部ライブラリなし）
 * 使い方: const h = MacroChart.render(親要素, chartSpec, {recessions, range});
 *         h.setRange(10 | "all"); h.destroy();
 */
(function () {
  "use strict";

  var DAY = 86400000;

  function toT(s) {
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(s));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  }

  function fmt(v) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v);
    var d = a >= 1000 ? 0 : a >= 100 ? 1 : 2;
    return v.toLocaleString("ja-JP", { maximumFractionDigits: d });
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }

  // 値域 [lo,hi] から切りのいい目盛りと表示範囲を作る
  function makeAxis(lo, hi, clampMin, clampMax) {
    if (!isFinite(lo) || !isFinite(hi)) return null;
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    var span = hi - lo;
    var padLo = clampMin != null && lo <= clampMin ? 0 : span * 0.04;
    var padHi = clampMax != null && hi >= clampMax ? 0 : span * 0.04;
    lo -= padLo; hi += padHi;
    if (clampMin != null) lo = Math.max(lo, clampMin);
    if (clampMax != null) hi = Math.min(hi, clampMax);
    if (hi <= lo) hi = lo + 1;
    var step = niceStep((hi - lo) / 4.5);
    if (clampMin == null) lo = Math.floor(lo / step + 1e-9) * step;
    if (clampMax == null) hi = Math.ceil(hi / step - 1e-9) * step;
    var ticks = [];
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) {
      ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10));
    }
    return { lo: lo, hi: hi, ticks: ticks, step: step };
  }

  function cssVars(node) {
    var cs = getComputedStyle(node);
    function g(n, d) { var v = cs.getPropertyValue(n).trim(); return v || d; }
    return {
      main: g("--ch-main", "#2563eb"), alt: g("--ch-alt", "#d9480f"), faint: g("--ch-faint", "#9aa5b1"),
      grid: g("--ch-grid", "#e5e7eb"), text: g("--ch-text", "#555"), rec: g("--ch-rec", "rgba(120,120,120,.18)"),
      warning: g("--warning", "#c62828"), caution: g("--caution", "#b85c00"), ref: g("--ch-ref", "#888"),
      font: cs.fontFamily || "sans-serif"
    };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(parent, spec, opts) {
    opts = opts || {};
    var recessions = opts.recessions || [];
    var range = opts.range != null ? opts.range : 10;

    var wrap = el("div", "mc-wrap");
    var canvas = el("canvas", "mc-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", String(spec.title || "グラフ"));
    var tip = el("div", "mc-tip");
    tip.hidden = true;
    var legend = el("div", "mc-legend");
    wrap.appendChild(canvas);
    wrap.appendChild(tip);
    parent.appendChild(wrap);
    parent.appendChild(legend);
    var ctx = canvas.getContext("2d");

    // 系列の下ごしらえ
    var series = (spec.series || []).map(function (s) {
      var pts = [];
      (s.points || []).forEach(function (p) {
        var t = toT(p[0]);
        if (isNaN(t)) return;
        var v = p[1];
        pts.push([t, v == null || !isFinite(v) ? null : +v, p[0]]);
      });
      return { label: s.label, axis: s.axis === "r" ? "r" : "l", kind: s.kind || "", step: !!s.step, pts: pts };
    });
    var allT = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { allT.push(p[0]); }); });
    var minAll = allT.length ? allT.reduce(function (a, b) { return Math.min(a, b); }) : 0;
    var maxAll = allT.length ? allT.reduce(function (a, b) { return Math.max(a, b); }) : 0;

    var model = null;
    var hoverX = null;
    var destroyed = false;

    function layout(W, H, hasR) {
      return { l: 46, r: hasR ? 46 : 12, t: 14, b: 24, W: W, H: H };
    }

    function compute(W, H) {
      var todayT = Date.now();
      var xmax = maxAll;
      var xmin;
      if (range === "all" || range == null) xmin = minAll;
      else xmin = Math.max(minAll, Math.min(xmax, todayT) - Number(range) * 365.25 * DAY);
      if (xmax <= xmin) xmax = xmin + DAY * 31;

      var vis = [];
      series.forEach(function (s) {
        var n = s.pts.filter(function (p) { return p[1] != null && p[0] >= xmin && p[0] <= xmax; });
        if (n.length) vis.push(s);
      });
      if (!vis.length) return { empty: true };

      var lv = [], rv = [];
      vis.forEach(function (s) {
        s.pts.forEach(function (p) {
          if (p[1] == null || p[0] < xmin || p[0] > xmax) return;
          (s.axis === "r" ? rv : lv).push(p[1]);
        });
      });
      var lines = (spec.lines || []);
      var lo = Math.min.apply(null, lv.length ? lv : [0]);
      var hi = Math.max.apply(null, lv.length ? lv : [1]);
      if (lv.length) {
        var span0 = (hi - lo) || 1;
        lines.forEach(function (ln) {
          if (ln.v >= lo - span0 && ln.v <= hi + span0) { lo = Math.min(lo, ln.v); hi = Math.max(hi, ln.v); }
        });
      }
      var L = lv.length ? makeAxis(lo, hi, spec.clampMin, spec.clampMax) : null;
      var R = rv.length ? makeAxis(Math.min.apply(null, rv), Math.max.apply(null, rv), null, null) : null;
      if (!L && R) { L = null; }
      var lay = layout(W, H, !!R);
      var hasFuture = maxAll > todayT && minAll < todayT;
      return { empty: false, xmin: xmin, xmax: xmax, vis: vis, L: L, R: R, lay: lay, hasFuture: hasFuture, todayT: todayT, lines: lines };
    }

    function px(m, t) { return m.lay.l + (t - m.xmin) / (m.xmax - m.xmin) * (m.lay.W - m.lay.l - m.lay.r); }
    function py(m, axis, v) {
      var A = axis === "r" ? m.R : m.L;
      var top = m.lay.t, h = m.lay.H - m.lay.t - m.lay.b;
      var f = (v - A.lo) / (A.hi - A.lo);
      if (axis === "r" && spec.invertRight) f = 1 - f;
      return top + (1 - f) * h;
    }

    function colorOf(c, s) { return s.kind === "alt" ? c.alt : s.kind === "faint" ? c.faint : c.main; }

    function draw() {
      if (destroyed) return;
      var W = wrap.clientWidth;
      if (!W) return;
      var H = W < 480 ? 220 : 260;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var c = cssVars(wrap);
      var fontStack = c.font;
      ctx.font = "11px " + fontStack;

      model = compute(W, H);
      renderLegend(model, c);
      if (model.empty) {
        ctx.fillStyle = c.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "14px " + fontStack;
        ctx.fillText("データなし", W / 2, H / 2);
        return;
      }
      var m = model, lay = m.lay;
      var pw = W - lay.l - lay.r, ph = H - lay.t - lay.b;

      // 景気後退の網掛け
      ctx.fillStyle = c.rec;
      recessions.forEach(function (r) {
        var a = toT(r[0]);
        var bt = toT(r[1]);
        if (isNaN(a) || isNaN(bt)) return;
        var b = new Date(bt); b = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1);
        if (b < m.xmin || a > m.xmax) return;
        var x1 = px(m, Math.max(a, m.xmin)), x2 = px(m, Math.min(b, m.xmax));
        ctx.fillRect(x1, lay.t, Math.max(1, x2 - x1), ph);
      });

      // グリッドと目盛り（左）
      ctx.lineWidth = 1;
      ctx.textBaseline = "middle";
      if (m.L) {
        ctx.textAlign = "right";
        m.L.ticks.forEach(function (v) {
          var y = Math.round(py(m, "l", v)) + 0.5;
          ctx.strokeStyle = c.grid;
          ctx.beginPath(); ctx.moveTo(lay.l, y); ctx.lineTo(W - lay.r, y); ctx.stroke();
          ctx.fillStyle = c.text;
          ctx.fillText(fmt(v), lay.l - 5, y);
        });
      }
      if (m.R) {
        ctx.textAlign = "left";
        m.R.ticks.forEach(function (v) {
          var y = Math.round(py(m, "r", v)) + 0.5;
          if (!m.L) {
            ctx.strokeStyle = c.grid;
            ctx.beginPath(); ctx.moveTo(lay.l, y); ctx.lineTo(W - lay.r, y); ctx.stroke();
          }
          ctx.fillStyle = c.alt;
          ctx.fillText(fmt(v), W - lay.r + 5, y);
        });
      }

      // x軸
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      ctx.fillStyle = c.text;
      var spanY = (m.xmax - m.xmin) / (365.25 * DAY);
      var x0 = lay.l, x1e = W - lay.r;
      if (spanY >= 2.5) {
        var steps = [1, 2, 5, 10, 20, 25, 50];
        var st = 50;
        for (var i = 0; i < steps.length; i++) { if (spanY / steps[i] <= 6.5) { st = steps[i]; break; } }
        var y0 = new Date(m.xmin).getUTCFullYear();
        y0 = Math.ceil(y0 / st) * st;
        for (var y = y0; Date.UTC(y, 0, 1) <= m.xmax; y += st) {
          var t = Date.UTC(y, 0, 1);
          if (t < m.xmin) continue;
          var x = px(m, t);
          ctx.strokeStyle = c.grid;
          ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, lay.t + ph); ctx.lineTo(Math.round(x) + 0.5, lay.t + ph + 4); ctx.stroke();
          if (x > x0 + 12 && x < x1e - 12) ctx.fillText(String(y), x, lay.t + ph + 6);
        }
      } else {
        var d0 = new Date(m.xmin);
        var cy = d0.getUTCFullYear(), cm = d0.getUTCMonth();
        var n = 0;
        for (;;) {
          var tt = Date.UTC(cy, cm, 1);
          if (tt > m.xmax) break;
          if (tt >= m.xmin && cm % 3 === 0) {
            var xx = px(m, tt);
            if (xx > x0 + 20 && xx < x1e - 20) ctx.fillText(cy + "-" + String(cm + 1).padStart(2, "0"), xx, lay.t + ph + 6);
          }
          cm++; if (cm > 11) { cm = 0; cy++; }
          if (++n > 400) break;
        }
      }

      // クリップして水平線・系列
      ctx.save();
      ctx.beginPath(); ctx.rect(lay.l, lay.t, pw, ph); ctx.clip();

      if (m.L) {
        m.lines.forEach(function (ln) {
          if (ln.v < m.L.lo || ln.v > m.L.hi) return;
          var y = Math.round(py(m, "l", ln.v)) + 0.5;
          var col = ln.kind === "warning" ? c.warning : ln.kind === "caution" ? c.caution : c.ref;
          ctx.strokeStyle = col; ctx.lineWidth = 1;
          ctx.setLineDash(ln.kind === "ref" ? [5, 4] : [2, 0]);
          ctx.beginPath(); ctx.moveTo(lay.l, y); ctx.lineTo(W - lay.r, y); ctx.stroke();
          ctx.setLineDash([]);
        });
      }

      m.vis.forEach(function (s) {
        var col = colorOf(c, s);
        ctx.strokeStyle = col;
        ctx.lineWidth = s.kind === "faint" ? 1 : 2;
        ctx.lineJoin = "round";
        ctx.setLineDash(s.kind === "est" ? [4, 3] : []);
        if (s.axis === "r" ? !m.R : !m.L) return;
        ctx.beginPath();
        var pen = false, prevY = 0;
        s.pts.forEach(function (p) {
          if (p[1] == null) { pen = false; return; }
          if (p[0] < m.xmin - 400 * DAY || p[0] > m.xmax) { return; }
          var x = px(m, p[0]), y = py(m, s.axis, p[1]);
          if (!pen) { ctx.moveTo(x, y); pen = true; }
          else if (s.step) { ctx.lineTo(x, prevY); ctx.lineTo(x, y); }
          else ctx.lineTo(x, y);
          prevY = y;
        });
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // 今日の線
      if (m.hasFuture && m.todayT >= m.xmin && m.todayT <= m.xmax) {
        var tx = Math.round(px(m, m.todayT)) + 0.5;
        ctx.strokeStyle = c.text; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx, lay.t); ctx.lineTo(tx, lay.t + ph); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // 水平線ラベル
      if (m.L) {
        ctx.font = "10px " + fontStack;
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        m.lines.forEach(function (ln) {
          if (ln.v < m.L.lo || ln.v > m.L.hi) return;
          var y = py(m, "l", ln.v);
          ctx.fillStyle = ln.kind === "warning" ? c.warning : ln.kind === "caution" ? c.caution : c.ref;
          ctx.fillText(String(ln.label || ""), lay.l + 4, y - 2);
        });
      }
      if (m.hasFuture && m.todayT >= m.xmin && m.todayT <= m.xmax) {
        ctx.font = "10px " + fontStack;
        ctx.fillStyle = c.text; ctx.textBaseline = "top";
        var tx2 = px(m, m.todayT);
        ctx.textAlign = tx2 > W - lay.r - 40 ? "right" : "left";
        ctx.fillText("今日", tx2 + (ctx.textAlign === "left" ? 3 : -3), lay.t + 1);
      }

      // クロスヘア
      if (hoverX != null) drawHover(c);
    }

    function nearest(pts, t) {
      var lo = 0, hi = pts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (pts[mid][0] < t) lo = mid + 1; else hi = mid;
      }
      var best = lo;
      if (lo > 0 && Math.abs(pts[lo - 1][0] - t) < Math.abs(pts[lo][0] - t)) best = lo - 1;
      return pts[best];
    }

    function drawHover(c) {
      var m = model;
      if (!m || m.empty) { tip.hidden = true; return; }
      var lay = m.lay;
      var t = m.xmin + (hoverX - lay.l) / (lay.W - lay.l - lay.r) * (m.xmax - m.xmin);
      var cands = [];
      m.vis.forEach(function (s) {
        var pts = s.pts.filter(function (p) { return p[1] != null; });
        if (!pts.length) return;
        var p = nearest(pts, t);
        cands.push({ s: s, p: p });
      });
      if (!cands.length) { tip.hidden = true; return; }
      var anchor = cands.reduce(function (a, b) { return Math.abs(a.p[0] - t) <= Math.abs(b.p[0] - t) ? a : b; });
      var T = anchor.p[0];
      var x = px(m, T);
      ctx.strokeStyle = c.text; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, lay.t); ctx.lineTo(Math.round(x) + 0.5, lay.H - lay.b); ctx.stroke();
      ctx.globalAlpha = 1;

      tip.textContent = "";
      tip.appendChild(el("div", "mc-tip-date", anchor.p[2]));
      cands.forEach(function (cd) {
        if (Math.abs(cd.p[0] - T) > 70 * DAY) return;
        var row = el("div", "mc-tip-row");
        var sw = el("span", "mc-sw"); sw.style.background = colorOf(c, cd.s);
        row.appendChild(sw);
        var unit = cd.s.axis === "r" ? (spec.rightUnit || "") : (spec.unit || "");
        row.appendChild(el("span", "", cd.s.label + ": " + fmt(cd.p[1]) + (unit ? " " + unit : "")));
        tip.appendChild(row);
        var y = py(m, cd.s.axis, cd.p[1]);
        ctx.fillStyle = colorOf(c, cd.s);
        ctx.beginPath(); ctx.arc(px(m, cd.p[0]), y, 3, 0, Math.PI * 2); ctx.fill();
      });
      tip.hidden = false;
      var tw = tip.offsetWidth;
      var left = x + 10;
      if (left + tw > lay.W - 2) left = x - 10 - tw;
      tip.style.left = Math.max(2, left) + "px";
      tip.style.top = lay.t + 4 + "px";
    }

    function renderLegend(m, c) {
      legend.textContent = "";
      if (m.empty) return;
      m.vis.forEach(function (s) {
        var it = el("span", "mc-leg-item");
        var sw = el("span", "mc-sw" + (s.kind === "est" ? " dashed" : ""));
        sw.style.background = s.kind === "est" ? "transparent" : colorOf(c, s);
        sw.style.borderColor = colorOf(c, s);
        it.appendChild(sw);
        it.appendChild(document.createTextNode(s.label));
        legend.appendChild(it);
      });
      var units = [];
      if (spec.unit) units.push("単位: " + spec.unit);
      if (spec.rightUnit) units.push("右軸: " + spec.rightUnit + (spec.invertRight ? "（上下反転）" : ""));
      if (units.length) legend.appendChild(el("span", "mc-leg-item mc-leg-unit", units.join(" / ")));
      if (recessions.length) {
        var r = el("span", "mc-leg-item");
        r.appendChild(el("span", "mc-sw mc-sw-rec"));
        r.appendChild(document.createTextNode("網掛け＝景気後退期（NBER）"));
        legend.appendChild(r);
      }
    }

    function onMove(e) {
      var rect = canvas.getBoundingClientRect();
      hoverX = e.clientX - rect.left;
      draw();
    }
    function onLeave() { hoverX = null; tip.hidden = true; draw(); }
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointercancel", onLeave);

    var ro = null;
    var lastW = 0;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(function () {
        var w = wrap.clientWidth;
        if (w !== lastW) { lastW = w; draw(); }
      });
      ro.observe(wrap);
    } else {
      window.addEventListener("resize", draw);
    }
    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function onScheme() { draw(); }
    if (mq && mq.addEventListener) mq.addEventListener("change", onScheme);

    draw();

    return {
      setRange: function (r) { range = r; hoverX = null; tip.hidden = true; draw(); },
      redraw: draw,
      destroy: function () {
        destroyed = true;
        if (ro) ro.disconnect(); else window.removeEventListener("resize", draw);
        if (mq && mq.removeEventListener) mq.removeEventListener("change", onScheme);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (legend.parentNode) legend.parentNode.removeChild(legend);
      }
    };
  }

  window.MacroChart = { render: render };
})();
