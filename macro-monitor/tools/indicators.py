#!/usr/bin/env python3
"""
指標の組み立て — 取得したデータを、画面がそのまま映せる形にする
----------------------------------------------------
方針:

- 数字はここで作り、画面（app.js）では作らない。
- しきい値には根拠の種別を必ず付ける:
    A = 講義・史実に由来するもの（逆イールド0pt、CPI 5%、PMI 50、利上げ開始から18ヶ月）
    B = 当ツールが過去データで較正したもの。根拠の数字は backtest.py の実測値をその場で埋める
- status は safe / caution / warning / info の4つ。info はランプを持たない「文脈」の指標。
- 取れなかった数字を推測で埋めない。補間した月・推定値は必ず notes に出す。
"""
import signals as S
from backtest import describe
from loader import FRED_SERIES, regional_components
from seriesutil import (NBER_PEAKS, diff, fill_gaps, ma, monthly, monthly_avg, monthly_last,
                        pct_change, points, streak, weekly_last, ym_add, ym_diff)

TABS = [
    {"id": "summary", "label": "総合"},
    {"id": "calendar", "label": "公表カレンダー"},
    {"id": "cycle", "label": "景気循環のサイン"},
    {"id": "headline", "label": "ヘッドライン"},
    {"id": "rates", "label": "金利の先取り"},
    {"id": "global", "label": "世界金利"},
    {"id": "dollar", "label": "ドル"},
    {"id": "sources", "label": "出典・ログ"},
]


def _src(raw, *fred_ids, extra=()):
    out = []
    for sid in fred_ids:
        s = raw["fred"][sid]["source"]
        out.append({"name": f"FRED {sid} — {FRED_SERIES.get(sid, '')}", "url": s["page"],
                    "retrievedAt": s.get("retrievedAt"), "stale": bool(s.get("stale"))})
    for key in extra:
        s = raw[key]["source"]
        out.append({"name": s["name"], "url": s.get("page") or s["url"],
                    "retrievedAt": s.get("retrievedAt"), "stale": bool(s.get("stale"))})
    return out


def _latest(s):
    m = max(s)
    return m, s[m]


def _fmt(v, digits=1, plus=False):
    return f"{v:+.{digits}f}" if plus else f"{v:.{digits}f}"


def _bt(bt, key):
    return describe(bt[key]) if key in bt else "（バックテスト未実施）"


# ---------- ① 逆イールド ----------

YC_SMOOTH, YC_MIN_DAYS = 10, 63


def _inversions(obs):
    """10日移動平均が63営業日（約3ヶ月）以上マイナスを続けた期間 = 本格的な逆イールド。

    生の日次だと1〜2日のヒゲまで1回に数えてしまうため（recession-watch で決めた定義を引き継ぐ）。
    """
    eps, cur, buf = [], None, []
    for o in obs:
        buf.append(o["v"])
        if len(buf) > YC_SMOOTH:
            buf.pop(0)
        v = sum(buf) / len(buf)
        if v < 0:
            if cur is None:
                cur = {"start": o["d"], "end": o["d"], "days": 0, "min": v}
            cur["end"], cur["days"], cur["min"] = o["d"], cur["days"] + 1, min(cur["min"], v)
        elif cur is not None:
            if cur["days"] >= YC_MIN_DAYS:
                eps.append(cur)
            cur = None
    ongoing = cur is not None and cur["days"] >= YC_MIN_DAYS
    if ongoing:
        eps.append(cur)
    return eps, ongoing


