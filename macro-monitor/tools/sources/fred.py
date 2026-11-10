#!/usr/bin/env python3
"""
FRED（セントルイス連銀）— APIキー不要の CSV ダウンロード口
----------------------------------------------------
https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>

FRED は発行体そのものではなく連銀による再配布だが、キー不要・無料で全期間が
1回で取れる。macro-monitor は毎回全期間を取り直すので、状態を持たずに済む。
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import http_get, parse_csv_rows  # noqa: E402

SOURCE_NAME = "Federal Reserve Bank of St. Louis (FRED)"


def series_url(series_id):
    return f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"


def fetch_series(series_id, cache_dir=None, use_cache=True, max_age_hours=6):
    """FREDの1系列を取得する。

    戻り値: {"id":..., "observations":[{"d":"2026-09-17","v":0.82}, ...],  # 古い順・欠測(.)は除外
             "latest": {"d":..., "v":...}, "source": {...}}
    """
    url = series_url(series_id)
    # ua=None: FRED は見慣れないUAを黙って切断する（実測）。urllib既定のUAのまま出す
    body, meta = http_get(url, f"fred_{series_id}.csv", cache_dir=cache_dir,
                          use_cache=use_cache, max_age_hours=max_age_hours, ua=None)
    rows = parse_csv_rows(body.decode("utf-8-sig", "replace"))
    if len(rows) < 2:
        raise RuntimeError(f"FRED系列 {series_id} が空です: {url}")
    obs = []
    for d, *rest in rows[1:]:
        raw = (rest[0] if rest else "").strip()
        if raw in ("", "."):   # FRED の欠測は "."。0 として扱わない
            continue
        try:
            obs.append({"d": d.strip(), "v": float(raw)})
        except ValueError:
            continue
    if not obs:
        raise RuntimeError(f"FRED系列 {series_id} に有効な観測値がありません")
    obs.sort(key=lambda o: o["d"])
    return {
        "id": series_id,
        "observations": obs,
        "latest": obs[-1],
        "source": {"name": f"{SOURCE_NAME} — {series_id}", "url": url,
                   "page": f"https://fred.stlouisfed.org/series/{series_id}",
                   "retrievedAt": meta.get("retrievedAt"), "cached": meta.get("cached"),
                   "stale": meta.get("stale", False)},
    }


if __name__ == "__main__":
    for sid in sys.argv[1:] or ("T10Y3M", "CCSA"):
        s = fetch_series(sid)
        print(f"{sid}: {len(s['observations'])} obs, latest {s['latest']['d']} = {s['latest']['v']}")
