#!/usr/bin/env python3
"""
stock-analyzer ローカルサーバー
----------------------------------------------------
静的配信に加えて、取得した市場データを snapshot.js へ保存する
エンドポイントを持つ。ブラウザ単体ではファイルを書けないため。

- data.js は手書き（仮説・KPI・重要ファクター）なので機械は絶対に書き換えない
- snapshot.js は完全な自動生成ファイル。市場データのみを保持する

使い方: python3 serve.py [--port 8000]
"""
import argparse
import json
import os
import re
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(BASE, "snapshot.js")

# 保存を許可するフィールド（想定外のキーを書き込ませない）
ALLOWED_TOP = {"price", "marketCap", "_liveAt", "_priceSource", "_priceAsOf", "_providers"}
ALLOWED_METRICS = {
    "pe", "forwardPe", "evEbitda", "pb", "psales", "divYield", "roe",
    "revenueGrowth", "grossMargin", "netMargin", "debtToEquity", "fcfYield",
}
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def sanitize(payload):
    """受け取ったJSONを許可フィールドだけに絞る。数値以外は落とす。"""
    clean = {}
    for ticker, vals in (payload or {}).items():
        if not TICKER_RE.match(ticker) or not isinstance(vals, dict):
            continue
        entry = {}
        for k, v in vals.items():
            if k == "metrics" and isinstance(v, dict):
                m = {mk: mv for mk, mv in v.items()
                     if mk in ALLOWED_METRICS and isinstance(mv, (int, float))}
                if m:
                    entry["metrics"] = m
            elif k in ALLOWED_TOP:
                if k.startswith("_") and isinstance(v, str):
                    entry[k] = v[:40]
                elif isinstance(v, (int, float)):
                    entry[k] = v
        if entry:
            clean[ticker] = entry
    return clean


def write_snapshot(data):
    body = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    ts = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    content = f"""/*
 * 市場データのスナップショット — 自動生成ファイル
 * ----------------------------------------------------
 * このファイルは serve.py が「💾 スナップショット保存」で書き出します。
 * 手で編集しないでください（次回の保存で上書きされます）。
 *
 * 保持するのは市場データ（株価・時価総額・バリュエーション指標）のみ。
 * 適正価値・センチメント・重要ファクター・仮説は data.js 側（手書き）が正です。
 *
 * 最終保存: {ts}
 * 銘柄数: {len(data)}
 */

const LIVE_SNAPSHOT = {body};
"""
    tmp = SNAPSHOT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, SNAPSHOT)  # 原子的に置換（書きかけを読ませない）
    return len(data)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE, **kw)

    def do_POST(self):
        if self.path != "/api/save-snapshot":
            self.send_error(404, "Not Found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > 2_000_000:
                raise ValueError("bad content length")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            clean = sanitize(payload)
            if not clean:
                raise ValueError("保存できる市場データがありません")
            count = write_snapshot(clean)
            self._json(200, {"ok": True, "count": count, "file": "snapshot.js"})
        except Exception as e:
            self._json(400, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # 開発中に古いJSを掴まないようキャッシュを無効化
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 静的配信のログは抑制し、保存操作とエラーだけ残す
        # (args[0] は int のこともあるので文字列化してから判定する)
        line = " ".join(str(a) for a in args)
        if "save-snapshot" in line or " 4" in line or " 5" in line:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    # ローカル専用（外部からは接続できない）
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"stock-analyzer: http://localhost:{args.port}  (保存先 snapshot.js)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")