def build_yield_curve(raw, bt):
    obs = raw["fred"]["T10Y3M"]["observations"]
    last = obs[-1]
    v = last["v"]
    status = "warning" if v < 0 else "caution" if v < 1.0 else "safe"
    eps, ongoing = _inversions(obs)
    detail, notes = [], []
    past = []
    for e in eps[:-1] if ongoing else eps:
        nxt = next((p for p in NBER_PEAKS if p > e["end"][:7]), None)
        past.append((e, ym_diff(nxt, e["end"][:7]) if nxt else None))
    if eps:
        e = eps[-1]
        detail.append(["直近の本格的な逆イールド",
                       f"{e['start']} 〜 {'継続中' if ongoing else e['end']}（最深 {e['min']:.2f}pt）"])
        if not ongoing:
            since = ym_diff(last["d"][:7], e["end"][:7])
            detail.append(["解消からの経過", f"{since}ヶ月"])
            done = [m for _, m in past[:-1] if m is not None]
            if done and past[-1][1] is None:
                notes.append(f"過去{len(done)}回の本格的な逆イールドは、解消から{min(done)}〜{max(done)}ヶ月で"
                             f"景気後退に入った。今回は解消から{since}ヶ月が経過"
                             + ("しており、その範囲を超えている。" if since > max(done) else "。"))
    text = {"warning": "逆イールド（長短金利が逆転）", "caution": "差が1pt未満まで縮小",
            "safe": "順イールド"}[status]
    return {
        "id": "yieldCurve", "tab": "cycle", "title": "逆イールド（10年 − 3ヶ月）",
        "value": v, "valueText": f"{_fmt(v, 2, True)}pt", "asOf": last["d"],
        "status": status, "statusText": text,
        "basis": "A", "basisText": "0pt割れ＝逆イールドは定義そのもの。+1.0ptの注意ラインは recession-watch から引き継いだ目安。",
        "detail": detail, "notes": notes,
        "charts": [{"id": "yc", "title": "10年債 − 3ヶ月債 利回り差", "unit": "pt",
                    "series": [{"label": "10年−3ヶ月", "points": [[d, round(x, 2)] for d, x in weekly_last(obs)]}],
                    "lines": [{"v": 0, "label": "逆イールド", "kind": "warning"},
                              {"v": 1, "label": "注意", "kind": "caution"}]}],
        "sources": _src(raw, "T10Y3M"),
    }


# ---------- ② CPI ----------

def build_cpi(raw, bt):
    idx, filled = fill_gaps(monthly(raw["fred"]["CPIAUCNS"]["observations"]))
    yoy = pct_change(idx, 12)
    m, v = _latest(yoy)
    status = "warning" if v >= 5 else "caution" if v >= 3 else "safe"
    notes = []
    if filled:
        notes.append(f"{'・'.join(filled)} は公表が無いため、前後の月から直線で補間している"
                     "（この月と、12ヶ月後の前年比は目安）。")
    return {
        "id": "cpi", "tab": "cycle", "title": "CPI 総合（前年比）",
        "value": v, "valueText": f"{_fmt(v, 1)}%", "asOf": m,
        "status": status,
        "statusText": {"warning": "5%超（景気後退の領域）", "caution": "3%超", "safe": "3%未満"}[status],
        "basis": "A", "basisText": "5%は講義の基準（戦後、総合CPIが5%を超えた局面はすべて景気後退に至った）。3%の注意ラインは目安。",
        "detail": [["前月", f"{_fmt(yoy[ym_add(m, -1)], 1)}%"] if ym_add(m, -1) in yoy else ["前月", "—"],
                   ["1年前", f"{_fmt(yoy[ym_add(m, -12)], 1)}%"] if ym_add(m, -12) in yoy else ["1年前", "—"]],
        "notes": notes,
        "charts": [{"id": "cpi", "title": "CPI総合 前年比", "unit": "%",
                    "series": [{"label": "CPI総合 前年比", "points": points(yoy, 2)}],
                    "lines": [{"v": 5, "label": "5%", "kind": "warning"},
                              {"v": 3, "label": "3%", "kind": "caution"}]}],
        "sources": _src(raw, "CPIAUCNS"),
    }


# ---------- ③ 労働の質 ----------

