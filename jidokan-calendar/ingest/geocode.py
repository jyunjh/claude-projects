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
import fcntl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import CENTERS_DIR, UA  # noqa: E402

from verify_ward import PALETTE, check_static  # noqa: E402

# 主: 国土地理院の住所検索API。日本の住所に特化し番地レベルまで解決でき、キー不要。
GSI = "https://msearch.gsi.go.jp/address-search/AddressSearch"
# 予備: GSIで引けない場合のみ使う。OSMの利用規約により 1req/秒 を厳守する。
NOMINATIM = "https://nominatim.openstreetmap.org/search"
GSI_SLEEP_SEC = 0.3      # 公的APIだが礼儀として間隔をあける
SLEEP_SEC = 1.1          # Nominatim: 1req/秒 を確実に下回るための待機
TOKYO_BBOX = (35.5, 35.9, 139.5, 139.95)   # lat_min, lat_max, lng_min, lng_max

# 複数の区を並行して整備すると geocode.py が同時に走り、合計で 1req/秒 を超えて
# Nominatim に 429 を返される。プロセス間ロックで「同時に1本だけ」を保証する。
LOCKFILE = Path(__file__).resolve().parent / ".nominatim.lock"
MAX_429_RETRY = 5


@contextmanager
def nominatim_lock(log=print):
    """Nominatim へのアクセスを1プロセスに直列化する（他が走っていれば待つ）。"""
    with open(LOCKFILE, "w") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("他のジオコーディングが実行中のため待機します（1req/秒を守るため）…")
            fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


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

    # 「神田和泉町1 ちよだパークサイドプラザ6階」のように建物名・階が続く表記は、
    # 空白区切りの末尾要素を落とした形も候補にする（Nominatimは建物名で引けない）。
    if " " in a or "　" in a:
        head = re.split(r"[ 　]", a)[0]
        add(head)
        a = head or a

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


def in_tokyo(lat, lng):
    lo_lat, hi_lat, lo_lng, hi_lng = TOKYO_BBOX
    return lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng


def geocode_gsi(address, log=print):
    """国土地理院の住所検索APIで引く。日本の住所はこちらの方が精度が高い。"""
    for q in address_variants(address):
        url = f"{GSI}?" + urllib.parse.urlencode({"q": q})
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                results = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            log(f"    ! GSI 問い合わせ失敗 ({q}): {e}")
            time.sleep(GSI_SLEEP_SEC)
            continue
        time.sleep(GSI_SLEEP_SEC)
        if results:
            lng, lat = results[0]["geometry"]["coordinates"][:2]
            lat, lng = round(float(lat), 4), round(float(lng), 4)
            if not in_tokyo(lat, lng):
                log(f"    ! 東京23区の範囲外 ({lat}, {lng}) — 候補 '{q}' を棄却")
                continue
            return lat, lng, q
    return None


def geocode(address, log=print):
    """住所→(lat, lng, 使ったクエリ)。見つからなければ None。

    まず国土地理院APIで引き、駄目なら Nominatim にフォールバックする。
    GSI を主にしているのは、日本の住所を番地レベルまで解決できることと、
    Nominatim の 1req/秒 制限に律速されないため。"""
    got = geocode_gsi(address, log=log)
    if got:
        return got
    log("    … GSIで引けず Nominatim にフォールバック")
    for q in address_variants(address):
        params = urllib.parse.urlencode({
            "q": q, "format": "json", "limit": 1, "countrycodes": "jp",
        })
        req = urllib.request.Request(f"{NOMINATIM}?{params}",
                                     headers={"User-Agent": UA})
        try:
            results = None
            for attempt in range(MAX_429_RETRY):
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        results = json.loads(resp.read().decode("utf-8"))
                    break
                except urllib.error.HTTPError as e:
                    if e.code != 429:
                        raise
                    # レート制限。指数バックオフで待ってから再試行する。
                    wait = SLEEP_SEC * (2 ** attempt) * 5
                    log(f"    ! 429（レート制限）。{wait:.0f}秒待って再試行"
                        f" [{attempt + 1}/{MAX_429_RETRY}]")
                    time.sleep(wait)
            if results is None:
                log(f"    ! 429が解消せず断念 ({q})")
                continue
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            log(f"    ! 問い合わせ失敗 ({q}): {e}")
            time.sleep(SLEEP_SEC)
            continue
        time.sleep(SLEEP_SEC)
        if results:
            lat = round(float(results[0]["lat"]), 4)
            lng = round(float(results[0]["lon"]), 4)
            if not in_tokyo(lat, lng):
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
    # 他の区の geocode.py が走っていれば待つ（合計で1req/秒を超えないため）
    with nominatim_lock():
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
