#!/usr/bin/env python3
"""
BIS（国際決済銀行）— 中央銀行政策金利（WS_CBPOL）
----------------------------------------------------
https://data.bis.org/topics/CBPOL

BIS 統計API(SDMX)の CSV。月次・月末値・全地域（約1MB）を1回で取る。
REF_AREA は2文字コード（US, XM=ユーロ圏, JP ...）。
OBS_VALUE が空の行は欠測なので捨てる（0として扱わない）。
"""
import csv
import io
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import http_get  # noqa: E402

SOURCE_NAME = "BIS — Central bank policy rates (WS_CBPOL)"
URL = ("https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M."
       "?format=csv&startPeriod=1985-01")
PAGE = "https://data.bis.org/topics/CBPOL"


def fetch_policy_rates(cache_dir=None, use_cache=True, max_age_hours=12):
    """全地域の政策金利を取得する。

    戻り値: {"rates": {"US": {"1985-01": 8.25, ...}, ...},
             "titles": {"US": "Central bank policy rates - United States - ..."},
             "source": {...}}
    """
    body, meta = http_get(URL, "bis_cbpol.csv", cache_dir=cache_dir,
                          use_cache=use_cache, max_age_hours=max_age_hours)
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig", "replace")))
    rates, titles = {}, {}
    for row in reader:
        area = (row.get("REF_AREA") or "").strip()
        period = (row.get("TIME_PERIOD") or "").strip()
        raw = (row.get("OBS_VALUE") or "").strip()
        if not area or not period or raw == "":
            continue
        try:
            val = float(raw)
        except ValueError:
            continue
        rates.setdefault(area, {})[period] = val
        if area not in titles and row.get("TITLE"):
            titles[area] = row["TITLE"].strip()
    if not rates:
        raise RuntimeError(f"BIS政策金利CSVに有効な観測値がありません: {URL}")
    return {
        "rates": rates,
        "titles": titles,
        "source": {"name": SOURCE_NAME, "url": URL, "page": PAGE,
                   "retrievedAt": meta.get("retrievedAt"), "cached": meta.get("cached"),
                   "stale": meta.get("stale", False)},
    }


if __name__ == "__main__":
    r = fetch_policy_rates()
    print(f"{len(r['rates'])} areas")
    for a in sys.argv[1:] or ("US", "XM", "JP"):
        s = r["rates"].get(a)
        if s:
            last = max(s)
            print(f"{a}: {len(s)} obs, latest {last} = {s[last]}")