def build_labor(raw, bt):
    f = raw["fred"]
    s_ft = S.ftpt(monthly(f["LNS12500000"]["observations"]), monthly(f["LNS12600000"]["observations"]))
    s_gov = S.gov_share(monthly(f["USGOVT"]["observations"]), monthly(f["PAYEMS"]["observations"]))
    cc = monthly_avg(f["CCSA"]["observations"])
    s_cl = S.claims(cc)
    comp = S.labor_quality(s_ft, s_gov, s_cl)
    m, count = _latest(comp["values"])
    run = streak(comp["sig"], m)
    status = "warning" if run >= 3 else "caution" if count >= 1 else "safe"
    if status == "warning":
        text = f"3つのうち{count}つが該当（{run}ヶ月連続）"
    elif count >= 2:
        text = f"3つのうち{count}つが該当（{run}ヶ月目。3ヶ月続けば点灯）"
    else:
        text = f"3つのうち{count}つが該当"
    components = [
        {"id": "ftpt", "label": "フルタイム÷パート比率（6ヶ月平均の前年比）",
         "lit": s_ft["sig"][m], "valueText": f"{_fmt(s_ft['values'][m], 1, True)}%", "rule": "マイナスで該当"},
        {"id": "govShare", "label": "政府雇用比率（12ヶ月前との差）",
         "lit": s_gov["sig"][m], "valueText": f"{_fmt(s_gov['values'][m], 2, True)}pt", "rule": "プラスで該当"},
        {"id": "claims", "label": "継続受給者数（2年安値からの増加率）",
         "lit": s_cl["sig"][m], "valueText": f"{_fmt(s_cl['values'][m], 1, True)}%", "rule": "+10%以上で該当"},
    ]
    notes = ["雇用は景気の一致指標。このシグナルが景気後退の山より前に出たのは多くの回で1〜2ヶ月で、"
             "「予告」というより「確認」として読む。",
             "政府雇用比率は2025年の連邦職員削減で構造的に下がっており、今は該当しにくい。"]
    if s_ft["filled"]:
        notes.append(f"家計調査は {'・'.join(s_ft['filled'])} が未公表のため、前後の月から直線で補間している。")
    share_m, share_v = _latest(s_gov["share"])
    return {
        "id": "laborQuality", "tab": "cycle", "title": "労働の質（3つのうち2つ以上）",
        "value": count, "valueText": f"{count} / 3", "asOf": m,
        "status": status, "statusText": text,
        "basis": "B",
        "basisText": ("3つのうち2つ以上が3ヶ月続いたら点灯。1969年以降の実測: " + _bt(bt, "laborQuality")
                      + " 単独だと誤報が多い（フルタイム/パート "
                      + (f"{len(bt['ftpt']['false'])}回" if "ftpt" in bt else "—") + "、政府雇用比率 "
                      + (f"{len(bt['govShare']['false'])}回" if "govShare" in bt else "—") + "、継続受給者数 "
                      + (f"{len(bt['claims']['false'])}回" if "claims" in bt else "—") + "）ので、まとめて判定する。"),
        "components": components,
        "detail": [["政府雇用比率", f"{_fmt(share_v, 2)}%（{share_m}）"],
                   ["継続受給者数", f"{cc[max(cc)] / 1000:,.0f}千人（{max(cc)}の平均）"]],
        "notes": notes,
        "charts": [
            {"id": "ftpt", "title": "フルタイム÷パート比率 — 6ヶ月平均の前年比", "unit": "%",
             "series": [{"label": "前年比", "points": points(s_ft["values"], 2)}],
             "lines": [{"v": 0, "label": "0%", "kind": "caution"}]},
            {"id": "gov", "title": "政府雇用が非農業雇用に占める比率", "unit": "%",
             "series": [{"label": "政府雇用比率", "points": points(s_gov["share"], 2)}], "lines": []},
            {"id": "claims", "title": "継続受給者数 — 直近2年の安値からの増加率", "unit": "%",
             "series": [{"label": "2年安値比", "points": points(s_cl["values"], 1)}],
             "lines": [{"v": S.CLAIMS_RISE, "label": "+10%", "kind": "caution"}],
             "clampMax": 150},
        ],
        "sources": _src(raw, "LNS12500000", "LNS12600000", "USGOVT", "PAYEMS", "CCSA"),
    }


# ---------- ヘッドライン: NAHB / 地区連銀PMI / 新規受注 ----------

def build_nahb(raw, bt):
    hmi = monthly(raw["nahb"]["observations"])
    m, v = _latest(hmi)
    worse, reb = S.nahb_worse(hmi), S.nahb_rebound(hmi)
    d12 = worse["values"].get(m)
    is_worse, is_reb = bool(worse["sig"].get(m)), bool(reb["sig"].get(m))
    status = "caution" if is_worse else "safe"
    if is_worse:
        text = f"1年で{abs(d12):.0f}pt悪化"
    elif is_reb:
        text = f"直近6ヶ月の安値から{reb['values'][m]:.0f}pt反発（底打ちの目安）"
    else:
        text = f"1年前との差 {d12:+.0f}pt（悪化の基準 −10pt には届かず）"
    below = streak({k: x < 50 for k, x in hmi.items()}, m)
    notes = []
    if below:
        notes.append(f"50割れは{below}ヶ月連続。水準ではランプを点けない — 50割れだけを条件にすると"
                     + (f"山{bt['nahbBelow50']['of']}回のうち{bt['nahbBelow50']['hits']}回しか拾えず、"
                        f"誤報が{len(bt['nahbBelow50']['false'])}回出る" if "nahbBelow50" in bt else "誤報が多い")
                     + "ため、方向（悪化・底打ち）で見る。")
    return {
        "id": "nahb", "tab": "headline", "title": "NAHB 住宅市場指数",
        "value": v, "valueText": f"{v:.0f}", "asOf": m,
        "status": status, "statusText": text,
        "basis": "B",
        "basisText": "12ヶ月前より10pt以上の悪化で注意。1986年以降の実測: " + _bt(bt, "nahb")
                     + " 的中率が高くないので、警告（赤）にはしない。",
        "detail": [["1年前との差", f"{d12:+.0f}pt" if d12 is not None else "—"],
                   ["直近6ヶ月の安値からの戻り", f"{reb['values'][m]:+.0f}pt" if m in reb["values"] else "—"]],
        "notes": notes,
        "charts": [{"id": "nahb", "title": "NAHB/Wells Fargo 住宅市場指数", "unit": "",
                    "series": [{"label": "NAHB指数", "points": points(hmi, 0)}],
                    "lines": [{"v": 50, "label": "50（良い・悪いの境目）", "kind": "ref"}]}],
        "sources": _src(raw, extra=("nahb",)),
    }


