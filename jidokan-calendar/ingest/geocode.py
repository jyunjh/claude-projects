#!/usr/bin/env python3
"""
ジオコーディング＋color付与スクリプト（§8 手順3・4の機械作業をローカルで自動化）
================================================================
data/centers/<wardId>.json の各館の address を Nominatim で緯度経度に変換し、
lat / lng を書き戻す。§4.4 のカラーパレット巡回も同時に付与できる。

これまでモデルが1館ずつ curl + sleep 1 していた部分をそのまま置き換えるもの。
判断は入らない決定的な処理なので、精度は落ちない（むしろ取りこぼしが無くなる）。

Nominatim 利用規約への配慮:
  - User-Agent 必須（ingest.py の UA を共用）
  - 1リクエスト/秒を厳守（逐次実行・sleep 1.1）
  - 住所は「〒」「番地・号」を落として丁目レベルに正規化してから問い合わせ、
    ヒットしなければ段階的に短くして再試行する

使い方:
  python3 ingest/geocode.py --ward suginami              # lat/lng 未設定の館だけ
  python3 ingest/geocode.py --ward suginami --all        # 全館やり直し
  python3 ingest/geocode.py --ward suginami --fill-color # colorをパレット巡回で付与
  python3 ingest/geocode.py --ward suginami --dry-run    # 書き込まず結果だけ表示
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import CENTERS_DIR, UA  # noqa: E402

from verify_ward import PALETTE, check_static  # noqa: E402

NOMINATIM = "https://nominatim.openstreetmap.org/search"
SLEEP_SEC = 1.1          # 1req/秒 を確実に下回るための待機
TOKYO_BBOX = (35.5, 35.9, 139.5, 139.95)   # lat_min, lat_max, lng_min, lng_max


def address_variants(address):
    """住所を Nominatim が引きやすい形に段階的に短くした候補を返す。

    区の公開データは表記がまちまち（「赤塚6丁目38番1号」「南台五丁目15番3号」
    「小豆沢3-9-2-103」など）なので、丁目レベルに落とす経路を複数用意して
    先頭から順に試す。ハイフン表記（丁目-番-号）も丁目レベルに正規化する。"""
    a = re.sub(r"^〒?\d{3}-?\d{4}\s*", "", address).strip()
    out = [a]

    def add(s):
        s = s.strip()
        if s and s not in out:
            out.append(s)

    # 「38番1号」「15番地3」などの番地以下を落として丁目レベルへ
    add(re.sub(r"\d+番地?\d*号?.*$", "", a))

    # 「六丁目」「6丁目」までで止める（漢数字・算用数字の両方）
    m = re.match(r"^(.*?[一二三四五六七八九十百\d]+丁目)", a)
    if m:
        add(m.group(1))

    # ハイフン表記「小豆沢3-9-2-103」→「小豆沢3丁目」。
    # 「大山東町8-7」のように丁目を持たない町名（〜町/〜村）には適用しない。
    m = re.match(r"^(.*?[^\d\-])(\d+)-\d+", a)
    if m and not m.group(1).rstrip().endswith(("町", "村")):
        add(f"{m.group(1)}{m.group(2)}丁目")

    # 最後の砦: 末尾の番地表記をまるごと落として町名だけにする
    add(re.sub(r"[\d\-]+$", "", a))

    return out


def geocode(address, log=print):
    """住所→(lat, lng)。見つからなければ None。"""
    for q in address_variants(address):
        params = urllib.parse.urlencode({
            "q": q, "format": "json", "limit": 1, "countrycodes": "jp",
        })
        req = urllib.request.Request(f"{NOMINATIM}?{params}",
                                     headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                results = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            log(f"    ! 問い合わせ失敗 ({q}): {e}")
            time.sleep(SLEEP_SEC)
            continue
        time.sleep(SLEEP_SEC)
        if results:
            lat = round(float(results[0]["lat"]), 4)
            lng = round(float(results[0]["lon"]), 4)
            lo_lat, hi_lat, lo_lng, hi_lng = TOKYO_BBOX
            if not (lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng):
                log(f"    ! 東京23区の範囲外 ({lat}, {lng}) — 候補 '{q}' を棄却")
                continue
            return lat, lng, q
    return None


def main():
    ap = argparse.ArgumentParser(description="centers/<ward>.json のジオコーディング")
    ap.add_argument("--ward", required=True, help="wardId（例: suginami）")
    ap.add_argument("--all", action="store_true", help="lat/lng 済みの館も引き直す")
    ap.add_argument("--fill-color", action="store_true",
                    help="§4.4 パレット巡回で color を付与・修正する")
    ap.add_argument("--dry-run", action="store_true", help="書き込まない")
    args = ap.parse_args()

    path = CENTERS_DIR / f"{args.ward}.json"
    if not path.exists():
        print(f"NG: {path} がありません")
        return 1
    centers = json.loads(path.read_text(encoding="utf-8"))

    if args.fill_color:
        for i, c in enumerate(centers):
            c["color"] = PALETTE[i % len(PALETTE)]
        print(f"color をパレット巡回で付与: {len(centers)}件")

    targets = [c for c in centers
               if args.all or not isinstance(c.get("lat"), (int, float))]
    print(f"ジオコーディング対象: {len(targets)}/{len(centers)}館"
          f"（約{len(targets) * SLEEP_SEC:.0f}秒）\n")

    failed = []
    for i, c in enumerate(targets, 1):
        name = c.get("name", "?")
        print(f"[{i}/{len(targets)}] {name}")
        got = geocode(c.get("address", ""))
        if got:
            lat, lng, used = got
            c["lat"], c["lng"] = lat, lng
            print(f"    → {lat}, {lng}  （クエリ: {used}）")
        else:
            failed.append(name)
            print("    → NG 取得できず（住所を確認）")

    if not args.dry_run:
        path.write_text(json.dumps(centers, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print(f"\n書き込み: {path}")
    else:
        print("\n--dry-run のため書き込みなし")

    issues = check_static(args.ward, centers)
    print("\n## 静的検証（座標外れ値を含む）")
    if issues:
        for s in issues:
            print(f"  NG  {s}")
    else:
        print("  OK  問題なし")

    if failed:
        print(f"\nジオコーディング失敗 {len(failed)}件: {failed}")
    return 1 if (failed or issues) else 0


if __name__ == "__main__":
    sys.exit(main())
