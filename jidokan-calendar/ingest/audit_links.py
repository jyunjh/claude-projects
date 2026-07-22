#!/usr/bin/env python3
"""
予定表リンクの棚卸しスクリプト（月替わりで古くなる pdfUrl を洗い出す）
================================================================
`pdfUrl` にPDF/画像の直リンクを置いた館は、月が替わると古い号を指したままになる。
一覧ページ方式（自動解決）の館は毎月追従するので対象外。

このスクリプトは直リンクの館について次を調べ、対応が要るものだけを報告する:
  1. 直リンクがまだ生きているか（404 = 差し替え済みで確実に古い）
  2. ファイル名やURLから月が読めるか。読めて当月でなければ「旧月」
  3. `sourcePage` を fetch_source に通すと今は何に解決するか
     → 記録済みの pdfUrl と違えば、それが差し替え候補になる

ファイル名がハッシュの館は月が読めないので「要確認」に落とし、3の情報で人が判断する。

使い方:
  python3 ingest/audit_links.py                 # 全区
  python3 ingest/audit_links.py --ward setagaya # 区を指定
  python3 ingest/audit_links.py --month 2026-08 # 基準月を指定（既定は今月）
終了コード: 0 = 対応不要 / 1 = 対応が要る館がある
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import CENTERS_DIR, fetch_source, http_get  # noqa: E402

# 直リンクとみなす拡張子（これ以外＝一覧ページ方式は毎月自動追従するので対象外）
DIRECT_EXT = (".pdf", ".jpg", ".jpeg", ".png")


def is_direct(url):
    return urllib.parse.urlsplit(url).path.lower().endswith(DIRECT_EXT)


def months_in(url):
    """URLから「この号が何月のものか」の候補を {(年, 月)} で返す。

    児童館サイトのファイル名は表記が多様なので、確度の高いパターンだけを拾う。
    ハッシュ名など読めないものは空集合を返し、呼び出し側で「要確認」にする。

    判定はファイル名だけを見る。WordPress の `wp-content/uploads/2026/06/` のような
    ディレクトリの年月は「アップロード日」であって号の月ではない（6月末に7月号を
    上げるのが普通）ため、これを号の月とみなすと誤って「旧月」と報告してしまう。"""
    s = urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1])
    # 「７月」のような全角数字を半角に揃える
    s = s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    out = set()

    # 202607 / 2026-07 / 2026_07
    for y, m in re.findall(r"(20\d{2})[._-]?(0[1-9]|1[0-2])(?![0-9])", s):
        out.add((int(y), int(m)))
    # 区切り付きの1桁月「2026.7」「2026-7」（区切り無しの 20267 は誤読するので除く）
    for y, m in re.findall(r"(20\d{2})[._-]([1-9])(?![0-9])", s):
        out.add((int(y), int(m)))
    # 令和表記 r807 / r8-07（令和8年 = 2026年）
    for r, m in re.findall(r"[rR](\d)[-_]?(0[1-9]|1[0-2])(?![0-9])", s):
        out.add((2018 + int(r), int(m)))
    # 2607 のような「年下2桁+月2桁」（2026年07月）
    for y, m in re.findall(r"(?<![0-9])(2[5-9]|3[0-9])(0[1-9]|1[0-2])(?![0-9])", s):
        out.add((2000 + int(y), int(m)))
    # 7gatu / 7gatsu / 7月 / 78gatsu（7・8月号）— 年は不明なので年は None 扱い
    for m in re.findall(r"(?<![0-9])([1-9]|1[0-2])\s*(?:gatsu|gatu|月)", s, re.I):
        out.add((None, int(m)))
    # 「7・8月号」「78gatsu」のような合併号。ただし区切りが無い2桁が 10〜12 のときは
    # 「12月」であって「1・2月」ではないので、上の単月パターンに任せて拾わない。
    for a, sep, b in re.findall(r"(?<![0-9])([1-9])([-・]?)([1-9])\s*"
                                r"(?:gatsu|gatu|月)", s, re.I):
        if not sep and int(a + b) in (10, 11, 12):
            continue
        out.add((None, int(a)))
        out.add((None, int(b)))
    return out


def covers_month(url, year, month):
    """URLが指定年月以降の号を指していそうか。読めなければ None（＝要確認）。

    翌月号の先行掲載（7月に「2026年8月.pdf」）は古くないので True 扱いにする。
    False になるのは、読み取れた月がすべて基準月より前だったときだけ。"""
    got = months_in(url)
    if not got:
        return None
    for y, m in got:
        if y is None:
            # 年が読めない場合は月だけで比較（12月→1月の巡回を考慮し前後6か月で判定）
            if (m - month) % 12 <= 6:
                return True
        elif (y, m) >= (year, month):
            return True
    return False


def probe(url, retries=2):
    """URLの生死を確かめる。通信エラーは一時的なことがあるので再試行する
    （1回の失敗で「リンク切れ」と断定すると誤報になる）。"""
    last = "?"
    for attempt in range(retries + 1):
        try:
            http_get(url)
            return "200"
        except urllib.error.HTTPError as e:
            return f"HTTP {e.code}"          # 404等はサーバの確定回答なので即返す
        except Exception as e:  # noqa: BLE001
            last = type(e).__name__
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    return last


def check(c, year, month):
    """1館ぶんの棚卸し。対応が要らなければ None を返す。"""
    row = {"name": c.get("name", "?"), "id": c.get("id", "?"),
           "pdfUrl": c.get("pdfUrl", "")}
    row["status"] = probe(row["pdfUrl"])
    row["covers"] = covers_month(row["pdfUrl"], year, month)

    # sourcePage が今どこに解決するか（差し替え候補）
    row["suggest"] = ""
    src = c.get("sourcePage", "")
    if src and src != row["pdfUrl"]:
        try:
            _, _, used = fetch_source(src)
            if used != row["pdfUrl"]:
                row["suggest"] = used
        except Exception:  # noqa: BLE001
            pass

    if row["status"] != "200":
        row["verdict"] = "リンク切れ"
    elif row["covers"] is False:
        row["verdict"] = "旧月"
    elif row["covers"] is None:
        row["verdict"] = "要確認"
    else:
        row["verdict"] = ""      # 当月を指している＝対応不要
    return row


def main():
    ap = argparse.ArgumentParser(description="予定表の直リンクが当月かを棚卸しする")
    ap.add_argument("--ward", help="wardId（省略時は全区）")
    ap.add_argument("--month", help="基準月 YYYY-MM（既定は今月）")
    ap.add_argument("--workers", type=int, default=4, help="並列数（既定4）")
    args = ap.parse_args()

    if args.month:
        year, month = (int(x) for x in args.month.split("-"))
    else:
        today = date.today()
        year, month = today.year, today.month

    paths = ([CENTERS_DIR / f"{args.ward}.json"] if args.ward
             else sorted(CENTERS_DIR.glob("*.json")))
    print(f"# 基準月: {year}年{month}月\n")

    total_direct = 0
    todo = []
    for path in paths:
        if not path.exists():
            print(f"NG: {path} がありません")
            return 1
        ward = path.stem
        centers = json.loads(path.read_text(encoding="utf-8"))
        direct = [c for c in centers if is_direct(c.get("pdfUrl", ""))]
        if not direct:
            continue
        total_direct += len(direct)

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            rows = list(ex.map(lambda c: check(c, year, month), direct))
        hits = [r for r in rows if r["verdict"]]
        print(f"## {ward}: 直リンク {len(direct)}/{len(centers)}館"
              f" — 要対応 {len(hits)}件")
        for r in hits:
            print(f"  [{r['verdict']}] {r['name']}（{r['id']}）")
            print(f"      現在: {urllib.parse.unquote(r['pdfUrl'])}")
            if r["status"] != "200":
                print(f"      状態: {r['status']}")
            if r["suggest"]:
                print(f"      候補: {urllib.parse.unquote(r['suggest'])}")
        if not hits:
            print("  すべて当月を指しています")
        print()
        todo.extend(hits)

    print("## サマリ")
    print(f"  直リンク総数 {total_direct}館 / 要対応 {len(todo)}件")
    if todo:
        by = {}
        for r in todo:
            by[r["verdict"]] = by.get(r["verdict"], 0) + 1
        print("  内訳: " + " / ".join(f"{k} {v}件" for k, v in sorted(by.items())))
        print("\n  『候補』が出ている館は sourcePage の自動解決先です。"
              "\n  それが当月なら pdfUrl をその一覧ページ方式に戻せる可能性があります。")
    return 1 if todo else 0


if __name__ == "__main__":
    sys.exit(main())
