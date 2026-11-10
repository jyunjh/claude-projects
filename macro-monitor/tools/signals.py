#!/usr/bin/env python3
"""
シグナルの定義 — 「いつ条件を満たしたとみなすか」をここ1か所に集める
----------------------------------------------------
画面のランプ（indicators.py）と、過去の景気後退との突き合わせ（backtest.py）は、
必ずここの同じ関数を通す。ランプの定義と検証した定義がずれないようにするため。

各関数は月次の辞書を受け取り、{"values": 見せる数字, "sig": {月: bool}} を返す。
"""
from seriesutil import (diff, fill_gaps, ma, pct_change, rolling_max, rolling_min, ym_add)

# ---------- 地区連銀PMI（ISM換算）— ISM製造業PMIの代わり ----------
#
# ISMのPMIは有料配信で、無料では取り続けられない。代わりに、同じ形式の調査を
# 公開しているフィラデルフィア連銀とNY連銀の製造業調査から、ISMと同じ計算式で作る。
#
# 換算: 地区連銀の各項目は D = 「増えた%」−「減った%」で発表される。
#       ISMは 「増えた%」+「変わらない%」×0.5 で計算する（講義 U02 L4）。
#       「変わらない%」= 100 − 増えた% − 減った% なので、 ISM換算 = 50 + D/2。
#       数式上ぴったり一致し、50 が拡大と縮小の境目という意味も保たれる。
# 項目: ISMのPMIと同じ5項目を等ウェイト。
#       新規受注 / 生産（地区連銀では出荷）/ 雇用 / 入荷遅延 / 在庫
# 合成: 2地区の単純平均。NY連銀の調査が始まる前（2001年6月以前）はフィラデルフィアのみ。
PMI_COMPONENTS = [("NO", "新規受注"), ("SH", "出荷（ISMの生産に相当）"), ("NE", "雇用"),
                  ("DT", "入荷遅延"), ("IV", "在庫")]
FRED_PHILLY = "{}CDFSA066MSFRBPHI"     # フィラデルフィア連銀・季節調整済み
FRED_NY = "{}CDISA066MSFRBNY"          # NY連銀・季節調整済み
NY_START = "2001-07"


def to_ism(d):
    return 50 + d / 2


def regional_pmi(philly, ny, codes=None):
    """地区連銀PMI（ISM換算）を作る。

    philly, ny: {"NO": {月: D}, "SH": ..., ...}
    codes: 使う項目（省略時は5項目すべて＝PMI。["NO"] なら新規受注だけ）
    NY連銀の調査開始後は、両方がそろった月だけを出す。月の半ばにNYだけ先に発表されるが、
    片方だけの値を「今月の値」として出すと、後でフィラデルフィアが出たときに数字が動くため。
    """
    codes = codes or [c for c, _ in PMI_COMPONENTS]
    out = {}
    for m in philly[codes[0]]:
        srcs = [philly] if m < NY_START else [philly, ny]
        vals = []
        for s in srcs:
            if all(m in s[c] for c in codes):
                vals.append(sum(to_ism(s[c][m]) for c in codes) / len(codes))
        if len(vals) == len(srcs):
            out[m] = sum(vals) / len(vals)
    return out


def pmi_below_50(pmi):
    """50割れ。3ヶ月平均にはしない — ISM公表値との50割れ一致は、月次値のほうが高かった
    （64ヶ月中 月次54 / 3ヶ月平均51。backtest.py の validate_pmi）。"""
    return {"values": pmi, "sig": {m: v < 50 for m, v in pmi.items()}}


NO_PEAKOUT_DROP = 7.0   # backtest.py で 3/5/7pt を比べた。7ptが誤報最少（3pt・5ptは22回、7ptは12回）


def new_orders_peakout(no):
    """新規受注のピークアウト: 3ヶ月平均が、直近12ヶ月の高値から7pt以上下がった状態。"""
    no3 = ma(no, 3)
    hi = rolling_max(no3, 12)
    drop = {m: no3[m] - hi[m] for m in hi}
    return {"values": drop, "ma3": no3,
            "sig": {m: v <= -NO_PEAKOUT_DROP for m, v in drop.items()}}


# ---------- 労働の質 ----------

def ftpt(ft, pt):
    """フルタイム÷パートタイム比率の6ヶ月平均が、前年より下がっている。

    家計調査は月々の振れが大きく、生の前年比だと誤報が20回出る（backtest.py）。
    6ヶ月平均にしても単独では11回残るので、単独のランプにはせず「労働の質」の1要素にする。
    """
    ft_f, f1 = fill_gaps(ft)
    pt_f, f2 = fill_gaps(pt)
    ratio = {m: ft_f[m] / pt_f[m] for m in ft_f if m in pt_f}
    yoy = pct_change(ma(ratio, 6), 12)
    return {"values": yoy, "ratio": ratio, "filled": sorted(set(f1 + f2)),
            "sig": {m: v < 0 for m, v in yoy.items()}}


