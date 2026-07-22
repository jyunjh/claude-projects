#!/usr/bin/env python3
"""
区データ検証スクリプト（§8 手順4 の全件検証をローカルで自動化）
================================================================
data/centers/<wardId>.json を読み、SPEC-23ku §4.3 / §4.4 / §8 の検証を機械的に実行する。
これまで Sonnet が1館ずつ curl して確かめていた決定的な作業を丸ごと肩代わりし、
モデルには「判断が要る部分」だけを残すためのツール。

検証項目:
  静的（ネット不要 / --offline）
    - JSON valid・必須フィールド欠落
    - id が "<wardId>-<slug>" 形式・重複なし
    - color が §4.4 パレットの巡回順どおり
    - pdfUrl の重複（別館に同じ予定表を貼っていないか）
    - 座標の外れ値（区内の他館の中央値から離れすぎ = 住所の取り違え疑い）
  動的（ネット必要）
    - officialUrl / pdfUrl が HTTP 200
    - ingest.fetch_source() が成功し、どの形式（PDF/画像/テキスト）で取れたか
    - fetch_source が pdfUrl と違うPDFに解決した場合は used_url を表示
      （§8手順2どおり pdfUrl に一覧ページを置いた館では正常な挙動。解決先ファイル名が
        当月のものか・中高生向けおたよりを拾っていないかは人／モデルが目視で確認する）

使い方:
  python3 ingest/verify_ward.py --ward suginami            # 全検証
  python3 ingest/verify_ward.py --ward suginami --offline  # 静的検証のみ（高速）
終了コード: 0 = 全項目パス / 1 = 要修正あり
"""

import argparse
import json
import math
import re
import statistics
import sys
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import CENTERS_DIR, fetch_source, http_get  # noqa: E402

# §4.4 カラーパレット（巡回・確定）
PALETTE = [
    "#4f86c6", "#e8804f", "#5cb85c", "#a06cd5", "#d6477f", "#2bb3a3",
    "#e0a32e", "#7e6cd6", "#d2691e", "#3b9e8f", "#c0567a", "#5b8def",
    "#6aa84f", "#b5892f", "#8e5ad6", "#c95555",
]
REQUIRED = ["id", "name", "region", "address", "lat", "lng",
            "officialUrl", "sourcePage", "pdfUrl", "color"]

# 座標外れ値のしきい値（km）。23区の1区はおおむね半径5km以内に収まる。
OUTLIER_KM = 6.0


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def check_static(ward, centers):
    """ネット不要の検証。問題文字列のリストを返す。"""
    issues = []

    for i, c in enumerate(centers):
        missing = [k for k in REQUIRED if k not in c or c[k] in (None, "")]
        if missing:
            issues.append(f"[{i}] {c.get('name', '?')}: 必須フィールド欠落 {missing}")

    ids = [c.get("id", "") for c in centers]
    for cid in ids:
        if not cid.startswith(f"{ward}-"):
            issues.append(f"id 形式違反（'{ward}-' 始まりでない）: {cid}")
    dup_ids = {x for x in ids if ids.count(x) > 1}
    if dup_ids:
        issues.append(f"id 重複: {sorted(dup_ids)}")

    for i, c in enumerate(centers):
        want = PALETTE[i % len(PALETTE)]
        if c.get("color") != want:
            issues.append(f"[{i}] {c.get('name', '?')}: color 巡回違反 "
                          f"(期待 {want} / 実際 {c.get('color')})")

    pdfs = [c.get("pdfUrl", "") for c in centers]
    dup_pdf = {x for x in pdfs if x and pdfs.count(x) > 1}
    for d in sorted(dup_pdf):
        names = [c["name"] for c in centers if c.get("pdfUrl") == d]
        issues.append(f"pdfUrl 重複: {d} → {names}")

    # 座標外れ値: 区内の中央値から OUTLIER_KM 以上離れている館を疑う
    coords = [(c.get("lat"), c.get("lng")) for c in centers
              if isinstance(c.get("lat"), (int, float))
              and isinstance(c.get("lng"), (int, float))]
    if len(coords) >= 3:
        mlat = statistics.median(x for x, _ in coords)
        mlng = statistics.median(y for _, y in coords)
        for c in centers:
            if not isinstance(c.get("lat"), (int, float)):
                continue
            d = haversine_km(c["lat"], c["lng"], mlat, mlng)
            if d > OUTLIER_KM:
                issues.append(f"座標が区の中心から {d:.1f}km: {c['name']} "
                              f"({c['lat']}, {c['lng']}) — 住所要確認")
    return issues


