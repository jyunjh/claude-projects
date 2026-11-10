#!/usr/bin/env python3
"""
月次系列の小道具 — 判定ロジックとバックテストの両方から使う
----------------------------------------------------
系列は {"YYYY-MM": float} の辞書で持つ。順序は sorted(keys)。
ここには「数え方」だけを置き、しきい値や解釈は indicators.py に置く。
"""

# NBERが認定した景気循環の山（＝景気後退の開始月）。出典: NBER Business Cycle Dating Committee
NBER_PEAKS = ["1969-12", "1973-11", "1980-01", "1981-07",
              "1990-07", "2001-03", "2007-12", "2020-02"]


def ym_add(ym, k):
    """'2026-01' に k ヶ月足す（k は負でもよい）。"""
    y, m = int(ym[:4]), int(ym[5:7])
    t = y * 12 + (m - 1) + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def ym_diff(a, b):
    """a − b を月数で返す。"""
    return (int(a[:4]) * 12 + int(a[5:7])) - (int(b[:4]) * 12 + int(b[5:7]))


def monthly(obs):
    """[{"d","v"}]（月次）→ {"YYYY-MM": v}"""
    return {o["d"][:7]: o["v"] for o in obs}


def monthly_avg(obs):
    """日次・週次 → 月平均"""
    acc = {}
    for o in obs:
        acc.setdefault(o["d"][:7], []).append(o["v"])
    return {m: sum(v) / len(v) for m, v in acc.items()}


def monthly_last(obs):
    """日次・週次 → 月の最後の観測値"""
    out = {}
    for o in obs:               # obs は古い順
        out[o["d"][:7]] = o["v"]
    return out


def weekly_last(obs):
    """日次 → 各週の最後の観測値（描画用に点数を1/5にする）。[(date, v)]"""
    from datetime import date
    out, last_key = [], None
    for o in obs:
        y, m, d = (int(x) for x in o["d"].split("-"))
        key = date(y, m, d).isocalendar()[:2]
        if key == last_key:
            out[-1] = (o["d"], o["v"])
        else:
            out.append((o["d"], o["v"]))
            last_key = key
    return out


def fill_gaps(s, max_gap=2):
    """途中の欠測月（最大 max_gap ヶ月連続）を前後の直線補間で埋める。

    2025年10月は政府閉鎖で家計調査(CPS)とCPIが公表されていない。穴を放置すると
    12ヶ月後の前年比や移動平均まで計算できなくなるので、補間して先へ進む。
    補間した月は必ず呼び出し側に返し、画面に出す（黙って埋めない）。
    戻り値: (埋めた系列, [補間した月])
    """
    keys = sorted(s)
    if not keys:
        return dict(s), []
    out, filled = dict(s), []
    for a, b in zip(keys, keys[1:]):
        gap = ym_diff(b, a) - 1
        if 1 <= gap <= max_gap:
            for i in range(1, gap + 1):
                m = ym_add(a, i)
                out[m] = s[a] + (s[b] - s[a]) * i / (gap + 1)
                filled.append(m)
    return out, filled


def ma(s, n):
    """後方 n ヶ月の移動平均。n ヶ月すべて揃う月だけ返す。"""
    out = {}
    for m in s:
        w = [s.get(ym_add(m, -k)) for k in range(n)]
        if None not in w:
            out[m] = sum(w) / n
    return out


def pct_change(s, k=12):
    """k ヶ月前比（%）"""
    return {m: s[m] / s[ym_add(m, -k)] * 100 - 100
            for m in s if ym_add(m, -k) in s and s[ym_add(m, -k)] != 0}


def diff(s, k=12):
    """k ヶ月前との差"""
    return {m: s[m] - s[ym_add(m, -k)] for m in s if ym_add(m, -k) in s}


def rolling_min(s, n):
    """当月を含む後方 n ヶ月の最小値（n ヶ月揃う月だけ）"""
    out = {}
    for m in s:
        w = [s.get(ym_add(m, -k)) for k in range(n)]
        if None not in w:
            out[m] = min(w)
    return out


def rolling_max(s, n):
    out = {}
    for m in s:
        w = [s.get(ym_add(m, -k)) for k in range(n)]
        if None not in w:
            out[m] = max(w)
    return out


def streak(sig, month):
    """month まで、条件が何ヶ月連続で成り立っているか（month が偽なら 0）。"""
    n = 0
    while sig.get(month):
        n += 1
        month = ym_add(month, -1)
    return n


def episodes(sig, min_run=3):
    """条件が min_run ヶ月連続で成り立った「かたまり」の開始月の一覧。"""
    out, run = [], 0
    for m in sorted(sig):
        run = run + 1 if sig[m] else 0
        if run == min_run:
            out.append(ym_add(m, -(min_run - 1)))
    return out


def evaluate(sig, start, min_run=3, before=24, after=3, peaks=NBER_PEAKS):
    """シグナルを NBER の山と突き合わせる。

    山の before ヶ月前〜after ヶ月後に始まったかたまりを「的中」、
    どの山の窓にも入らないかたまりを「誤報」と数える。
    戻り値: {"hits": 的中数, "of": 対象の山の数, "leads": [山ごとの先行月数 or None],
             "false": [誤報の開始月], "peaks": [対象の山]}
    """
    eps = [e for e in episodes(sig, min_run) if e >= start]
    target = [p for p in peaks if p >= start]
    leads = []
    for p in target:
        cand = [e for e in eps if ym_add(p, -before) <= e <= ym_add(p, after)]
        leads.append(ym_diff(p, cand[0]) if cand else None)
    false = [e for e in eps
             if not any(ym_add(p, -before) <= e <= ym_add(p, after) for p in peaks)]
    return {"hits": sum(1 for x in leads if x is not None), "of": len(target),
            "leads": leads, "false": false, "peaks": target}


def points(s, digits=2, start=None):
    """辞書 → 描画用の [[日付, 値], ...]（古い順）"""
    return [[m, round(v, digits)] for m, v in sorted(s.items())
            if start is None or m >= start]
