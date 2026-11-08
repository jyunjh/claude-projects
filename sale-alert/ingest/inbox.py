#!/usr/bin/env python3
"""LINE で送られた写真・投稿（Apps Script の受付箱）を手元に取ってくる / 処理済みにする。

  python3 ingest/inbox.py pull --out <tmp>/inbox      # 未処理分を取得（終了コード 0=なし / 3=あり / 1=エラー）
  python3 ingest/inbox.py done --id in-xxxx [--status done|skipped] [--note "理由"]

接続先は sale-alert/.secrets.json（git 管理外）:
  {"gasUrl": "https://script.google.com/macros/s/…/exec", "passcode": "…"}
未設定なら「受付箱は未設定」と表示して終了コード 0。
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".secrets.json"
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def call(cfg: dict, payload: dict) -> dict:
    body = json.dumps({**payload, "passcode": cfg["passcode"]}).encode()
    req = urllib.request.Request(cfg["gasUrl"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=120) as r:  # Apps Script は 302 → GET で結果を返す
        res = json.loads(r.read().decode())
    if not res.get("ok"):
        raise RuntimeError(res.get("error") or "失敗")
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pull")
    p.add_argument("--out", required=True)
    d = sub.add_parser("done")
    d.add_argument("--id", required=True)
    d.add_argument("--status", default="done", choices=["done", "skipped"])
    d.add_argument("--note", default="")
    a = ap.parse_args()

    if not SECRETS.exists():
        print("受付箱は未設定（sale-alert/.secrets.json が無い）")
        return 0
    cfg = json.loads(SECRETS.read_text())
    try:
        if a.cmd == "done":
            call(cfg, {"action": "inbox.done", "id": a.id, "status": a.status, "note": a.note})
            print(f"{a.id} を {a.status} にしました")
            return 0
        res = call(cfg, {"action": "inbox.list", "withFiles": True})
    except Exception as e:  # noqa: BLE001 — 通信・認証エラーはまとめて報告
        print(f"受付箱に接続できません: {e}", file=sys.stderr)
        return 1

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    for it in res.get("inbox", []):
        e = {k: it.get(k) for k in ("id", "receivedAt", "from", "kind", "text")}
        if it.get("base64"):
            path = out / (it["id"] + EXT.get(it.get("mimeType", ""), ".bin"))
            path.write_bytes(base64.b64decode(it["base64"]))
            e["file"] = str(path)
        entries.append(e)
    (out / "inbox.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1))
    print(f"未処理 {len(entries)} 件 → {out / 'inbox.json'}")
    return 3 if entries else 0


if __name__ == "__main__":
    sys.exit(main())
