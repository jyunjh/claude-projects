#!/usr/bin/env python3
"""
バックテスト — 各シグナルを NBER の景気後退の山と突き合わせる
----------------------------------------------------
しきい値に「B（当ツール較正）」のタグを付けるときは、必ずここで実測した数字を根拠にする。
update.py は毎回これを走らせ、結果を snapshot の basisText に埋め込む
（データが改定されても、画面の根拠の数字とロジックがずれない）。

  python3 tools/backtest.py          取得済みキャッシュで全シグナルを実測して表示
  python3 tools/backtest.py --ism    地区連銀PMIを ISM 公表値（DBnomicsの転載）と照合（1回きりの検証用）

数え方（seriesutil.evaluate）:
  条件が3ヶ月連続で成り立った「かたまり」の開始月を1回の発生とする。
  山の24ヶ月前〜3ヶ月後に始まったものを的中、どの山の窓にも入らないものを誤報とする。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "sources"))

import signals as S  # noqa: E402
from loader import load_all, regional_components  # noqa: E402
from seriesutil import evaluate, ma, monthly, monthly_avg, rolling_max  # noqa: E402


def run(raw):
    """取得済みデータから全シグナルを実測する。取れていない系列の分は結果に入らない。"""
    f = raw.get("fred", {})
    out = {}

    def have(*ids):
        return all(i in f for i in ids)

    def m(sid):
        return monthly(f[sid]["observations"])

    if have("LNS12500000", "LNS12600000"):
        s_ftpt = S.ftpt(m("LNS12500000"), m("LNS12600000"))
        out["ftpt"] = evaluate(s_ftpt["sig"], "1969-06")
    if have("USGOVT", "PAYEMS"):
        s_gov = S.gov_share(m("USGOVT"), m("PAYEMS"))
        out["govShare"] = evaluate(s_gov["sig"], "1969-06")
    if have("CCSA"):
        s_claims = S.claims(monthly_avg(f["CCSA"]["observations"]))
        out["claims"] = evaluate(s_claims["sig"], "1969-06")
    if all(k in out for k in ("ftpt", "govShare", "claims")):
        out["laborQuality"] = evaluate(S.labor_quality(s_ftpt, s_gov, s_claims)["sig"], "1969-06")

    try:
        ph, ny = regional_components(raw)
    except KeyError:
        ph = ny = None
    if ph:
        pmi = S.regional_pmi(ph, ny)
        no = S.regional_pmi(ph, ny, ["NO"])
        out["pmi"] = evaluate(S.pmi_below_50(pmi)["sig"], "1969-06")
        out["newOrders"] = evaluate(S.new_orders_peakout(no)["sig"], "1969-12")
        # ピークアウト幅の比較（定義を決めた根拠として残す）
        no3 = ma(no, 3)
        hi = rolling_max(no3, 12)
        out["newOrdersAlt"] = {
            str(x): evaluate({k: no3[k] - hi[k] <= -x for k in hi}, "1969-12")
            for x in (3, 5, 7)}

    if "nahb" in raw:
        hmi = monthly(raw["nahb"]["observations"])
        out["nahb"] = evaluate(S.nahb_worse(hmi)["sig"], "1986-01")
        out["nahbBelow50"] = evaluate({k: v < 50 for k, v in hmi.items()}, "1986-01")
    if "multpl" in raw:
        pe = monthly(raw["multpl"]["monthly"])
        out["per"] = evaluate(S.pe_contraction(pe)["sig"], "1969-06")
    return out


def describe(r):
    """実測結果を画面用の1文にする。"""
    leads = [x for x in r["leads"] if x is not None]
    lead_txt = f"先行は{min(leads)}〜{max(leads)}ヶ月（マイナスは山より後）" if leads else "先行なし"
    return (f"景気後退の山{r['of']}回のうち{r['hits']}回で事前に発生、誤報は{len(r['false'])}回。{lead_txt}。")


def validate_pmi(raw):
    """地区連銀PMIを ISM の公表値と照合する。ISMの値は DBnomics の転載（無料・キー不要）。

    DBnomics の転載は2025年12月で止まっており、末尾に壊れた値（10.0 など）が混じるので、
    25未満は捨てる。毎日の更新では使わない、1回きりの検証用。
    """
    import statistics as st
    import urllib.request

    def ism(dataset, code):
        url = f"https://api.db.nomics.world/v22/series/ISM/{dataset}?observations=1&limit=20"
        d = json.load(urllib.request.urlopen(url, timeout=60))
        s = [x for x in d["series"]["docs"] if x["series_code"] == code][0]
        return {p: v for p, v in zip(s["period"], s["value"]) if v is not None and v > 25}

    def corr(a, b):
        ma_, mb = st.mean(a), st.mean(b)
        return (sum((x - ma_) * (y - mb) for x, y in zip(a, b))
                / (sum((x - ma_) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** .5)

    ph, ny = regional_components(raw)
    for name, ref, proxy in (("PMI", ism("pmi", "pm"), S.regional_pmi(ph, ny)),
                             ("新規受注", ism("neword", "in"), S.regional_pmi(ph, ny, ["NO"]))):
        for label, series in (("月次", proxy), ("3ヶ月平均", ma(proxy, 3))):
            xs = [series[k] for k in sorted(ref) if k in series]
            ys = [ref[k] for k in sorted(ref) if k in series]
            agree = sum((x < 50) == (y < 50) for x, y in zip(xs, ys))
            print(f"{name} {label}: n={len(xs)} 相関={corr(xs, ys):.2f} "
                  f"50割れの一致={agree}/{len(xs)} 偏り={st.mean(x - y for x, y in zip(xs, ys)):+.1f} "
                  f"期間={min(k for k in ref if k in series)}〜{max(k for k in ref if k in series)}")


if __name__ == "__main__":
    raw, errors = load_all(log=lambda *_: None)
    for e in errors:
        print("取得エラー:", e)
    if "--ism" in sys.argv:
        validate_pmi(raw)
    else:
        for k, r in run(raw).items():
            if k == "newOrdersAlt":
                for x, rr in r.items():
                    print(f"  新規受注ピークアウト幅 {x}pt: {rr['hits']}/{rr['of']} 誤報{len(rr['false'])} 先行{rr['leads']}")
            else:
                print(f"{k}: {r['hits']}/{r['of']} 誤報{len(r['false'])} 先行{r['leads']} 誤報の開始月{r['false']}")
