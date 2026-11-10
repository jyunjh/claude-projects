#!/usr/bin/env python3
"""
取得のまとめ役 — update.py と backtest.py が同じ入口からデータを取る
----------------------------------------------------
すべて無料・APIキー不要の公開データ。1つ落ちても他は続ける（errors に理由を残す）。
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "sources"))

import fred  # noqa: E402
from signals import FRED_NY, FRED_PHILLY, PMI_COMPONENTS  # noqa: E402

FRED_SERIES = {
    "T10Y3M": "10年債利回り − 3ヶ月債利回り（日次）",
    "CPIAUCNS": "消費者物価指数 総合・季節調整なし（月次）",
    "LNS12500000": "フルタイム就業者数（月次・家計調査）",
    "LNS12600000": "パートタイム就業者数（月次・家計調査）",
    "USGOVT": "政府部門の雇用者数（月次・事業所調査）",
    "PAYEMS": "非農業部門雇用者数（月次・事業所調査）",
    "CCSA": "継続受給者数 季節調整済み（週次）",
    "FEDFUNDS": "FF金利 実効レート（月次）",
    "DFEDTAR": "FF金利 誘導目標（日次・2008年まで）",
    "DFEDTARU": "FF金利 誘導目標の上限（日次・2008年から）",
    "DTWEXBGS": "名目ブロードドル指数（日次・FRB H.10）",
    "USREC": "NBER景気後退期フラグ（月次）",
}
for _code, _label in PMI_COMPONENTS:
    FRED_SERIES[FRED_PHILLY.format(_code)] = f"フィラデルフィア連銀 製造業調査 {_label}"
    FRED_SERIES[FRED_NY.format(_code)] = f"NY連銀 Empire State製造業調査 {_label}"


def load_all(use_cache=True, cache_dir=None, max_age_hours=6, log=print):
    """全データを取得する。戻り値: (raw, errors)

    raw["fred"][系列ID] / raw["bis"] / raw["nahb"] / raw["multpl"]
    取れなかったものは raw に入らず、errors に {"source","message"} が残る。
    """
    raw, errors = {"fred": {}}, []

    def step(name, fn):
        try:
            out = fn()
            src = out.get("source", {})
            if src.get("stale"):
                errors.append({"source": name, "message": "取得に失敗したため、手元のキャッシュを表示しています"})
            log(f"  ✓ {name}" + ("（キャッシュ）" if src.get("cached") else ""))
            return out
        except Exception as e:  # noqa: BLE001 — 1つ落ちても全体は落とさない
            errors.append({"source": name, "message": str(e)})
            log(f"  ✗ {name}: {e}")
            return None

    for sid in FRED_SERIES:
        out = step(f"FRED {sid}", lambda sid=sid: fred.fetch_series(
            sid, cache_dir=cache_dir, use_cache=use_cache, max_age_hours=max_age_hours))
        if out:
            raw["fred"][sid] = out
            if not out["source"].get("cached"):
                time.sleep(0.4)      # 連続アクセスの間隔をあける

    for name in ("bis", "nahb", "multpl"):
        def run(name=name):
            mod = __import__(name)
            fn = {"bis": "fetch_policy_rates", "nahb": "fetch_hmi", "multpl": "fetch_pe"}[name]
            return getattr(mod, fn)(cache_dir=cache_dir, use_cache=use_cache, max_age_hours=12)
        out = step(name, run)
        if out:
            raw[name] = out
    return raw, errors


def regional_components(raw):
    """raw から {"NO": {月: D}, ...} をフィラデルフィア・NY それぞれについて取り出す。"""
    from seriesutil import monthly
    ph = {c: monthly(raw["fred"][FRED_PHILLY.format(c)]["observations"]) for c, _ in PMI_COMPONENTS}
    ny = {c: monthly(raw["fred"][FRED_NY.format(c)]["observations"]) for c, _ in PMI_COMPONENTS}
    return ph, ny