def probe_url(url):
    """URL を取得して 'HTTP 200' 相当か判定。(ok, 表示用文字列)"""
    try:
        http_get(url)
        return True, "200"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 — ネットワーク系は種類を問わず失敗として扱う
        return False, type(e).__name__


# 予定表本文なら必ず現れる日付らしい表記。これが少ないテキストは
# 「おたより一覧のリンク集」であって予定表そのものではない疑いが強い。
DATE_PAT = re.compile(r"\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}/\d{1,2}|\d{1,2}\s*日\s*[（(]")
MIN_DATES = 3


def looks_like_schedule(text):
    """テキストが予定表の本文らしいか（日付表記が複数あるか）。"""
    return len(DATE_PAT.findall(text)) >= MIN_DATES


def check_one(c):
    """1館ぶんのネット検証。行データを返す。"""
    row = {"name": c.get("name", "?"), "id": c.get("id", "?"), "thin": ""}
    ok_o, row["official"] = probe_url(c.get("officialUrl", ""))
    ok_p, row["pdf"] = probe_url(c.get("pdfUrl", ""))
    try:
        mime, data, used = fetch_source(c.get("pdfUrl", ""))
        kind = {"application/pdf": "PDF", "text/plain": "TEXT"}.get(mime, mime)
        row["fetch"] = f"{kind} {len(data) // 1024}KB"
        row["used"] = used if used != c.get("pdfUrl") else ""
        # HTMLテキストとして取れた場合のみ中身を見る。PDF/画像は Gemini が読むので対象外。
        if mime == "text/plain":
            text = data.decode("utf-8", "ignore")
            if not looks_like_schedule(text):
                row["thin"] = f"日付表記{len(DATE_PAT.findall(text))}件・{len(text)}文字"
        ok_f = True
    except Exception as e:  # noqa: BLE001
        row["fetch"] = f"NG: {e}"
        row["used"] = ""
        ok_f = False
    row["ok"] = ok_o and ok_p and ok_f
    return row


def main():
    ap = argparse.ArgumentParser(description="区データ（centers/<ward>.json）の§8検証")
    ap.add_argument("--ward", required=True, help="wardId（例: suginami）")
    ap.add_argument("--offline", action="store_true", help="静的検証のみ")
    ap.add_argument("--workers", type=int, default=4,
                    help="並列数（区公式サイトに配慮し既定4）")
    args = ap.parse_args()

    path = CENTERS_DIR / f"{args.ward}.json"
    if not path.exists():
        print(f"NG: {path} がありません")
        return 1
    try:
        centers = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"NG: JSON parse error: {e}")
        return 1

    print(f"# {args.ward}: {len(centers)}館\n")

    issues = check_static(args.ward, centers)
    print("## 静的検証")
    if issues:
        for s in issues:
            print(f"  NG  {s}")
    else:
        print("  OK  スキーマ・id・color巡回・pdfUrl重複・座標 すべて問題なし")

    if args.offline:
        print(f"\n{'FAIL' if issues else 'PASS'}（静的のみ）")
        return 1 if issues else 0

    print("\n## ネット検証")
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        rows = list(ex.map(check_one, centers))

    w = max(len(r["name"]) for r in rows) + 1
    print(f"  {'館名'.ljust(w)} {'official':9} {'pdf':9} fetch_source")
    for r in rows:
        mark = "  " if r["ok"] else "NG"
        print(f"{mark}{r['name'].ljust(w)} {r['official']:9} {r['pdf']:9} {r['fetch']}")
        if r["used"]:
            print(f"    └ 自動解決: {r['used']}")
        if r["thin"]:
            print(f"    └ 中身が予定表でない疑い（{r['thin']}）")

    ng = [r for r in rows if not r["ok"]]
    resolved = [r for r in rows if r["used"]]
    thin = [r for r in rows if r["thin"]]
    print(f"\n## サマリ")
    print(f"  館数 {len(rows)} / 検証NG {len(ng)} / 静的NG {len(issues)}")
    if resolved:
        print(f"  一覧ページ→PDF の自動解決 {len(resolved)}件"
              f"（上記 └ のファイル名が当月・乳幼児/小学生向けかを目視確認）")
    if thin:
        print(f"  中身が予定表でない疑い {len(thin)}件"
              f" — HTTP 200 でも日付を含まないリンク集だけが取れている状態。"
              f" §8.3『予定表が公開Webで取得できない施設は除外』の判断が要る。")
    print(f"\n{'FAIL' if (ng or issues) else 'PASS'}"
          + ("（ただし要判断あり・上記参照）" if thin else ""))
    return 1 if (ng or issues) else 0


if __name__ == "__main__":
    sys.exit(main())
