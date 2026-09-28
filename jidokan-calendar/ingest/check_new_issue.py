#!/usr/bin/env python3
"""
新しい月号の掲載チェック（LLM不使用・定期実行の入口）
================================================================
区の各館について、予定表ページの「最新号」が何月号かを調べ、まだ取り込んでいない
新しい号（＝当月以降、かつ events/<ward>.json に入っている月より新しい）が
出ている館だけを報告する。何も出ていなければそこで終われるので、毎日回しても安い。

最新号の判定は ingest.fetch_source() と同じ「ページ内で最初の .pdf リンク」を対象に、
リンク文言（例「築地児童館10月号のおしらせ」「令和8年10月あかちゃん天国…」）から
月を読む。文言で読めなければファイル名から読む（audit_links.months_in）。

使い方:
  python3 ingest/check_new_issue.py --ward chuo
  python3 ingest/check_new_issue.py --ward chuo --out new.json   # 結果をJSONで保存
終了コード: 0 = 新しい号なし / 3 = 新しい号あり / 1 = エラー
"""

import argparse
import html as htmllib
import json
import re
import sys
import urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import CENTERS_DIR, EVENTS_DIR, http_get, load_existing  # noqa: E402
from audit_links import is_direct, months_in  # noqa: E402

REIWA_BASE = 2018  # 令和N年 = 2018 + N 年


def month_from_text(text):
    """リンク文言から (年 or None, 月) を読む。読めなければ None。"""
    t = text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    m = re.search(r"令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月", t)
    if m:
        return REIWA_BASE + int(m.group(1)), int(m.group(2))
    m = re.search(r"(20\d{2})\s*年\s*(\d{1,2})\s*月", t)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(?<!\d)(\d{1,2})\s*月", t)
    if m and 1 <= int(m.group(1)) <= 12:
        return None, int(m.group(1))
    return None


def fill_year(ym, today):
    """年が無い月を、今日に最も近い年で補う（12月に「1月号」なら翌年）。"""
    y, m = ym
    if y is not None:
        return y, m
    y = today.year
    if m - today.month <= -6:
        y += 1
    elif m - today.month >= 6:
        y -= 1
    return y, m


def latest_issue(url):
    """(pdf_url, (年, 月) or None, リンク文言) を返す。"""
    if is_direct(url):
        got = months_in(url)
        ym = max(((y, m) for y, m in got), key=lambda x: (x[0] or 0, x[1]), default=None)
        return url, ym, ""
    page = http_get(url)[0].decode("utf-8", "ignore")
    m = re.search(r'href=["\']([^"\']+?\.pdf)["\']', page, flags=re.I)
    if not m:
        return None, None, ""
    href = m.group(1)
    pdf_url = urllib.parse.urljoin(url, href)
    a = re.search(r'<a[^>]+href=["\']' + re.escape(href) + r'["\'][^>]*>(.*?)</a>',
                  page, flags=re.S | re.I)
    label = " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", a.group(1))).split()) if a else ""
    ym = month_from_text(label)
    if ym is None:
        got = months_in(pdf_url)
        ym = max(((y, m) for y, m in got), key=lambda x: (x[0] or 0, x[1]), default=None)
    return pdf_url, ym, label


def ingested_months(ward):
    """{centerId: 取り込み済みの最新 (年, 月)}"""
    out = {}
    for e in load_existing(EVENTS_DIR / f"{ward}.json"):
        d = e.get("date") or ""
        if re.match(r"\d{4}-\d{2}", d):
            ym = (int(d[:4]), int(d[5:7]))
            if ym > out.get(e["centerId"], (0, 0)):
                out[e["centerId"]] = ym
    return out


def main():
    ap = argparse.ArgumentParser(description="新しい月号が出た館を報告する")
    ap.add_argument("--ward", required=True)
    ap.add_argument("--out", help="新しい号の一覧をJSONで保存するパス")
    args = ap.parse_args()

    today = date.today()
    cur = (today.year, today.month)
    centers = json.loads((CENTERS_DIR / f"{args.ward}.json").read_text(encoding="utf-8"))
    done = ingested_months(args.ward)

    new, errors = [], []
    for c in centers:
        try:
            pdf_url, ym, label = latest_issue(c["pdfUrl"])
        except Exception as e:  # noqa: BLE001
            errors.append(c["id"])
            print(f"  NG  {c['name']}: {e}")
            continue
        if not pdf_url or ym is None:
            print(f"  ??  {c['name']}: 最新号の月を判定できません（{label or pdf_url}）")
            continue
        ym = fill_year(ym, today)
        have = done.get(c["id"])
        # 月末（残り1週間未満）に当月号を取り込んでも使い道が無いので対象外にする
        too_late = ym == cur and (date(today.year + (today.month == 12), today.month % 12 + 1, 1)
                                  - today).days < 7
        is_new = ym >= cur and not too_late and (have is None or ym > have)
        mark = "NEW" if is_new else "   "
        print(f"  {mark} {c['name']}: 最新 {ym[0]}年{ym[1]}月号"
              f"（取込済 {'%d年%d月' % have if have else 'なし'}）")
        if is_new:
            new.append({"centerId": c["id"], "name": c["name"], "pdfUrl": pdf_url,
                        "year": ym[0], "month": ym[1], "label": label})

    print(f"\n新しい号: {len(new)}館 / エラー: {len(errors)}館")
    if args.out:
        Path(args.out).write_text(json.dumps(new, ensure_ascii=False, indent=2), encoding="utf-8")
    if errors and not new:
        return 1
    return 3 if new else 0


if __name__ == "__main__":
    sys.exit(main())
