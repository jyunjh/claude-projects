#!/usr/bin/env python3
"""
児童館イベントカレンダー ローカルサーバー
==========================================
静的ファイルの配信に加えて、UI から取り込み（ingest）を実行できる小さなAPIを持つ。
Python 標準ライブラリのみ・追加インストール不要。

なぜ必要か:
  - 児童館のPDFはブラウザから直接取得できない（CORSで弾かれる）。
    取得＋Gemini抽出＋events.json の書き込みはサーバー側で行う必要がある。
  - そのため `python3 -m http.server` の代わりにこのサーバーを使うと、
    画面の「🔄 最新に更新」ボタンから取り込みを実行できる。

セキュリティ:
  - 127.0.0.1（localhost）のみで待ち受ける個人利用向け。
  - Gemini APIキーはリクエストボディで受け取り、その取り込み実行にのみ使用（保存しない）。

API:
  POST /api/ingest   body: {"apiKey": "...", "ward": "<区ID・必須>", "center": "<任意の館ID>"}
                     → 指定区の ingest を実行し、サマリJSONを返す。

使い方:
  cd jidokan-calendar
  python3 serve.py            # http://localhost:9000
  python3 serve.py --port 8080
"""

import argparse
import importlib.util
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ingest/ingest.py を動的に読み込んで run_ingest を再利用する
_spec = importlib.util.spec_from_file_location("ingest", ROOT / "ingest" / "ingest.py")
ingest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ingest)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # 開発サーバなので静的ファイルもキャッシュさせない。
        # 既定では Cache-Control が付かずブラウザのヒューリスティックキャッシュが効くため、
        # app.js やデータJSONを編集しても古い内容が読み込まれ続けることがある。
        if "Cache-Control" not in self._headers_buffer_names():
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _headers_buffer_names(self):
        """送信予定のヘッダ名の集合（_send_json が既に付けた分を二重に出さないため）。"""
        names = set()
        for raw in getattr(self, "_headers_buffer", []):
            line = raw.decode("latin-1", "ignore")
            if ":" in line:
                names.add(line.split(":", 1)[0].strip())
        return names

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.rstrip("/") != "/api/ingest":
            self._send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "不正なリクエストです。"})
            return

        api_key = (payload.get("apiKey") or "").strip()
        ward = (payload.get("ward") or "").strip()
        center = (payload.get("center") or "").strip() or None
        if not api_key:
            self._send_json(400, {"error": "Gemini APIキーが未設定です。⚙️API設定から保存してください。"})
            return
        if not ward:
            self._send_json(400, {"error": "区ID（ward）が未指定です。例: {\"ward\": \"edogawa\"}"})
            return

        logs = []
        try:
            summary = ingest.run_ingest(api_key, ward, center=center, log=logs.append)
        except ValueError as e:  # 不正な区ID・館IDなどはクライアント側の誤り
            self._send_json(400, {"error": str(e)})
            return
        except ingest.urllib.error.HTTPError as e:
            self._send_json(502, {"error": f"Gemini/取得でエラー: HTTP {e.code}"})
            return
        except Exception as e:  # noqa: BLE001 - クライアントに失敗内容を返す
            self._send_json(500, {"error": str(e)})
            return

        summary["logs"] = logs
        self._send_json(200, summary)

    # http.server のアクセスログは簡潔に
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description="児童館カレンダー ローカルサーバー")
    ap.add_argument("--port", type=int, default=9000)
    ap.add_argument("--host", default="127.0.0.1", help="既定は localhost のみ")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{'localhost' if args.host == '127.0.0.1' else args.host}:{args.port}"
    print(f"児童館カレンダーを起動しました → {url}")
    print("  ・画面の「🔄 最新に更新」で各館PDFから取り込みできます（要 Gemini APIキー）。")
    print("  停止: Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました。")


if __name__ == "__main__":
    main()