def gov_share(gov, payems):
    """政府雇用が非農業雇用に占める比率が、12ヶ月前より上がっている。"""
    share = {m: gov[m] / payems[m] * 100 for m in gov if m in payems}
    d = diff(share, 12)
    return {"values": d, "share": share, "sig": {m: v > 0 for m, v in d.items()}}


CLAIMS_RISE = 10.0   # recession-watch で較正済みの警告ライン（2年安値比 +10%）


def claims(ccsa_monthly):
    """継続受給者数が、直近2年の安値から10%以上増えている。"""
    low = rolling_min(ccsa_monthly, 24)
    rise = {m: ccsa_monthly[m] / low[m] * 100 - 100 for m in low}
    return {"values": rise, "sig": {m: v >= CLAIMS_RISE for m, v in rise.items()}}


def labor_quality(s_ftpt, s_gov, s_claims):
    """労働の質: 3つの要素のうち2つ以上が条件を満たしている。"""
    months = set(s_ftpt["sig"]) & set(s_gov["sig"]) & set(s_claims["sig"])
    count = {m: int(s_ftpt["sig"][m]) + int(s_gov["sig"][m]) + int(s_claims["sig"][m])
             for m in months}
    return {"values": count, "sig": {m: c >= 2 for m, c in count.items()}}


# ---------- 住宅・PER ----------

NAHB_DROP = 10.0
NAHB_REBOUND = 5.0


def nahb_worse(hmi):
    """NAHB指数が12ヶ月前より10pt以上悪化している。

    水準（50割れ）では見ない。2024年5月から30ヶ月連続で50を下回っているが景気後退は来ておらず、
    水準のランプは「ずっと点いたまま」になるため。
    """
    d = diff(hmi, 12)
    return {"values": d, "sig": {m: v <= -NAHB_DROP for m, v in d.items()}}


def nahb_rebound(hmi):
    """底打ちの目安: 直近6ヶ月の安値から5pt以上戻している。"""
    low = rolling_min(hmi, 6)
    up = {m: hmi[m] - low[m] for m in low}
    return {"values": up, "sig": {m: v >= NAHB_REBOUND for m, v in up.items()}}


def pe_contraction(pe):
    """PERの縮小: 実績PERが前年より低い。"""
    yoy = pct_change(pe, 12)
    return {"values": yoy, "sig": {m: v < 0 for m, v in yoy.items()}}


# ---------- 政策金利のサイクル ----------

def policy_cycles(target_obs):
    """政策金利の誘導目標（日次）から、利上げ・利下げサイクルの始まりを拾う。

    「サイクルの始まり」= 直前の変更と向きが逆の変更。同じ向きの変更は、間に長い据え置きが
    挟まっても同じサイクルとして数える（講義の「引き締め開始」の数え方に合わせる）。
    戻り値: [{"start": "2022-03-17", "dir": "hike"|"cut", "moves": 回数, "last": 最後の変更日,
              "from": 開始前の金利, "to": 最後の変更後の金利}]
    """
    cycles, prev = [], None
    for o in target_obs:
        if prev is not None and abs(o["v"] - prev["v"]) > 1e-9:
            d = "hike" if o["v"] > prev["v"] else "cut"
            if not cycles or cycles[-1]["dir"] != d:
                cycles.append({"start": o["d"], "dir": d, "moves": 0, "from": prev["v"]})
            cycles[-1]["moves"] += 1
            cycles[-1]["last"] = o["d"]
            cycles[-1]["to"] = o["v"]
        prev = o
    return cycles


# ---------- グローバル中銀ディフュージョン ----------

CB_WINDOW = 6          # 何ヶ月前と比べるか
CB_EPS = 0.01          # これ以下の差は「据え置き」


def cb_diffusion(rates):
    """各月について「6ヶ月前より政策金利を上げた中銀の割合 − 下げた中銀の割合」（%pt）。

    rates: {"US": {月: 金利}, ...}（BISの月末値）
    その月と6ヶ月前の両方に値がある中銀だけを数える。
    戻り値: {"net": {月: 値}, "hike": {月: %}, "cut": {月: %}, "n": {月: 中銀の数}}
    """
    months = sorted({m for s in rates.values() for m in s})
    net, hike, cut, n = {}, {}, {}, {}
    for m in months:
        p = ym_add(m, -CB_WINDOW)
        up = down = tot = 0
        for s in rates.values():
            if m in s and p in s:
                tot += 1
                d = s[m] - s[p]
                up += d > CB_EPS
                down += d < -CB_EPS
        if tot >= 8:
            n[m] = tot
            hike[m] = up / tot * 100
            cut[m] = down / tot * 100
            net[m] = hike[m] - cut[m]
    return {"net": net, "hike": hike, "cut": cut, "n": n}
