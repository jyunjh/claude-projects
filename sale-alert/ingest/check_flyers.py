#!/usr/bin/env python3
"""各店のチラシを取得し、新しい／差し替えられたチラシを検出する（LLM不使用）。

  python3 ingest/check_flyers.py --out <tmp>/new.json --cache <tmp>/flyers
  # 特定の店だけ / 取得元の解析結果を見るだけ（flyers.json を書き換えない）
  python3 ingest/check_flyers.py --store maruetsu-kachidoki6 --dry-run --out /dev/stdout

終了コード: 0 = 取り込みの要るチラシなし / 3 = あり（new.json に一覧）/ 1 = エラー（全店で取得失敗など）

new.json:
  [{"key", "storeId", "storeName", "title", "periodText", "pageUrl", "images": ["<cache>/…png"], "reason": "new|changed"}]

チラシの同一性は「取得元ごとのチラシID」で、更新の有無は「画像バイト列のハッシュ」で判定する。
取得元（stores.json の sources[].kind）ごとの解析は adapters.py。標準ライブラリのみ。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import re
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import adapters  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("SALE_ALERT_DATA") or ROOT / "data")
JST = dt.timezone(dt.timedelta(hours=9))
# 食品の特売が載らないチラシは題名で読み飛ばす（画像も取らない）。NFKC 後に照合
SKIP_TITLE = re.compile(r"おせち|ギフト|gift|クリスマス|christmas|edy|オンライン|予約|ランドセル|お歳暮|お中元|福袋", re.I)


def now() -> dt.datetime:
    return dt.datetime.now(JST).replace(microsecond=0)


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", help="チラシ画像の保存先（既定: <out と同じ場所>/flyers）")
    ap.add_argument("--store", action="append", help="この店だけ（複数可）")
    ap.add_argument("--dry-run", action="store_true", help="flyers.json を更新しない")
    a = ap.parse_args()

    stores_doc = load(DATA / "stores.json", {"stores": []})
    radius = stores_doc.get("radiusKm", 2.0)
    stores = [s for s in stores_doc["stores"] if s.get("distanceKm", 0) <= radius]
    if a.store:
        stores = [s for s in stores if s["id"] in a.store]
    flyers_doc = load(DATA / "flyers.json", {"flyers": []})
    by_key = {f["key"]: f for f in flyers_doc["flyers"]}
    cache = Path(a.cache or Path(a.out).parent / "flyers")
    stamp = now().isoformat()

    todo, errors, tried = [], [], 0
    seen_keys, ok_sources = set(), set()
    for st in stores:
        if st.get("active") is False:
            continue
        for src in st.get("sources", []):
            fn = adapters.ADAPTERS.get(src.get("kind"))
            if fn is None:
                continue  # 取得手段の無い取得元（SNS など）は飛ばす
            tried += 1
            try:
                found = fn(src)
            except Exception as e:  # noqa: BLE001 — 店ごとに失敗を記録して続ける
                errors.append(f"{st['id']} ({src.get('kind')}): {e}")
                continue
            ok_sources.add(f"{st['id']}:{src['kind']}:")
            for fl in found:
                key = f"{st['id']}:{src['kind']}:{fl['id']}"
                seen_keys.add(key)
                cur = by_key.get(key)
                ver = fl.get("version")
                title_n = unicodedata.normalize("NFKC", fl.get("title") or "")
                if SKIP_TITLE.search(title_n):
                    if cur is None:
                        cur = {"key": key, "storeId": st["id"], "firstSeenAt": stamp,
                               "ingestedHash": None, "ingestedAt": None}
                        flyers_doc["flyers"].append(cur)
                        by_key[key] = cur
                    cur.update({"title": fl.get("title"), "periodText": fl.get("periodText"),
                                "pageUrl": fl.get("pageUrl"), "version": ver, "lastSeenAt": stamp,
                                "status": "skipped", "note": "題名で除外（食品特売以外）"})
                    continue
                if cur and ver and cur.get("version") == ver and cur.get("status") in ("ingested", "skipped"):
                    cur["lastSeenAt"] = stamp  # 同じ版で処理済み → 画像を取り直さない
                    continue
                try:
                    images = fl["images"] if "images" in fl else fl["resolve"]()
                    paths, digest = adapters.download_images(images, cache / key.replace(":", "_"))
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{key}: 画像を取得できない: {e}")
                    continue
                fl["images"] = images
                if cur is None:
                    cur = {"key": key, "storeId": st["id"], "firstSeenAt": stamp,
                           "ingestedHash": None, "ingestedAt": None}
                    flyers_doc["flyers"].append(cur)
                    by_key[key] = cur
                cur.update({"title": fl.get("title"), "periodText": fl.get("periodText"),
                            "pageUrl": fl.get("pageUrl") or src.get("url"), "images": fl["images"],
                            "hash": digest, "version": ver, "lastSeenAt": stamp})
                if cur.get("ingestedHash") == digest:
                    cur["status"] = "ingested"
                    continue
                if cur.get("status") == "skipped" and cur.get("skippedHash") == digest:
                    continue  # 取り込まないと判断済み（食品の載らないチラシ等）
                reason = "changed" if cur.get("ingestedHash") else "new"
                cur["status"] = reason
                todo.append({"key": key, "storeId": st["id"], "storeName": st["name"],
                             "title": fl.get("title"), "periodText": fl.get("periodText"),
                             "pageUrl": cur["pageUrl"], "images": [str(p) for p in paths], "reason": reason})
            time.sleep(1.0)  # 取得元への配慮

    # 取得に成功した取得元から消えたチラシは gone（掲載終了。特売データはそのまま残る）
    for f in flyers_doc["flyers"]:
        prefix = f["key"].rsplit(":", 1)[0] + ":"
        if prefix in ok_sources and f["key"] not in seen_keys and f.get("status") != "gone":
            f["status"] = "gone"
    flyers_doc["flyers"] = [f for f in flyers_doc["flyers"]
                            if not (f.get("status") == "gone" and f.get("lastSeenAt", "") < (now() - dt.timedelta(days=60)).isoformat())]

    Path(a.out).write_text(json.dumps(todo, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if not a.dry_run:
        flyers_doc["checkedAt"] = stamp
        (DATA / "flyers.json").write_text(json.dumps(flyers_doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    for e in errors:
        print("取得失敗:", e, file=sys.stderr)
    print(f"取得元 {tried} / 取り込みが要るチラシ {len(todo)} / 失敗 {len(errors)}")
    if tried and len(errors) >= tried:
        return 1
    return 3 if todo else 0


if __name__ == "__main__":
    sys.exit(main())
