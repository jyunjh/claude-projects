#!/usr/bin/env python3
"""読み取った特売（1チラシ or 受付箱の1件ぶん）を検査し、data/sales.json に蓄積する。

使い方:
  # 検査だけ（反映しない）。終了コード 0=OK / 2=要修正
  python3 ingest/merge_sales.py --check --flyer <flyerKey> --file <tmp>/x_sales.json
  # 反映（検査に通らなければ反映しない）
  python3 ingest/merge_sales.py --flyer <flyerKey> --file <tmp>/x_sales.json
  # 受付箱（LINEで送られた写真・投稿）由来
  python3 ingest/merge_sales.py --inbox <inboxId> --store <storeId> --file <tmp>/inbox_x.json
  # 期限切れの掃除だけ
  python3 ingest/merge_sales.py --prune
  # 取り込まないチラシ（食品が載っていない等）を、同じ画像のあいだ再検出しないようにする
  python3 ingest/merge_sales.py --skip-flyer <flyerKey> --note "理由"

規則（docs/SPEC.md §2.3）:
- 取り込みはチラシ単位で差し替え。同じ id は更新して変わった値を history に積む。
  新しい入力に無い既存分は status=withdrawn（消さない）。
- validTo が今日-45日より前のものは削除。
- 同じ入力で冪等（generatedAt 以外は変わらない）。
標準ライブラリのみ。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("SALE_ALERT_DATA") or ROOT / "data")  # テスト時に差し替え可
SALES = DATA / "sales.json"
FLYERS = DATA / "flyers.json"
STORES = DATA / "stores.json"

JST = dt.timezone(dt.timedelta(hours=9))
FROM_PAST_DAYS = 40  # validFrom の許容下限（今日-40日）
CATEGORIES = {"肉", "魚", "野菜", "果物", "卵・乳", "米・パン", "日配", "冷凍", "菓子",
              "飲料", "調味料", "日用品", "その他"}
FIELDS = ("title", "brand", "spec", "price", "priceTaxIncl", "priceText", "validFrom",
          "validTo", "conditions", "category", "source")
TRACKED = ("price", "priceTaxIncl", "validTo", "conditions")  # 変わったら history に積む値
KEEP_DAYS = 45
_STRIP = re.compile(r"[\s・･\-‐－―ー〜~、。,./／()（）「」『』【】\[\]]")


def now_iso() -> str:
    return dt.datetime.now(JST).replace(microsecond=0).isoformat()


def today() -> dt.date:
    return dt.datetime.now(JST).date()


def normalize(s) -> str:
    """match.js の normalize と同じ規則"""
    t = unicodedata.normalize("NFKC", str(s or "")).lower()
    t = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in t)
    return _STRIP.sub("", t)


def sale_id(flyer_key: str, rec: dict) -> str:
    raw = "|".join([flyer_key, rec["validFrom"], normalize(rec["title"]), normalize(rec.get("spec"))])
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def load(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _date(s, label, errs):
    try:
        return dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        errs.append(f"{label}: 日付が YYYY-MM-DD でない: {s!r}")
        return None


def validate(records, store_ids: set, store_id: str | None) -> tuple[list[dict], list[str], list[str]]:
    """読み取り結果を正規化し、(records, errors, warnings) を返す"""
    errs, warns, out = [], [], []
    if not isinstance(records, list):
        return [], ["入力は JSON 配列であること"], []
    t = today()
    # 下限は月初開始の月間チラシ（最大31日前）を通す幅。年の取り違え（±365日）は拒否できる
    lo, hi = t - dt.timedelta(days=FROM_PAST_DAYS), t + dt.timedelta(days=60)
    for i, r in enumerate(records):
        lab = f"#{i + 1} {r.get('title', '?') if isinstance(r, dict) else '?'}"
        if not isinstance(r, dict):
            errs.append(f"{lab}: オブジェクトでない")
            continue
        title = (r.get("title") or "").strip()
        if not title:
            errs.append(f"{lab}: title が空")
            continue
        sid = r.get("storeId") or store_id
        if sid not in store_ids:
            errs.append(f"{lab}: storeId が stores.json に無い: {sid!r}")
            continue
        vf = _date(r.get("validFrom"), lab, errs)
        vt = _date(r.get("validTo") or r.get("validFrom"), lab, errs)
        if not vf or not vt:
            continue
        if vt < vf:
            errs.append(f"{lab}: validTo({vt}) が validFrom({vf}) より前")
        if not (lo <= vf <= hi):
            errs.append(f"{lab}: validFrom {vf} が許容範囲 {lo}〜{hi} の外（年の取り違え？）")
        if (vt - vf).days > 31:
            warns.append(f"{lab}: 期間が {(vt - vf).days} 日と長い")
        for k in ("price", "priceTaxIncl"):
            v = r.get(k)
            if v is not None and not (isinstance(v, (int, float)) and 1 <= v <= 100000):
                errs.append(f"{lab}: {k} が数値(1〜100000)でない: {v!r}")
        p, pt = r.get("price"), r.get("priceTaxIncl")
        if isinstance(p, (int, float)) and isinstance(pt, (int, float)) and not (p <= pt <= p * 1.11):
            errs.append(f"{lab}: 税込 {pt} が本体 {p} の 1.00〜1.10 倍に収まらない（読み違い？）")
        if p is None and pt is None and not r.get("priceText"):
            errs.append(f"{lab}: 価格も priceText も無い")
        cat = r.get("category") or "その他"
        if cat not in CATEGORIES:
            warns.append(f"{lab}: 未知の category {cat!r} → その他")
            cat = "その他"
        conds = r.get("conditions") or []
        if isinstance(conds, str):
            conds = [conds]
        out.append({
            "storeId": sid, "title": title, "brand": r.get("brand") or None,
            "spec": r.get("spec") or None, "price": p, "priceTaxIncl": pt,
            "priceText": r.get("priceText") or None,
            "validFrom": vf.isoformat(), "validTo": vt.isoformat(),
            "conditions": [str(c).strip() for c in conds if str(c).strip()],
            "category": cat, "source": r.get("source") or {},
        })
    return out, errs, warns


def merge(doc: dict, flyer_key: str, records: list[dict], stamp: str) -> dict:
    sales = doc.setdefault("sales", [])
    by_id = {s["id"]: s for s in sales}
    stats = {"added": 0, "updated": 0, "unchanged": 0, "withdrawn": 0, "duplicate": 0}
    seen = set()
    for r in records:
        sid = sale_id(flyer_key, r)
        if sid in seen:
            stats["duplicate"] += 1
            continue
        seen.add(sid)
        cur = by_id.get(sid)
        if cur is None:
            new = {"id": sid, "flyerKey": flyer_key, **r, "status": "active",
                   "firstSeenAt": stamp, "updatedAt": stamp, "history": []}
            sales.append(new)
            by_id[sid] = new
            stats["added"] += 1
            continue
        changed = cur.get("status") != "active" or any(cur.get(k) != r.get(k) for k in FIELDS)
        if not changed:
            stats["unchanged"] += 1
            continue
        if any(cur.get(k) != r.get(k) for k in TRACKED):
            cur.setdefault("history", []).append(
                {"at": cur.get("updatedAt"), **{k: cur.get(k) for k in TRACKED}})
        cur.update(r)
        cur["status"] = "active"
        cur["updatedAt"] = stamp
        stats["updated"] += 1
    for s in sales:
        if s.get("flyerKey") == flyer_key and s["id"] not in seen and s.get("status") != "withdrawn":
            s["status"] = "withdrawn"
            s["updatedAt"] = stamp
            stats["withdrawn"] += 1
    return stats


def prune(doc: dict) -> int:
    cutoff = (today() - dt.timedelta(days=KEEP_DAYS)).isoformat()
    before = len(doc.get("sales", []))
    doc["sales"] = [s for s in doc.get("sales", []) if s.get("validTo", "9999") >= cutoff]
    return before - len(doc["sales"])


def write_sales(doc: dict, stamp: str) -> None:
    doc["sales"].sort(key=lambda s: (s["validFrom"], s["storeId"], s["title"]))
    doc["generatedAt"] = stamp
    save(SALES, {"generatedAt": doc["generatedAt"], "sales": doc["sales"]})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--flyer", help="flyers.json の key")
    ap.add_argument("--inbox", help="受付箱の id（LINEで送られたもの）")
    ap.add_argument("--store", help="storeId（--inbox のとき、各レコードに無ければ必須）")
    ap.add_argument("--file", help="読み取り結果の JSON 配列")
    ap.add_argument("--check", action="store_true", help="検査のみ")
    ap.add_argument("--prune", action="store_true", help="期限切れの削除のみ")
    ap.add_argument("--skip-flyer", help="このチラシを取り込まない（同じ画像のあいだ）")
    ap.add_argument("--note", default="", help="--skip-flyer の理由")
    a = ap.parse_args()

    if a.skip_flyer:
        flyers = load(FLYERS, {"flyers": []})
        f = next((x for x in flyers["flyers"] if x["key"] == a.skip_flyer), None)
        if f is None:
            print(f"flyers.json に {a.skip_flyer} が無い", file=sys.stderr)
            return 1
        f.update({"status": "skipped", "skippedHash": f.get("hash"), "note": a.note})
        save(FLYERS, flyers)
        print(f"{a.skip_flyer} を skipped にしました")
        return 0

    stamp = now_iso()
    doc = load(SALES, {"generatedAt": None, "sales": []})
    if a.prune and not a.file:
        n = prune(doc)
        write_sales(doc, stamp)
        print(f"削除 {n} 件 / 残り {len(doc['sales'])} 件")
        return 0
    if not a.file or not (a.flyer or a.inbox):
        ap.error("--file と、--flyer か --inbox のどちらかが必要")

    stores = load(STORES, {"stores": []})
    store_ids = {s["id"] for s in stores["stores"]}
    flyers = load(FLYERS, {"flyers": []})
    flyer = None
    if a.flyer:
        flyer = next((f for f in flyers["flyers"] if f["key"] == a.flyer), None)
        if flyer is None:
            print(f"flyers.json に {a.flyer} が無い", file=sys.stderr)
            return 1
        key, store_id = a.flyer, flyer["storeId"]
    else:
        key, store_id = f"inbox:{a.inbox}", a.store

    raw = json.loads(Path(a.file).read_text(encoding="utf-8"))
    records, errs, warns = validate(raw, store_ids, store_id)
    if a.flyer:  # チラシ由来は必ずそのチラシの店
        for r in records:
            if r["storeId"] != store_id:
                errs.append(f"{r['title']}: storeId がチラシの店 {store_id} と違う")
    for w in warns:
        print("注意:", w)
    for e in errs:
        print("要修正:", e)
    print(f"{len(records)} 件を検査 / 要修正 {len(errs)} / 注意 {len(warns)}")
    if errs:
        return 2
    if a.check:
        return 0

    stats = merge(doc, key, records, stamp)
    pruned = prune(doc)
    write_sales(doc, stamp)
    if flyer is not None:
        flyer["ingestedHash"] = flyer.get("hash")
        flyer["ingestedAt"] = stamp
        flyer["status"] = "ingested"
        save(FLYERS, flyers)
    print("反映:", ", ".join(f"{k} {v}" for k, v in stats.items()), f"/ 期限切れ削除 {pruned}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
