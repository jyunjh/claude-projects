#!/usr/bin/env python3
"""
snapshot の自己検証 — ネットワーク不要
----------------------------------------------------
data/snapshot.json を読み、判定を indicators.py とは別の書き方で数え直して突き合わせる。
生成側のバグで「ランプの色」と「数字」が食い違ったまま公開されるのを防ぐ。

  python3 tools/verify.py            検証して結果を表示（失敗があれば終了コード1）
  python3 tools/verify.py --fresh    鮮度（asOf が古すぎないか）も確認する
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED = ["yieldCurve", "cpi", "laborQuality", "nahb", "pmi", "newOrders",
            "clock18", "per", "cbDiffusion", "twd"]
TAB_IDS = {"summary", "calendar", "cycle", "headline", "rates", "global", "dollar", "sources"}
# 鮮度の目安（日）。月次統計は公表が翌月半ば〜、BISは月末値が翌月に出る
MAX_AGE_DAYS = {"yieldCurve": 10, "twd": 14, "clock18": 10, "cpi": 80, "laborQuality": 70,
                "nahb": 50, "pmi": 60, "newOrders": 60, "per": 45, "cbDiffusion": 120}
DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))


def as_date(s):
    """'2026-10' は月初として扱う（その月の統計は月初以降にしか出ないので、未来判定はこれで足りる）。"""
    return datetime.strptime(s + ("-01" if len(s) == 7 else ""), "%Y-%m-%d")


def main():
    path = os.path.join(BASE, "data", "snapshot.json")
    with open(path, encoding="utf-8") as f:
        snap = json.load(f)
    with open(os.path.join(BASE, "data", "snapshot.js"), encoding="utf-8") as f:
        js = f.read()
    check("snapshot.js が snapshot.json と同じ内容", js.startswith("window.MACRO_SNAPSHOT=")
          and json.loads(js[len("window.MACRO_SNAPSHOT="):].rstrip().rstrip(";")) == snap)
    check("schema が 1", snap.get("schema") == 1)
    check("タブが想定どおり", {t["id"] for t in snap["tabs"]} == TAB_IDS)
    check("指標が10個そろっている", snap["order"] == EXPECTED and set(snap["indicators"]) == set(EXPECTED))
    gen = datetime.fromisoformat(snap["generatedAt"]).replace(tzinfo=None)
    ind = snap["indicators"]

    for key in EXPECTED:
        i = ind[key]
        if i.get("missing"):
            check(f"{key}: 取得できていない指標は info で値なし", i["status"] == "info" and i["value"] is None)
            continue
        need = ["id", "tab", "title", "value", "valueText", "asOf", "status", "statusText",
                "basis", "basisText", "detail", "notes", "charts", "sources"]
        miss = [k for k in need if k not in i]
        check(f"{key}: 必須フィールド", not miss, f"欠落 {miss}")
        if miss:
            continue
        check(f"{key}: 値が有限の数", isinstance(i["value"], (int, float)) and math.isfinite(i["value"]))
        check(f"{key}: status が既知", i["status"] in ("safe", "caution", "warning", "info"))
        check(f"{key}: タブが既知", i["tab"] in TAB_IDS - {"summary", "calendar", "sources"})
        check(f"{key}: 根拠の種別が A か B で、説明がある", i["basis"] in ("A", "B") and len(i["basisText"]) > 10)
        check(f"{key}: asOf が日付で、生成時刻より未来でない",
              bool(DATE_RE.match(i["asOf"])) and as_date(i["asOf"]) <= gen + timedelta(days=1), i["asOf"])
        check(f"{key}: 出典が1件以上あり https", len(i["sources"]) >= 1
              and all(s["url"].startswith("https://") and s.get("retrievedAt") for s in i["sources"]))
        check(f"{key}: グラフが1つ以上", len(i["charts"]) >= 1)
        for c in i["charts"]:
            for s in c["series"]:
                pts = s["points"]
                ok = (len(pts) > 0
                      and all(DATE_RE.match(p[0]) and isinstance(p[1], (int, float)) and math.isfinite(p[1])
                              for p in pts)
                      and all(a[0] < b[0] for a, b in zip(pts, pts[1:])))
                check(f"{key}/{c['id']}: 「{s['label']}」が空でなく、昇順で、値が有限", ok, f"{len(pts)}点")
            check(f"{key}/{c['id']}: 水平線の値が数", all(isinstance(l["v"], (int, float)) for l in c["lines"]))
        if "--fresh" in sys.argv and not i.get("stale"):
            age = (gen - as_date(i["asOf"])).days
            check(f"{key}: 鮮度（{age}日前）", age <= MAX_AGE_DAYS[key], f"目安 {MAX_AGE_DAYS[key]}日")

    # --- status の数え直し（indicators.py とは独立に） ---
    def live(k):
        return k in ind and not ind[k].get("missing")

    if live("yieldCurve"):
        v = ind["yieldCurve"]["value"]
        check("逆イールド: status としきい値（0 / +1.0）が合う",
              ind["yieldCurve"]["status"] == ("warning" if v < 0 else "caution" if v < 1 else "safe"))
        last = ind["yieldCurve"]["charts"][0]["series"][0]["points"][-1]
        check("逆イールド: カードの値とグラフの最後の点が同じ", abs(last[1] - v) < 0.006, f"{last} vs {v}")
    if live("cpi"):
        v = ind["cpi"]["value"]
        check("CPI: status としきい値（3% / 5%）が合う",
              ind["cpi"]["status"] == ("warning" if v >= 5 else "caution" if v >= 3 else "safe"))
    if live("laborQuality"):
        i = ind["laborQuality"]
        n = sum(1 for c in i["components"] if c["lit"])
        check("労働の質: 該当数が要素の数え直しと一致", n == i["value"] and len(i["components"]) == 3)
        check("労働の質: 2つ未満なら警告にならない", not (n < 2 and i["status"] == "warning"))
        check("労働の質: 0なら安全、1以上なら注意以上", (i["status"] == "safe") == (n == 0))
    if live("pmi"):
        i = ind["pmi"]
        check("PMI: 50未満なら警告、50以上なら警告でない", (i["value"] < 50) == (i["status"] == "warning"))
        check("PMI: 代替系列の定義が書かれている", len(i.get("definition", [])) >= 4)
    if live("cbDiffusion"):
        i = ind["cbDiffusion"]
        check("中銀ディフュージョン: −100〜+100 の範囲で、定義が書かれている",
              -100 <= i["value"] <= 100 and len(i.get("definition", [])) >= 3)
    for k in ("cbDiffusion", "twd"):
        if live(k):
            check(f"{k}: ランプを持たない（info）", ind[k]["status"] == "info")
    for k in ("nahb", "newOrders", "per"):
        if live(k):
            check(f"{k}: 警告（赤）にはならない設計", ind[k]["status"] in ("safe", "caution"))

    # --- 総合判定の数え直し ---
    v = snap["verdict"]
    core = [k for k in ("yieldCurve", "cpi", "laborQuality") if live(k)]
    lit = [k for k in core if ind[k]["status"] == "warning"]
    check("総合: 点灯している核指標の数え直しが一致", lit == v["lit"] and len(core) == v["coreCount"])
    check("総合: 2つ以上点灯なら warning、そうでなければ warning でない", (len(lit) >= 2) == (v["level"] == "warning"))
    check("総合: 核指標が欠けていれば incomplete で、safe にしない",
          v["incomplete"] == (len(core) < 3) and not (v["incomplete"] and v["level"] == "safe"))

    tp = snap["turningPoints"]
    check("ターニングポイント: 6項目で、点灯数が数え直しと一致",
          tp["of"] == 6 and len(tp["items"]) == 6 and tp["lit"] == sum(1 for x in tp["items"] if x["lit"]))
    for x in tp["items"]:
        check(f"ターニングポイント「{x['label']}」: 参照先の指標がある", x["ref"] in ind)
    if live("clock18"):
        c = ind["clock18"]["_cycle"]
        want = c["dir"] == "hike" and c["elapsed"] >= 18
        got = next(x for x in tp["items"] if x["id"] == "clock")["lit"]
        check("ターニングポイント: 18ヶ月時計は利上げサイクルで18ヶ月以上のときだけ点灯", want == got)

    ph = snap["phase"]
    check("局面: 3区分のどれか", ph and ph["id"] in ("riskOn", "riskOff", "riskAversion"))
    if ph:
        check("局面: 収縮はPMIが50未満のときだけ、ピークアウトは50以上のときだけ",
              not (ph["id"] == "riskAversion" and ph["pmi"] >= 50) and not (ph["id"] == "riskOff" and ph["pmi"] < 50))
    rec = snap["recessions"]
    check("景気後退期: 1件以上あり、開始≦終了で昇順",
          len(rec) >= 8 and all(a <= b for a, b in rec) and all(x[1] < y[0] for x, y in zip(rec, rec[1:])))
    # --- 公表カレンダー ---
    cal = snap.get("calendar")
    check("公表カレンダーがある", bool(cal))
    if cal:
        evs = cal["events"]
        check("カレンダー: 予定が1件以上あり、日付順", len(evs) > 0
              and all((a["date"], a["timeJst"] or "99") <= (b["date"], b["timeJst"] or "99") for a, b in zip(evs, evs[1:])))
        check("カレンダー: 日付・時刻の形式", all(DATE_RE.match(e["date"]) and len(e["date"]) == 10
              and (e["timeJst"] is None or re.match(r"^\d{2}:\d{2}$", e["timeJst"])) for e in evs))
        check("カレンダー: 各予定の指標が実在する", all(set(e["indicators"]) <= set(EXPECTED) for e in evs))
        check("カレンダー: 画面への反映は公表より後",
              all(e["reflect"] is None or e["reflect"] >= f"{e['date']} {e['timeJst'] or '00:00'}" for e in evs))
        check("カレンダー: 反映済みなら公表済み", all(e["released"] for e in evs if e["reflected"]))
        check("カレンダー: 全指標に「次の更新」がある", set(cal["next"]) == set(EXPECTED),
              f"欠落 {set(EXPECTED) - set(cal['next'])}")
        ids = {r["id"] for r in cal["releases"]}
        check("カレンダー: 予定の種類が一覧と一致", {e["id"] for e in evs} <= ids)
        check("カレンダー: 今月か来月に予定が1件以上", any(e["date"][:7] in (cal["today"][:7], (datetime.strptime(cal["today"][:7] + "-28", "%Y-%m-%d") + timedelta(days=7)).strftime("%Y-%m")) and not e["released"] for e in evs))
    check("取得エラーなし", not snap["errors"], "; ".join(f"{e['source']}: {e['message']}" for e in snap["errors"]))

    bad = [r for r in results if not r[1]]
    for name, ok, detail in results:
        if not ok or "-v" in sys.argv:
            print(("✓ " if ok else "✗ ") + name + (f" — {detail}" if detail and not ok else ""))
    print(f"\n{len(results) - len(bad)}/{len(results)} 項目が合格")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
