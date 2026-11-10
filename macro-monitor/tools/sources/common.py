#!/usr/bin/env python3
"""
共通ユーティリティ — HTTP取得とキャッシュ
----------------------------------------------------
一次情報の取得はすべてここを通す。方針:

- 標準ライブラリだけで動かす（pip install を一切要求しない）
- 取ってきた生データは cache/ にそのまま残す。あとから「本当にその値だったか」を
  人間が確認できるようにするため
- キャッシュが新しければネットに出ない。更新ボタンを連打してもAPIを叩かない
  （特に BLS は未登録だと 1日25リクエストしか許されていない）
"""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.path.join(BASE, "cache")

# 相手サーバーに誰が来たか分かるようにする。無名のUAは弾く政府サイトがある。
# ただし FRED は見慣れないUAを黙って切断する（実測）ので、そこだけ ua=None を
# 渡して urllib 既定の "Python-urllib/x.y" のまま出す。ブラウザの偽装はしない。
UA = "macro-monitor/1.0 (personal research dashboard; python-urllib)"


def now_iso():
    """ローカルタイムゾーン付きの ISO8601 文字列。"""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def http_get(url, cache_name, cache_dir=None, max_age_hours=6,
             use_cache=True, data=None, headers=None, timeout=60, ua=UA):
    """URLを取得して bytes を返す。(body, meta) のタプル。

    meta = {"cached": bool, "retrievedAt": ISO8601, "url": url}

    max_age_hours 以内のキャッシュがあればネットに出ない。
    ネットに出て失敗した場合、古いキャッシュがあればそれを返す（meta["stale"]=True）。
    キャッシュも無ければ例外を投げる — 黙って空データを返さない。
    """
    cache_dir = cache_dir or CACHE_DIR
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, cache_name)
    meta_path = path + ".meta.json"

    def read_cache():
        with open(path, "rb") as f:
            body = f.read()
        try:
            with open(meta_path, encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            m = {"retrievedAt": None}
        return body, m

    if use_cache and os.path.exists(path):
        age_h = (time.time() - os.path.getmtime(path)) / 3600.0
        if age_h < max_age_hours:
            body, m = read_cache()
            return body, {"cached": True, "retrievedAt": m.get("retrievedAt"),
                          "url": url, "ageHours": round(age_h, 2)}

    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    if ua:
        req.add_header("User-Agent", ua)
    for k, v in (headers or {}).items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        if os.path.exists(path):
            # 取得に失敗した。古い値でも「いつの値か」を明示して返す方が、
            # 黙って落ちるより役に立つ
            body, m = read_cache()
            return body, {"cached": True, "stale": True, "error": str(e),
                          "retrievedAt": m.get("retrievedAt"), "url": url}
        raise RuntimeError(f"取得失敗（キャッシュも無し）: {url} — {e}") from e

    retrieved = now_iso()
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, path)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({"url": url, "retrievedAt": retrieved, "bytes": len(body)}, f)
    return body, {"cached": False, "retrievedAt": retrieved, "url": url}


def parse_csv_rows(text):
    """先頭が空でない行だけを返す軽量CSVスプリッタ（引用符なしのCSV専用）。"""
    import csv
    import io
    return [r for r in csv.reader(io.StringIO(text)) if r and any(c.strip() for c in r)]