PMI_VALIDATION = ("ISM公表値との照合（2020年5月〜2025年8月の64ヶ月、2026年11月に実施）: "
                  "相関0.90、平均の差+0.5、50割れの判定が一致したのは64ヶ月中54ヶ月。")


def _pmi_parts(raw):
    ph, ny = regional_components(raw)
    return ph, ny, S.regional_pmi(ph, ny), S.regional_pmi(ph, ny, ["NO"])


def build_pmi(raw, bt):
    ph, ny, pmi, no = _pmi_parts(raw)
    m, v = _latest(pmi)
    peak = S.new_orders_peakout(no)
    below = streak({k: x < 50 for k, x in pmi.items()}, m)
    status = "warning" if v < 50 else "caution" if peak["sig"].get(m) else "safe"
    text = (f"50割れ（{below}ヶ月連続）" if v < 50
            else "50以上だが新規受注がピークアウト" if status == "caution" else "50以上（拡大）")
    comp = []
    for code, label in S.PMI_COMPONENTS:
        vals = [S.to_ism(s[code][m]) for s in (ph, ny) if m in s[code]]
        comp.append([label, f"{sum(vals) / len(vals):.1f}"])
    pmi3 = ma(pmi, 3)
    return {
        "id": "pmi", "tab": "headline", "title": "地区連銀PMI（ISM換算）",
        "subtitle": "ISM製造業PMIの代わり",
        "value": v, "valueText": f"{v:.1f}", "asOf": m,
        "status": status, "statusText": text,
        "basis": "A",
        "basisText": ("50＝拡大と縮小の境目（ISMと同じ計算式に換算しているので意味は同じ）。" + PMI_VALIDATION
                      + " この系列の50割れを景気後退と突き合わせると: " + _bt(bt, "pmi")
                      + " 50割れは「製造業の縮小」であって、単独では景気後退の予告にならない。"),
        "definition": [
            "ISM製造業PMIは有料配信で、無料では取り続けられない。そこで、同じ形式の調査を公開している"
            "フィラデルフィア連銀とNY連銀の製造業調査から、ISMと同じ計算式で作る。",
            "換算式: 地区連銀の各項目は D＝「増えた%」−「減った%」。ISMは「増えた%」＋「変わらない%」×½。"
            "「変わらない%」＝100−増えた%−減った% なので、ISM換算＝50＋D÷2（数式上ぴったり一致）。",
            "項目: ISMのPMIと同じ5項目を等しい重みで平均 — 新規受注・出荷（ISMの生産に相当）・雇用・入荷遅延・在庫。",
            "合成: 2地区の単純平均。NY連銀の調査が始まる前（2001年6月以前）はフィラデルフィアのみ。",
            "限界: 東部の2地区だけで、全米を対象にするISMよりサンプルが小さい。"
            "月の半ばにNY連銀だけ先に出るが、2地区がそろうまでその月の値は出さない。",
        ],
        "detail": comp, "notes": [],
        "charts": [{"id": "pmi", "title": "地区連銀PMI（ISM換算）", "unit": "",
                    "series": [{"label": "PMI（月次）", "points": points(pmi, 1)},
                               {"label": "3ヶ月平均", "points": points(pmi3, 1), "kind": "faint"}],
                    "lines": [{"v": 50, "label": "50", "kind": "warning"}]}],
        "sources": _src(raw, *[t.format(c) for c, _ in S.PMI_COMPONENTS for t in (S.FRED_PHILLY, S.FRED_NY)]),
    }


