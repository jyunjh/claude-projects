#!/usr/bin/env python3
"""
SUUMO 賃貸・中古マンション取り込みスクリプト（勝どき・晴海）
=============================================================
Python 標準ライブラリのみ・追加インストール不要。

やること:
  1. 賃貸「部屋ごと表示」(FR301FC005) を全ページ取得（定期借家除外 tc=0401106）
     → 全掲載広告（不動産会社名つき）が網羅的に取れる
  2. 賃貸「建物ごと表示」(FR301FC001) も取得
     → こちらは重複が整理されており「階数」が載っているので、階数の補完に使う
  3. 同一タイプの部屋（住所+築年+間取り+面積）でグルーピングし、
     会社ごとの敷金・礼金を比較できる形に整理
  4. 掲載詳細ページから「仲介手数料」を取得（キャッシュ付き・上限あり、任意）
  5. 中古マンション（購入）一覧を取得 → 購入vs賃貸の比較用
  6. data/listings.json, data/buy.json に出力

使い方:
  cd mansion-finder
  python3 ingest/scrape_suumo.py                 # 全部（詳細は既定300件まで）
  python3 ingest/scrape_suumo.py --skip-details  # 一覧のみ（速い）
  python3 ingest/scrape_suumo.py --max-details 1000
  python3 ingest/scrape_suumo.py --include-teishaku  # 定期借家も含める

注意:
  - SUUMOへのアクセスは1リクエスト毎に1秒強のウェイトを入れる（個人利用の範囲で）。
  - 詳細（仲介手数料）はキャッシュ（data/details_cache.json）に保存され、
    再実行時は未取得分だけを取りに行く。何度か実行すれば埋まっていく。
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = "https://suumo.jp"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SLEEP_SEC = 1.2
JST = timezone(timedelta(hours=9))

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# 町名コード（SUUMO oz パラメータ）。エリアを増やすときはここに追加する。
# コードは 市区コード(5桁)+連番3桁。中央区=13102。町名コードの一覧は
# https://suumo.jp/jj/chintai/common/frBukkenKensakuPanel01/searchMachi/?ar=030&bs=040&ta=13&sc=13102
AREAS = {
    "kachidoki": {"label": "勝どき", "sc": "13102", "oz": "13102003"},
    "harumi":    {"label": "晴海",   "sc": "13102", "oz": "13102034"},
}

# 「定期借家を含まない」こだわり条件コード
TC_EXCLUDE_TEISHAKU = "0401106"


def fetch(url: str, retries: int = 3) -> str:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.read().decode("utf-8", errors="replace")
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  ! retry {attempt+1}: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    return ""


def strip_tags(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def parse_money(text: str):
    """「14万円」「1億200万円」「15000円」「-」→ 円 (int) / None"""
    text = text.replace(",", "").replace("，", "").strip()
    if not text or text in ("-", "－"):
        return 0
    oku = re.search(r"([\d.]+)億", text)
    man = re.search(r"([\d.]+)万円?", text)
    if oku or man:
        return int((float(oku.group(1)) if oku else 0) * 100000000
                   + (float(man.group(1)) if man else 0) * 10000)
    m = re.search(r"(\d+)円", text)
    if m:
        return int(m.group(1))
    return None


def parse_area(text: str) -> float:
    m = re.match(r"([\d.]+)", text.strip())
    return float(m.group(1)) if m else 0.0


def list_url(action: str, oz_codes, page: int, exclude_teishaku: bool) -> str:
    params = [
        ("ar", "030"), ("bs", "040"), ("ta", "13"), ("sc", "13102"),
        ("cb", "0.0"), ("ct", "9999999"), ("mb", "0"), ("mt", "9999999"),
        ("et", "9999999"), ("cn", "9999999"),
        ("shkr1", "03"), ("shkr2", "03"), ("shkr3", "03"), ("shkr4", "03"),
        ("pc", "50"), ("page", str(page)),
    ]
    for oz in oz_codes:
        params.append(("oz", oz))
    if exclude_teishaku:
        params.append(("tc", TC_EXCLUDE_TEISHAKU))
    return f"{BASE}/jj/chintai/ichiran/{action}/?" + urllib.parse.urlencode(params)


def paginate(action: str, oz_codes, exclude_teishaku, parse_fn, id_fn, label):
    """一覧を全ページたどる。id_fn で既出判定。"""
    items, seen = [], set()
    page = 1
    while page <= 300:
        html = fetch(list_url(action, oz_codes, page, exclude_teishaku))
        page_items = parse_fn(html)
        if not page_items:
            break
        new = [x for x in page_items if id_fn(x) not in seen]
        for x in new:
            seen.add(id_fn(x))
        items.extend(new)
        hit = re.search(r'paginate_set-hit">\s*([\d,]+)', html)
        print(f"  {label} page {page}: +{len(new)} (累計 {len(items)} / 全{hit.group(1) if hit else '?'}件)")
        if not new:
            break
        page += 1
        time.sleep(SLEEP_SEC)
    return items


# ------------------------------------------------ 部屋ごと表示（全掲載・会社名つき）

def parse_room_ads_page(html: str):
    ads = []
    blocks = re.split(r'<div class="property property--[^"]*js-property[^"]*">', html)[1:]
    for b in blocks:
        name_m = re.search(
            r'property_inner-title">\s*<a href="(/chintai/bc_(\d+)/)"[^>]*>([^<]+)', b)
        col1_m = re.search(r'detailbox-property-point">(.*?)</td>', b, re.S)
        col2_m = re.search(r'detailbox-property--col2">(.*?)</td>', b, re.S)
        col3s = re.findall(r'detailbox-property--col3">(.*?)</td>', b, re.S)
        addr_m = re.search(
            r'<td class="detailbox-property-col">\s*(?:<!--[^>]*-->\s*)?(東京都[^<]*)<', b)
        agency_m = re.search(r'href="/chintai/kaisha/[^"]*"[^>]*>([^<]+)</a>', b)
        access = re.findall(r"<div>([^<]*駅[^<]*歩[^<]*)</div>", b)
        if not (name_m and col1_m):
            continue
        col1 = strip_tags(col1_m.group(1))
        rent_m = re.match(r"\s*([\d.]+万円)", col1)
        admin_m = re.search(r"管理費\s*([^\s]+)", col1)
        col2 = strip_tags(col2_m.group(1)) if col2_m else ""
        shiki_m = re.search(r"敷\s*([^\s]+)", col2)
        rei_m = re.search(r"礼\s*([^\s]+)", col2)
        layout, area, age = "", 0.0, ""
        if col3s:
            c3 = strip_tags(col3s[0]).split()
            if c3:
                layout = c3[0]
            if len(c3) > 1:
                area = parse_area(c3[1])
        if len(col3s) > 1:
            m = re.search(r"(新築|築\d+年)", strip_tags(col3s[1]))
            if m:
                age = m.group(1)
        rent = parse_money(rent_m.group(1)) if rent_m else None
        if not rent:
            continue
        ads.append({
            "bc": name_m.group(2),
            "url": BASE + name_m.group(1),
            "name": name_m.group(3).strip(),
            "address": strip_tags(addr_m.group(1)) if addr_m else "",
            "access": access[:3],
            "age": age,
            "rent": rent,
            "admin": parse_money(admin_m.group(1)) if admin_m else 0,
            "deposit": parse_money(shiki_m.group(1)) if shiki_m else 0,
            "reikin": parse_money(rei_m.group(1)) if rei_m else 0,
            "layout": layout,
            "area_m2": area,
            "agency": strip_tags(agency_m.group(1)) if agency_m else "",
        })
    return ads


# ------------------------------------------------ 建物ごと表示（階数の補完用）

def parse_building_page(html: str):
    rooms = []
    for c in html.split('<div class="cassetteitem">')[1:]:
        addr_m = re.search(r'cassetteitem_detail-col1">([^<]+)', c)
        col3_m = re.search(r'cassetteitem_detail-col3">(.*?)</li>', c, re.S)
        addr = addr_m.group(1).strip() if addr_m else ""
        age = ""
        if col3_m:
            m = re.search(r"(新築|築\d+年)", strip_tags(col3_m.group(1)))
            if m:
                age = m.group(1)
        for tb in re.findall(r"<tbody>(.*?)</tbody>", c, re.S):
            madori_m = re.search(r'cassetteitem_madori">(.*?)</span>', tb, re.S)
            menseki_m = re.search(r'cassetteitem_menseki">(.*?)</span>', tb, re.S)
            link_m = re.search(r'href="(/chintai/jnc_\d+/[^"]*)"', tb)
            floor = ""
            for td in re.findall(r"<td[^>]*>(.*?)</td>", tb, re.S):
                t = strip_tags(td)
                if re.fullmatch(r"[B\d\-−～\s]*\d+階", t):
                    floor = t
                    break
            if not link_m:
                continue
            rooms.append({
                "jnc": re.search(r"jnc_(\d+)", link_m.group(1)).group(1),
                "address": addr,
                "age": age,
                "floor": floor,
                "layout": strip_tags(madori_m.group(1)) if madori_m else "",
                "area_m2": parse_area(strip_tags(menseki_m.group(1))) if menseki_m else 0,
            })
    return rooms


# ------------------------------------------------ グルーピング

def norm_layout(s: str) -> str:
    return s.upper().replace("ＬＤＫ", "LDK").replace(" ", "")


def group_key(x):
    # 同一タイプの部屋の判定: 住所(丁目) + 築年 + 間取り + 面積
    # （部屋ごと表示に階数が無いため、階違いの同タイプは1グループにまとまる。
    #   階数は建物ごと表示から補完して floors として持つ）
    return (x["address"], x["age"], norm_layout(x["layout"]), round(x["area_m2"], 1))


def build_groups(ads, building_rooms):
    floors_by_key, jnc_by_key = {}, {}
    for r in building_rooms:
        k = group_key(r)
        if r["floor"]:
            floors_by_key.setdefault(k, set()).add(r["floor"])
        jnc_by_key.setdefault(k, r["jnc"])

    groups = {}
    for a in ads:
        groups.setdefault(group_key(a), []).append(a)

    def floor_sort(f):
        m = re.search(r"(\d+)階", f)
        return int(m.group(1)) if m else 0

    out = []
    for key, members in groups.items():
        name = Counter(m["name"] for m in members if m["name"]).most_common(1)
        name = name[0][0] if name else ""
        members.sort(key=lambda m: (m["deposit"] + m["reikin"], m["rent"]))
        rep = members[0]
        floors = sorted(floors_by_key.get(key, ()), key=floor_sort)
        out.append({
            "name": name,
            "address": rep["address"],
            "access": max((m["access"] for m in members), key=len),
            "age": rep["age"],
            "floors": floors,
            "layout": rep["layout"],
            "area_m2": rep["area_m2"],
            "min_rent": min(m["rent"] for m in members),
            "max_rent": max(m["rent"] for m in members),
            "listings": [
                {k2: m[k2] for k2 in
                 ("bc", "url", "rent", "admin", "deposit", "reikin", "agency")}
                for m in members
            ],
        })
    out.sort(key=lambda g: (g["address"], g["name"], -g["area_m2"]))
    return out


# ------------------------------------------------ 詳細ページ（仲介手数料）

def parse_detail(html: str):
    d = {}
    txt = strip_tags(html)
    m = re.search(r"仲介手数料\s*([\d.]+ヶ月|無料|不要|半月)", txt)
    if m:
        d["chukai"] = m.group(1)
    m = re.search(r"契約期間\s*([^\s]+(?:\s*\d+年[^\s]*)?)", txt)
    if m:
        d["contract"] = m.group(1)[:30]
    m = re.search(r"保証会社\s*(.{0,120}?)(?:\s*ほか諸費用|\s*備考|\s*総戸数|$)", txt)
    if m:
        d["hoshou"] = m.group(1).strip()
    return d


def fetch_details(groups, cache_path: Path, max_details: int):
    cache = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text())
    # 優先順: 掲載数が多いグループ（=会社間比較の価値が高い）→ 敷礼が安い掲載から
    targets = []
    for g in sorted(groups, key=lambda g: -len(g["listings"])):
        for l in g["listings"]:
            if "bc_" + l["bc"] not in cache:
                targets.append(l)
    fetched = 0
    for l in targets:
        if fetched >= max_details:
            break
        try:
            html = fetch(l["url"])
            cache["bc_" + l["bc"]] = parse_detail(html)
            fetched += 1
            if fetched % 20 == 0:
                print(f"  詳細 {fetched}/{min(max_details, len(targets))} 件取得済み", flush=True)
                cache_path.write_text(json.dumps(cache, ensure_ascii=False))
        except Exception as e:
            print(f"  ! 詳細取得失敗 bc_{l['bc']}: {e}", file=sys.stderr)
            cache["bc_" + l["bc"]] = {}
        time.sleep(SLEEP_SEC)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False))
    print(f"  詳細: 今回{fetched}件取得 / キャッシュ計{len(cache)}件 / 残り{max(0, len(targets)-fetched)}件")
    for g in groups:
        for l in g["listings"]:
            info = cache.get("bc_" + l["bc"])
            if info:
                l.update({k: v for k, v in info.items() if v})
    return cache


# ------------------------------------------------ 購入（中古マンション）

def buy_list_url(page: int) -> str:
    params = [
        ("ar", "030"), ("bs", "011"), ("ta", "13"), ("sc", "13102"),
        ("jspIdFlg", "patternShikugun"), ("kb", "1"), ("kt", "9999999"),
        ("mb", "0"), ("mt", "9999999"), ("cnb", "0"), ("cn", "9999999"),
        ("srch_navi", "1"), ("pc", "100"), ("pn", str(page)),
    ]
    return f"{BASE}/jj/bukken/ichiran/JJ012FC001/?" + urllib.parse.urlencode(params)


def parse_buy_page(html: str):
    out = []
    for u in html.split('class="property_unit ')[1:]:
        def dd(label):
            m = re.search(label + r"</dt>\s*<dd[^>]*>(.*?)</dd>", u, re.S)
            return strip_tags(m.group(1)) if m else ""
        name_m = re.search(
            r'class="property_unit-title[^"]*"[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)</a>', u, re.S)
        price = parse_money(dd("販売価格"))
        if not name_m or not price:
            continue
        # タイトルに価格が含まれる物件があるので除去（例「晴海３（勝どき駅） 1億200万円」）
        name = re.sub(r"\s*[\d.]*億?[\d.]*万円.*$", "", strip_tags(name_m.group(2))).strip()
        out.append({
            "url": BASE + name_m.group(1),
            "name": name,
            "price": price,
            "address": dd("所在地"),
            "access": dd("沿線・駅"),
            "area_m2": parse_area(dd("専有面積")),
            "layout": dd("間取り"),
            "built": dd("築年月"),
        })
    return out


def scrape_buy(town_names):
    all_units, seen = [], set()
    page = 1
    while page <= 50:
        html = fetch(buy_list_url(page))
        units = parse_buy_page(html)
        if not units:
            break
        new = [u for u in units if u["url"] not in seen]
        for u in new:
            seen.add(u["url"])
        all_units.extend(u for u in new if any(t in u["address"] for t in town_names))
        print(f"  buy page {page}: 対象 {len(all_units)} 件", flush=True)
        if not new:
            break
        page += 1
        time.sleep(SLEEP_SEC)
    return all_units


# ------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--areas", default="kachidoki,harumi")
    ap.add_argument("--skip-details", action="store_true")
    ap.add_argument("--max-details", type=int, default=300)
    ap.add_argument("--skip-buy", action="store_true")
    ap.add_argument("--skip-rent", action="store_true",
                    help="賃貸の取得を飛ばす（購入一覧だけ更新したいとき）")
    ap.add_argument("--include-teishaku", action="store_true",
                    help="定期借家も含める（既定は除外）")
    args = ap.parse_args()

    area_keys = [a.strip() for a in args.areas.split(",") if a.strip()]
    areas = [AREAS[k] for k in area_keys]
    oz_codes = [a["oz"] for a in areas]
    town_names = [a["label"] for a in areas]
    DATA_DIR.mkdir(exist_ok=True)

    label = "・".join(town_names)
    teishaku = not args.include_teishaku
    if args.skip_rent:
        run_buy(town_names)
        print("完了")
        return
    print(f"■ 賃貸・全掲載（部屋ごと表示）を取得: {label} (定期借家{'除外' if teishaku else '含む'})", flush=True)
    ads = paginate("FR301FC005", oz_codes, teishaku,
                   parse_room_ads_page, lambda a: a["bc"], "ads")

    print("■ 賃貸・建物ごと表示を取得（階数の補完用）", flush=True)
    building_rooms = paginate("FR301FC001", oz_codes, teishaku,
                              parse_building_page, lambda r: r["jnc"], "bldg")

    groups = build_groups(ads, building_rooms)
    print(f"  掲載 {len(ads)} 件 → 部屋タイプ {len(groups)} 件（重複整理後）", flush=True)

    if not args.skip_details:
        print(f"■ 掲載詳細（仲介手数料）を取得（上限 {args.max_details} 件）", flush=True)
        fetch_details(groups, DATA_DIR / "details_cache.json", args.max_details)

    (DATA_DIR / "listings.json").write_text(json.dumps({
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "areas": town_names,
        "exclude_teishaku": teishaku,
        "listing_count": len(ads),
        "rooms": groups,
    }, ensure_ascii=False), encoding="utf-8")
    print("  → data/listings.json", flush=True)

    if not args.skip_buy:
        run_buy(town_names)

    print("完了")


def run_buy(town_names):
    print("■ 中古マンション（購入）一覧を取得", flush=True)
    units = scrape_buy(town_names)
    (DATA_DIR / "buy.json").write_text(json.dumps({
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "areas": town_names,
        "units": units,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"  対象 {len(units)} 件 → data/buy.json", flush=True)


if __name__ == "__main__":
    main()
