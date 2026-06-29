#!/usr/bin/env python3
"""
抽出精度の測定（評価ハーネス）
================================
Gemini の抽出結果を、手動作成した正解データ（ground truth）と突き合わせて
館ごとの 適合率(precision) / 再現率(recall) / F1 を算出する。
プロンプトを変えたときの「良くなった/悪くなった」を数値で確認できる。

正解データ: ingest/eval/<centerId>.json  形式 {"events": [{"date","title","dateEnd"?}]}
判定:
  - 日付一致: 正解の date が、抽出側の [date, dateEnd] 期間に含まれれば一致。
  - 行事名一致: 記号・空白・数字を除いて正規化し、一方が他方を含めば一致。

使い方:
  export GEMINI_API_KEY=xxxxx
  python3 ingest/eval.py                # 正解データのある全館
  python3 ingest/eval.py --center kasai # 指定館のみ
"""

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL_DIR = HERE / "eval"

_spec = importlib.util.spec_from_file_location("ingest", HERE / "ingest.py")
ing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ing)


def norm(s):
    return re.sub(r"[\s　・！!？?、。，,.（）()\-〜~0-9０-９]", "", (s or "")).lower()


def title_match(a, b):
    a, b = norm(a), norm(b)
    return bool(a and b and (a in b or b in a))


def date_match(gt, pred):
    """正解日 gt['date'] が抽出側の期間に含まれるか。"""
    d = pred.get("date")
    if not d:
        return False
    de = pred.get("dateEnd") or d
    g, ge = gt["date"], gt.get("dateEnd") or gt["date"]
    return d <= ge and de >= g  # 期間が重なれば一致


def evaluate(center, preds, gt):
    hit_gt = [g for g in gt if any(date_match(g, p) and title_match(g["title"], p["title"]) for p in preds)]
    correct_pred = [p for p in preds if any(date_match(g, p) and title_match(g["title"], p["title"]) for g in gt)]
    recall = len(hit_gt) / len(gt) if gt else 0.0
    precision = len(correct_pred) / len(preds) if preds else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    missed = [g for g in gt if g not in hit_gt]
    extra = [p for p in preds if p not in correct_pred]
    return {"precision": precision, "recall": recall, "f1": f1,
            "n_pred": len(preds), "n_gt": len(gt), "missed": missed, "extra": extra}


def main():
    ap = argparse.ArgumentParser(description="抽出精度の測定（precision/recall/F1）")
    ap.add_argument("--center", help="この館IDのみ評価")
    ap.add_argument("--year", type=int, default=2026)
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        sys.exit("環境変数 GEMINI_API_KEY が未設定です。 https://aistudio.google.com/apikey で無料取得できます。")

    centers = {c["id"]: c for c in json.loads((HERE.parent / "data" / "centers.json").read_text("utf-8"))}
    gt_files = sorted(EVAL_DIR.glob("*.json"))
    if args.center:
        gt_files = [f for f in gt_files if f.stem == args.center]
        if not gt_files:
            sys.exit(f"正解データ ingest/eval/{args.center}.json がありません。")

    rows, tot_p, tot_r, tot_f, n = [], 0.0, 0.0, 0.0, 0
    for gf in gt_files:
        cid = gf.stem
        gt = json.loads(gf.read_text("utf-8")).get("events", [])
        c = centers.get(cid)
        if not c:
            print(f"[skip] {cid}: centers.json に未登録")
            continue
        print(f"[評価] {c['name']} …")
        try:
            mime, data, _ = ing.fetch_source(c["pdfUrl"])
            raw = ing.gemini_extract(mime, data, api_key, args.year)
            preds = [ing.normalize(e, cid, i + 1) for i, e in enumerate(raw)
                     if isinstance(e, dict) and e.get("date")]
        except Exception as e:
            print(f"    !! 失敗: {e}")
            continue
        r = evaluate(cid, preds, gt)
        rows.append((c["name"], r))
        tot_p += r["precision"]; tot_r += r["recall"]; tot_f += r["f1"]; n += 1
        print(f"    適合率 {r['precision']:.0%} / 再現率 {r['recall']:.0%} / F1 {r['f1']:.0%}"
              f"  (抽出 {r['n_pred']} 件 / 正解 {r['n_gt']} 件)")
        for g in r["missed"]:
            print(f"      − 取りこぼし: {g['date']} {g['title']}")
        for p in r["extra"]:
            print(f"      + 余分/誤り : {p['date']} {p['title']}")

    if n:
        print("\n==== 平均 ====")
        print(f"  適合率 {tot_p/n:.0%} / 再現率 {tot_r/n:.0%} / F1 {tot_f/n:.0%}  （{n} 館）")


if __name__ == "__main__":
    main()