def build_new_orders(raw, bt):
    ph, ny, pmi, no = _pmi_parts(raw)
    m, v = _latest(no)
    peak = S.new_orders_peakout(no)
    drop = peak["values"].get(m)
    lit = bool(peak["sig"].get(m))
    status = "caution" if lit else "safe"
    text = (f"ピークアウト（3ヶ月平均が12ヶ月高値から{abs(drop):.1f}pt低下）" if lit
            else f"12ヶ月高値からの低下は{abs(drop):.1f}pt（基準は{S.NO_PEAKOUT_DROP:.0f}pt）")
    alt = bt.get("newOrdersAlt", {})
    alt_txt = "、".join(f"{x}ptは誤報{len(r['false'])}回" for x, r in alt.items())
    return {
        "id": "newOrders", "tab": "headline", "title": "新規受注（地区連銀・ISM換算）",
        "subtitle": "ISM New Ordersの代わり",
        "value": v, "valueText": f"{v:.1f}", "asOf": m,
        "status": status, "statusText": text,
        "basis": "B",
        "basisText": (f"3ヶ月平均が直近12ヶ月の高値から{S.NO_PEAKOUT_DROP:.0f}pt以上下がったらピークアウト。"
                      "1970年以降の実測: " + _bt(bt, "newOrders") + f"（幅の比較: {alt_txt}）"
                      " 誤報が多いのは、景気後退に至らない減速も拾うため。サイクルの減速の合図として読む。"),
        "detail": [["3ヶ月平均", f"{peak['ma3'][m]:.1f}" if m in peak["ma3"] else "—"],
                   ["12ヶ月高値からの差", f"{drop:+.1f}pt" if drop is not None else "—"]],
        "notes": ["定義は「地区連銀PMI（ISM換算）」と同じ換算式を、新規受注の項目だけに当てたもの。"],
        "charts": [{"id": "no", "title": "新規受注（ISM換算）", "unit": "",
                    "series": [{"label": "新規受注（月次）", "points": points(no, 1), "kind": "faint"},
                               {"label": "3ヶ月平均", "points": points(peak["ma3"], 1)}],
                    "lines": [{"v": 50, "label": "50", "kind": "ref"}]}],
        "sources": _src(raw, S.FRED_PHILLY.format("NO"), S.FRED_NY.format("NO")),
    }


# ---------- 金利の先取り: 18ヶ月時計 / PER ----------

LEAD_MONTHS = 18


def build_clock(raw, bt, today):
    f = raw["fred"]
    old = [o for o in f["DFEDTAR"]["observations"]]
    new = [o for o in f["DFEDTARU"]["observations"] if o["d"] > old[-1]["d"]]
    target = old + new
    cycles = S.policy_cycles(target)
    cur = cycles[-1]
    now = today[:7]
    elapsed = ym_diff(now, cur["start"][:7])
    hike = cur["dir"] == "hike"
    reach = ym_add(cur["start"][:7], LEAD_MONTHS)
    if hike:
        status = "warning" if elapsed >= LEAD_MONTHS else "caution" if elapsed >= 12 else "safe"
        text = (f"利上げ開始から{elapsed}ヶ月 — 引き締めが先行指標に表れる時期" if elapsed >= LEAD_MONTHS
                else f"利上げ開始から{elapsed}ヶ月（18ヶ月の到達は{reach}）")
    else:
        status = "safe"
        text = (f"利下げ開始から{elapsed}ヶ月 — 緩和が先行指標に表れる時期に入っている" if elapsed >= LEAD_MONTHS
                else f"利下げ開始から{elapsed}ヶ月（18ヶ月の到達は{reach}）")
    prev_hike = next((c for c in reversed(cycles) if c["dir"] == "hike"), None)
    detail = [["現在のサイクル", f"{'利上げ' if hike else '利下げ'}（{cur['start']}開始・{cur['moves']}回・"
                              f"{cur['from']:.2f}%→{cur['to']:.2f}%）"],
              ["最後の変更", cur["last"]],
              ["開始から18ヶ月", reach]]
    if prev_hike and prev_hike is not cur:
        detail.append(["直前の利上げサイクル", f"{prev_hike['start']}開始 → 18ヶ月後は{ym_add(prev_hike['start'][:7], LEAD_MONTHS)}"])
    # 講義 U03 の図: FF金利の前年差（上下反転・18ヶ月先送り）× 新規受注
    ff = monthly(f["FEDFUNDS"]["observations"])
    ffd = diff(ff, 12)
    shifted = {ym_add(m, LEAD_MONTHS): v for m, v in ffd.items()}
    try:
        _, _, _, no = _pmi_parts(raw)
        no3 = ma(no, 3)
    except KeyError:
        no3 = {}
    tgt_m = monthly_last(target)
    return {
        "id": "clock18", "tab": "rates", "title": "18ヶ月時計（政策金利のサイクル）",
        "value": elapsed, "valueText": f"{elapsed}ヶ月", "asOf": target[-1]["d"],
        "status": status, "statusText": text,
        "basis": "A",
        "basisText": "金利の変化が先行指標に表れるまで約18ヶ月、GDPまで約24ヶ月（講義 U03）。"
                     "サイクルの始まりは「直前の変更と逆向きの最初の変更」で数える。",
        "detail": detail,
        "notes": ["下のグラフの右軸の線は、FF金利の前年差を上下反転し、18ヶ月先へずらしたもの。"
                  "右端は今後18ヶ月ぶんの「予告」にあたる。"],
        "charts": [
            {"id": "lead", "title": "FF金利の前年差（反転・18ヶ月先送り）× 新規受注", "unit": "",
             "series": [{"label": "新規受注 3ヶ月平均（左軸）", "points": points(no3, 1)},
                        {"label": "FF金利の前年差・反転・18ヶ月先送り（右軸）", "points": points(shifted, 2),
                         "axis": "r", "kind": "alt"}],
             "lines": [{"v": 50, "label": "50", "kind": "ref"}], "invertRight": True, "rightUnit": "pt"},
            {"id": "target", "title": "FF金利 誘導目標（2008年以降は上限）", "unit": "%",
             "series": [{"label": "誘導目標", "points": points(tgt_m, 2), "step": True}], "lines": []},
        ],
        "sources": _src(raw, "DFEDTAR", "DFEDTARU", "FEDFUNDS"),
        "_cycle": {"dir": cur["dir"], "elapsed": elapsed},
    }


