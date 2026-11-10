#!/usr/bin/env python3
"""
更新オーケストレータ — 公開データを取りに行き、画面が読む snapshot を書く
----------------------------------------------------
  python3 tools/update.py                 通常更新（新しいキャッシュがあればネットに出ない）
  python3 tools/update.py --force         キャッシュを無視して取り直す
  python3 tools/update.py --fallback F    取れなかった指標を、前回の snapshot.json (F) の値で補う

- LLMは使わない。取得・計算・判定はすべてこのPythonで完結する。
- 毎回すべての期間を取り直すので、状態を持たない（履歴ファイルを積み上げない）。
- 1つのソースが落ちても全体は落とさない。落ちた指標は --fallback があれば前回値を
  「キャッシュ表示」として出し、無ければ「取得できていない」と出す。古い値を新しい値のふりをさせない。
- 書き込みは一時ファイル → os.replace の置き換え。読みかけを掴ませない。
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "sources"))

import backtest  # noqa: E402
import indicators as I  # noqa: E402
from loader import load_all  # noqa: E402

DATA_DIR = os.path.join(BASE, "data")
TITLES = {"yieldCurve": ("cycle", "逆イールド（10年 − 3ヶ月）"), "cpi": ("cycle", "CPI 総合（前年比）"),
          "laborQuality": ("cycle", "労働の質（3つのうち2つ以上）"), "nahb": ("headline", "NAHB 住宅市場指数"),
          "pmi": ("headline", "地区連銀PMI（ISM換算）"), "newOrders": ("headline", "新規受注（地区連銀・ISM換算）"),
          "clock18": ("rates", "18ヶ月時計（政策金利のサイクル）"), "per": ("rates", "S&P500 実績PER"),
          "cbDiffusion": ("global", "グローバル中銀 政策ディフュージョン指数"),
          "twd": ("dollar", "貿易加重ドル指数（TWD・ブロード）")}


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def build_snapshot(raw, errors, fallback=None, now=None):
    now = now or datetime.now(timezone.utc).astimezone()
    today = now.strftime("%Y-%m-%d")
    errors = list(errors)
    try:
        bt = backtest.run(raw)
    except Exception as e:  # noqa: BLE001
        bt = {}
        errors.append({"source": "backtest", "message": str(e)})
    prev = (fallback or {}).get("indicators", {})
    ind = {}
    for key, fn in I.BUILDERS:
        try:
            ind[key] = fn(raw, bt, today) if key == "clock18" else fn(raw, bt)
        except Exception as e:  # noqa: BLE001 — 1指標の失敗で全体を落とさない
            msg = f"{type(e).__name__}: {e}"
            if key in prev and not prev[key].get("missing"):
                ind[key] = dict(prev[key], stale=True)
                errors.append({"source": key, "message": f"今回は作れなかったため前回の値を表示（{msg}）"})
            else:
                tab, title = TITLES[key]
                ind[key] = {"id": key, "tab": tab, "title": title, "missing": True, "status": "info",
                            "statusText": "取得できていない", "value": None, "valueText": "—", "asOf": None,
                            "basis": "", "basisText": "", "detail": [], "notes": [], "charts": [], "sources": []}
                errors.append({"source": key, "message": f"作れなかった（{msg}）"})
    try:
        ph = I.phase(raw)
    except Exception as e:  # noqa: BLE001
        ph = (fallback or {}).get("phase")
        errors.append({"source": "phase", "message": f"{type(e).__name__}: {e}"})
    try:
        rec = I.recessions(raw)
    except Exception:  # noqa: BLE001
        rec = (fallback or {}).get("recessions", [])
    return {
        "schema": 1,
        "generatedAt": now.isoformat(timespec="seconds"),
        "tabs": I.TABS,
        "order": [k for k, _ in I.BUILDERS],
        "indicators": ind,
        "verdict": I.recession_verdict(ind),
        "turningPoints": I.turning_points(ind),
        "phase": ph,
        "recessions": rec,
        "backtest": {k: {"hits": r["hits"], "of": r["of"], "false": len(r["false"]), "leads": r["leads"]}
                     for k, r in bt.items() if k != "newOrdersAlt"},
        "errors": errors,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="キャッシュを無視して取り直す")
    ap.add_argument("--fallback", help="前回の snapshot.json。取れなかった指標をこの値で補う")
    a = ap.parse_args()

    fallback = None
    if a.fallback and os.path.exists(a.fallback):
        try:
            with open(a.fallback, encoding="utf-8") as f:
                fallback = json.load(f)
            if fallback.get("schema") != 1:
                fallback = None
        except (OSError, ValueError):
            fallback = None

    print("取得中…")
    raw, errors = load_all(use_cache=not a.force)
    snap = build_snapshot(raw, errors, fallback)

    os.makedirs(DATA_DIR, exist_ok=True)
    text = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
    write_atomic(os.path.join(DATA_DIR, "snapshot.json"), text)
    # file:// で直接開いても読めるよう、同じ内容を <script> 用にも書く
    write_atomic(os.path.join(DATA_DIR, "snapshot.js"), "window.MACRO_SNAPSHOT=" + text + ";\n")

    v, tp = snap["verdict"], snap["turningPoints"]
    print(f"景気循環のサイン: {v['message']}")
    print(f"ターニングポイント: {tp['lit']}/{tp['of']}")
    if snap["phase"]:
        print(f"局面: {snap['phase']['label']} — {snap['phase']['reason']}")
    for k in snap["order"]:
        i = snap["indicators"][k]
        print(f"  [{i['status']:7}] {i['title']}: {i['valueText']}（{i['asOf']}） {i['statusText']}")
    for e in snap["errors"]:
        print(f"  ! {e['source']}: {e['message']}")
    print(f"書き出し: data/snapshot.json（{len(text) / 1024:.0f} KB）")
    missing = [k for k in snap["order"] if snap["indicators"][k].get("missing")]
    return 1 if len(missing) == len(snap["order"]) else 0


if __name__ == "__main__":
    sys.exit(main())
