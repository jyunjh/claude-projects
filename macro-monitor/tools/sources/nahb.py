#!/usr/bin/env python3
"""
NAHB/Wells Fargo 住宅市場指数（HMI）— Table 2 (History) の .xls
----------------------------------------------------
xls のファイル名は毎月変わるので、まずページを取得して href を探す。
このサイトは UA に Mozilla/5.0 を含めないと弾く（実測）。
xls は1シート。3行目が ['', 'Jan', ..., 'Dec']、その下が年ごとの行
（未発表の月は空文字）。読むために xlrd が必要（関数内で import）。
"""
import html
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import http_get  # noqa: E402

SOURCE_NAME = "NAHB/Wells Fargo Housing Market Index — Table 2 (History)"
PAGE = "https://www.nahb.org/news-and-economics/housing-economics/indices/housing-market-index"
ORIGIN = "https://www.nahb.org"
UA_NAHB = "Mozilla/5.0 (compatible; macro-monitor/1.0)"
HREF_RE = re.compile(r'href="([^"]*t2-national-hmi-history[^"]*\.xls[^"]*)"', re.I)


def find_xls_url(page_html):
    m = HREF_RE.search(page_html)
    if not m:
        raise RuntimeError(f"NAHBページに t2-national-hmi-history の xls リンクが見つかりません: {PAGE}")
    href = html.unescape(m.group(1))
    if href.startswith("http"):
        return href
    if href.startswith("//"):
        return "https:" + href
    return ORIGIN + (href if href.startswith("/") else "/" + href)


def fetch_hmi(cache_dir=None, use_cache=True, max_age_hours=12):
    """HMI の月次履歴を取得する。

    戻り値: {"observations": [{"d":"1985-01","v":50.0}, ...],  # 古い順
             "latest": {...}, "source": {...}}
    """
    try:
        import xlrd
    except ImportError as e:
        raise RuntimeError("NAHBの .xls を読むには xlrd が必要です: pip install xlrd") from e

    page, pmeta = http_get(PAGE, "nahb_page.html", cache_dir=cache_dir, use_cache=use_cache,
                           max_age_hours=max_age_hours, ua=UA_NAHB)
    url = find_xls_url(page.decode("utf-8", "replace"))
    body, meta = http_get(url, "nahb_hmi_history.xls", cache_dir=cache_dir, use_cache=use_cache,
                          max_age_hours=max_age_hours, ua=UA_NAHB)

    wb = xlrd.open_workbook(file_contents=body)
    sh = wb.sheet_by_index(0)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    hdr = [str(c).strip() for c in sh.row_values(2)] if sh.nrows > 2 else []
    if hdr[1:13] != months:
        raise RuntimeError(f"NAHB xls の見出し行が想定と違います: {hdr[:13]}")
    obs = []
    for r in range(3, sh.nrows):
        row = sh.row_values(r)
        if not row or not isinstance(row[0], float):
            continue
        year = int(row[0])
        for i in range(12):
            v = row[1 + i] if 1 + i < len(row) else ""
            if isinstance(v, float):
                obs.append({"d": f"{year:04d}-{i + 1:02d}", "v": v})
    obs.sort(key=lambda o: o["d"])
    if len(obs) < 400:
        raise RuntimeError(f"NAHB HMI の観測値が少なすぎます（{len(obs)}件）。表の形が変わった可能性")
    latest = obs[-1]
    if not 0 <= latest["v"] <= 100:
        raise RuntimeError(f"NAHB HMI の最新値が範囲外です: {latest}")
    return {
        "observations": obs,
        "latest": latest,
        "source": {"name": SOURCE_NAME, "url": url, "page": PAGE,
                   "retrievedAt": meta.get("retrievedAt"), "cached": meta.get("cached"),
                   "stale": bool(meta.get("stale") or pmeta.get("stale"))},
    }


if __name__ == "__main__":
    h = fetch_hmi()
    o = h["observations"]
    print(f"HMI: {len(o)} obs, first {o[0]['d']} = {o[0]['v']}, "
          f"latest {h['latest']['d']} = {h['latest']['v']}")
    print(h["source"]["url"])