def build_per(raw, bt):
    rows = raw["multpl"]["monthly"]
    pe = monthly(rows)
    est = [r["d"] for r in rows if r.get("est")]
    sig = S.pe_contraction(pe)
    m, v = _latest(pe)
    yoy = sig["values"][m]
    lit = bool(sig["sig"][m])
    notes = ["実績PER（過去12ヶ月の報告利益ベース）。講義が主に使う予想PERは、無料で取り続けられる出どころが無い。"]
    if est:
        notes.append(f"{est[0]}以降は、決算が出そろっていないため multpl による推定値（グラフの点線）。")
    return {
        "id": "per", "tab": "rates", "title": "S&P500 実績PER",
        "value": v, "valueText": f"{v:.1f}倍" + ("（推定）" if m in est else ""), "asOf": m,
        "status": "caution" if lit else "safe",
        "statusText": f"前年比 {yoy:+.1f}% — " + ("縮小している" if lit else "縮小していない"),
        "basis": "B",
        "basisText": "前年よりPERが低い＝縮小。1969年以降の実測: " + _bt(bt, "per")
                     + " 誤報が多いので単独では点灯させず、ターニングポイントの1項目として数える。",
        "detail": [["1年前", f"{pe[ym_add(m, -12)]:.1f}倍"],
                   ["最新（日次）", f"{raw['multpl']['latest']['v']:.2f}倍（{raw['multpl']['latest']['d']}）"]],
        "notes": notes,
        "charts": [
            {"id": "pe", "title": "S&P500 実績PER", "unit": "倍",
             "series": [{"label": "実績PER", "points": points({k: x for k, x in pe.items() if k not in est or k == (ym_add(est[0], -1) if est else "")}, 2)},
                        {"label": "推定値", "points": points({k: x for k, x in pe.items() if est and k >= ym_add(est[0], -1)}, 2), "kind": "est"}],
             "lines": [], "clampMax": 50},
            {"id": "peyoy", "title": "実績PER 前年比", "unit": "%",
             "series": [{"label": "前年比", "points": points(sig["values"], 1)}],
             "lines": [{"v": 0, "label": "0%", "kind": "caution"}], "clampMax": 80, "clampMin": -60},
        ],
        "sources": _src(raw, extra=("multpl",)),
    }


# ---------- 世界金利 / ドル ----------

