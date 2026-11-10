#!/usr/bin/env python3
"""
multpl.com — S&P 500 実績PER（月次表）
----------------------------------------------------
https://www.multpl.com/s-p-500-pe-ratio/table/by-month

HTML の表をスクレイピングする。直近数ヶ月は推定値（<abbr title="Estimate">†</abbr>
付き）なので est フラグで区別する。UA は Mozilla/5.0 系を要求される。
"""
import html
import re
import sys
from datetime import datetime

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import http_get  # noqa: E402

SOURCE_NAME = "multpl.com — S&P 500 PE Ratio by Month"
URL = "https://www.multpl.com/s-p-500-pe-ratio/table/by-month"
PAGE = "https://www.multpl.com/s-p-500-pe-ratio"
UA_MULTPL = "Mozilla/5.0 (compatible; macro-monitor/1.0)"

TR_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
TD_RE = re.compile(r"<td\b[^>]*>(.*?)</td>", re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")


def parse_rows(text):
    """表の全行 → [{"date": datetime, "v": float, "est": bool}, ...]（表の順＝新しい順）"""
    rows = []
    for tr in TR_RE.findall(text):
        tds = TD_RE.findall(tr)
        if len(tds) < 2:
            continue
        try:
            date = datetime.strptime(TAG_RE.sub("", tds[0]).strip(), "%b %d, %Y")
        except ValueError:
            continue
        m = re.search(r"-?\d+(?:\.\d+)?", html.unescape(TAG_RE.sub("", tds[1])).replace(",", ""))
        if not m:
            continue
        rows.append({"date": date, "v": float(m.group()), "est": "Estimate" in tr})
    return rows


def fetch_pe(cache_dir=None, use_cache=True, max_age_hours=12):
    """S&P 500 の実績PERを取得する。

    戻り値: {"monthly": [{"d":"1871-01","v":11.10,"est":False}, ...],  # 月初(1日)の行だけ・古い順
             "latest": {"d":"2026-11-09","v":25.75,"est":True},        # 表の一番上の行
             "source": {...}}
    """
    body, meta = http_get(URL, "multpl_pe.html", cache_dir=cache_dir, use_cache=use_cache,
                          max_age_hours=max_age_hours, ua=UA_MULTPL)
    rows = parse_rows(body.decode("utf-8", "replace"))
    if not rows:
        raise RuntimeError(f"multpl の表から行を取れませんでした: {URL}")
    monthly = [{"d": r["date"].strftime("%Y-%m"), "v": r["v"], "est": r["est"]}
               for r in rows if r["date"].day == 1]
    monthly.sort(key=lambda o: o["d"])
    if len(monthly) < 1500:
        raise RuntimeError(f"multpl の月次件数が少なすぎます（{len(monthly)}件）。表の形が変わった可能性")
    if any(o["v"] <= 0 for o in monthly):
        raise RuntimeError("multpl の PER に 0 以下の値があります")
    top = rows[0]
    return {
        "monthly": monthly,
        "latest": {"d": top["date"].strftime("%Y-%m-%d"), "v": top["v"], "est": top["est"]},
        "source": {"name": SOURCE_NAME, "url": URL, "page": PAGE,
                   "retrievedAt": meta.get("retrievedAt"), "cached": meta.get("cached"),
                   "stale": meta.get("stale", False)},
    }


if __name__ == "__main__":
    p = fetch_pe()
    m = p["monthly"]
    print(f"PE: {len(m)} monthly obs, first {m[0]['d']} = {m[0]['v']}, latest row {p['latest']}")
    print(f"last monthly: {m[-1]}")
    print(next((o for o in m if o["d"] == "2026-06"), None))