def build_cb(raw, bt):
    d = S.cb_diffusion(raw["bis"]["rates"])
    months = sorted(d["net"])
    # 直近の月は報告が出そろっていないことがある。直前6ヶ月の最大数の9割がそろった月を最新とする
    m = months[-1]
    while d["n"][m] < 0.9 * max(d["n"][ym_add(m, -k)] for k in range(1, 7) if ym_add(m, -k) in d["n"]):
        m = ym_add(m, -1)
    net = {k: v for k, v in d["net"].items() if k <= m}
    v = net[m]
    text = ("引き締め優勢" if v > 10 else "緩和優勢" if v < -10 else "ほぼ中立") + \
           f"（利上げ{d['hike'][m]:.0f}% / 利下げ{d['cut'][m]:.0f}%）"
    shifted = {ym_add(k, LEAD_MONTHS): x for k, x in net.items()}
    try:
        _, _, pmi, _ = _pmi_parts(raw)
        pmi3 = ma(pmi, 3)
    except KeyError:
        pmi3 = {}
    return {
        "id": "cbDiffusion", "tab": "global", "title": "グローバル中銀 政策ディフュージョン指数",
        "value": v, "valueText": f"{v:+.0f}", "asOf": m,
        "status": "info", "statusText": text,
        "basis": "B",
        "basisText": "当ツールが自分で計算している指数で、講義の図と同じ出どころではない。ランプは付けず、世界の金利の向きを見る文脈として使う。",
        "definition": [
            "元データ: BIS（国際決済銀行）が公開している各国中央銀行の政策金利（月末値）。",
            f"計算: 各月について、{S.CB_WINDOW}ヶ月前より政策金利を上げた中銀の割合(%) − 下げた中銀の割合(%)。"
            "プラスが大きいほど世界的な引き締め、マイナスが大きいほど世界的な緩和。",
            "その月と6ヶ月前の両方に値がある中銀だけを数える。ユーロ圏は加盟国ごとではなくECBを1つとして数える"
            "（加盟国の系列はユーロ導入時に終わっている）。",
            f"対象の数は時期で変わる: 1990年は{d['n'].get('1990-01', '—')}、現在は{d['n'][m]}。古い時期ほど粗い。",
            "講義では世界製造業PMIに18ヶ月先行するとされるが、世界PMIは無料で取れないため、下のグラフでは米国の地区連銀PMIを重ねている。",
        ],
        "detail": [["利上げした中銀", f"{d['hike'][m]:.0f}%"], ["利下げした中銀", f"{d['cut'][m]:.0f}%"],
                   ["対象の中銀", f"{d['n'][m]}"]],
        "notes": [],
        "charts": [
            {"id": "cb", "title": "ディフュージョン指数（利上げ% − 利下げ%）", "unit": "",
             "series": [{"label": "ディフュージョン指数", "points": points(net, 1)}],
             "lines": [{"v": 0, "label": "中立", "kind": "ref"}]},
            {"id": "cblead", "title": "ディフュージョン指数（反転・18ヶ月先送り）× 地区連銀PMI", "unit": "",
             "series": [{"label": "地区連銀PMI 3ヶ月平均（左軸）", "points": points(pmi3, 1)},
                        {"label": "ディフュージョン指数・反転・18ヶ月先送り（右軸）", "points": points(shifted, 1),
                         "axis": "r", "kind": "alt"}],
             "lines": [{"v": 50, "label": "50", "kind": "ref"}], "invertRight": True},
        ],
        "sources": _src(raw, extra=("bis",)),
    }


def build_twd(raw, bt):
    obs = raw["fred"]["DTWEXBGS"]["observations"]
    last = obs[-1]
    mavg = monthly_avg(obs)
    yoy = pct_change(mavg, 12)
    y, mo, dd = last["d"].split("-")
    ago = f"{int(y) - 1}-{mo}-{dd}"
    base = next((o for o in reversed(obs) if o["d"] <= ago), None)
    ch = last["v"] / base["v"] * 100 - 100 if base else None
    text = ("—" if ch is None else
            f"前年比 {ch:+.1f}% — " + ("ドル高（世界経済には逆風の合図）" if ch > 2 else
                                    "ドル安（世界経済には追い風の合図）" if ch < -2 else "ほぼ横ばい"))
    return {
        "id": "twd", "tab": "dollar", "title": "貿易加重ドル指数（TWD・ブロード）",
        "value": last["v"], "valueText": f"{last['v']:.1f}", "asOf": last["d"],
        "status": "info", "statusText": text,
        "basis": "A", "basisText": "ドルは世界経済の逆数として読む（講義 U06）。水準に警告ラインは置かず、向きを見る。±2%は「横ばい」と呼ぶための目安。",
        "detail": [["1年前", f"{base['v']:.1f}（{base['d']}）" if base else "—"]],
        "notes": ["FRBの名目ブロードドル指数（2006年1月＝100）。DXYと違い、人民元・メキシコペソ・カナダドルなど"
                  "貿易相手国の通貨を広く含む。"],
        "charts": [
            {"id": "twd", "title": "名目ブロードドル指数", "unit": "",
             "series": [{"label": "TWD", "points": [[d, round(x, 2)] for d, x in weekly_last(obs)]}], "lines": []},
            {"id": "twdyoy", "title": "TWD 前年比（月平均）", "unit": "%",
             "series": [{"label": "前年比", "points": points(yoy, 1)}],
             "lines": [{"v": 0, "label": "0%", "kind": "ref"}]},
        ],
        "sources": _src(raw, "DTWEXBGS"),
    }


BUILDERS = [("yieldCurve", build_yield_curve), ("cpi", build_cpi), ("laborQuality", build_labor),
            ("nahb", build_nahb), ("pmi", build_pmi), ("newOrders", build_new_orders),
            ("clock18", build_clock), ("per", build_per), ("cbDiffusion", build_cb), ("twd", build_twd)]


# ---------- 総合 ----------

CORE = ["yieldCurve", "cpi", "laborQuality"]


def recession_verdict(ind):
    """景気循環のサイン: 核3つ（逆イールド・CPI・労働の質）のうち2つ以上が点灯したら後退寄り。"""
    have = [i for i in CORE if i in ind and not ind[i].get("missing")]
    lit = [i for i in have if ind[i]["status"] == "warning"]
    caution = [i for i in have if ind[i]["status"] == "caution"]
    incomplete = len(have) < len(CORE)
    if len(lit) >= 2:
        level, msg = "warning", f"景気後退寄り — 3つのうち{len(lit)}つが点灯"
    elif lit:
        level, msg = "caution", "1つ点灯 — 単独では後退と判断しない"
    elif caution:
        level, msg = "caution", "点灯なし — 注意域の指標あり"
    else:
        level, msg = "safe", "点灯なし"
    if incomplete:
        msg += "（一部の指標が取得できておらず、判定は不完全）"
        if level == "safe":
            level = "caution"
    return {"level": level, "message": msg, "lit": lit, "caution": caution,
            "coreCount": len(have), "incomplete": incomplete,
            "rule": "逆イールド・CPI・労働の質のうち2つ以上が同時に点灯したら景気後退寄りと見る。"}


def turning_points(ind):
    """金利の変化を先取りするためのターニングポイント6項目。"""
    def item(key, label, lit_fn, ref):
        i = ind.get(ref)
        if not i or i.get("missing"):
            return {"id": key, "label": label, "ref": ref, "lit": None, "text": "取得できていない"}
        return {"id": key, "label": label, "ref": ref, "lit": bool(lit_fn(i)), "text": i["statusText"]}
    items = [
        item("clock", "利上げ開始から18ヶ月", lambda i: i["_cycle"]["dir"] == "hike" and i["_cycle"]["elapsed"] >= LEAD_MONTHS, "clock18"),
        item("inversion", "逆イールド", lambda i: i["status"] == "warning", "yieldCurve"),
        item("per", "PERの縮小", lambda i: i["status"] == "caution", "per"),
        item("newOrders", "新規受注のピークアウト", lambda i: i["status"] == "caution", "newOrders"),
        item("nahb", "NAHBの悪化", lambda i: i["status"] == "caution", "nahb"),
        item("labor", "労働市場の構造的変化", lambda i: i["status"] == "warning", "laborQuality"),
    ]
    return {"items": items, "lit": sum(1 for x in items if x["lit"]), "of": len(items)}


def phase(raw):
    """景気サイクルの局面。講義（U07・U15）の3区分を、地区連銀PMIの水準と向きで機械的に当てはめる。

    向きは3ヶ月平均が3ヶ月前より上か下かで見る（B: 当ツールの定義）。
    """
    _, _, pmi, _ = _pmi_parts(raw)
    m, v = _latest(pmi)
    p3 = ma(pmi, 3)
    rising = p3[m] > p3[ym_add(m, -3)]
    if rising:
        pid, label = "riskOn", "回復（リスクオン）"
        reason = f"PMIが上向き（3ヶ月平均 {p3[ym_add(m, -3)]:.1f} → {p3[m]:.1f}）"
    elif v >= 50:
        pid, label = "riskOff", "ピークアウト（リスクオフ）"
        reason = f"PMIは50以上だが下向き（3ヶ月平均 {p3[ym_add(m, -3)]:.1f} → {p3[m]:.1f}）"
    else:
        pid, label = "riskAversion", "収縮（リスク回避）"
        reason = f"PMIが50を割り、なお下向き（3ヶ月平均 {p3[ym_add(m, -3)]:.1f} → {p3[m]:.1f}）"
    return {"id": pid, "label": label, "reason": reason, "asOf": m, "pmi": round(v, 1),
            "basis": "B", "basisText": "局面の3区分は講義のもの。PMIに地区連銀PMI（ISM換算）を使い、"
                                       "向きを「3ヶ月平均が3ヶ月前より上か下か」で決めるのは当ツールの定義。機械的な目安として読む。"}


def recessions(raw):
    """NBERの景気後退期 [[開始月, 終了月], ...]（グラフの網掛け用）"""
    s = monthly(raw["fred"]["USREC"]["observations"])
    out, start, prev = [], None, None
    for m in sorted(s):
        if s[m] >= 1 and start is None:
            start = m
        if s[m] < 1 and start is not None:
            out.append([start, prev])
            start = None
        prev = m
    if start is not None:
        out.append([start, prev])
    return out
