#!/usr/bin/env python3
"""
Claude が作ったイベントJSONを events/<ward>.json に反映する
================================================================
1館ぶんのイベント配列（date/start/end/title/description/ageMin/ageMax/ageLabel）を
ingest.py と同じ規則（valid_event / normalize / dedupe）で正規化し、その館の既存分を
差し替える。他の館の分は触らない。

使い方:
  python3 ingest/merge_events.py --ward chuo --center chuo-tsukiji --file tsukiji.json
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="1館ぶんのイベントJSONを区のファイルへ反映")
    ap.add_argument("--ward", required=True)
    ap.add_argument("--center", required=True, help="館ID（centers/<ward>.json に存在すること）")
    ap.add_argument("--file", required=True, help="イベント配列のJSON")
    args = ap.parse_args()

    centers = json.loads((ingest.CENTERS_DIR / f"{args.ward}.json").read_text(encoding="utf-8"))
    if not any(c["id"] == args.center for c in centers):
        print(f"NG: {args.center} は centers/{args.ward}.json にありません")
        return 1

    raw = json.loads(Path(args.file).read_text(encoding="utf-8"))
    today = date.today()
    new, dropped = [], 0
    for ev in raw:
        if not ingest.valid_event(ev, today):
            dropped += 1
            print(f"  除外（日付が不正/範囲外）: {ev.get('date')} {ev.get('title')}")
            continue
        new.append(ingest.normalize(ev, args.center, len(new) + 1))
    if not new:
        print("NG: 有効なイベントが0件のため反映しません（前回分を保持）")
        return 1

    path = ingest.EVENTS_DIR / f"{args.ward}.json"
    keep = [e for e in ingest.load_existing(path) if e.get("centerId") != args.center]
    events = ingest.dedupe(keep + new)
    events.sort(key=lambda e: (e.get("date") or "", e.get("start") or ""))
    out = {"mode": "live",
           "generatedAt": datetime.now(ingest.JST).isoformat(timespec="seconds"),
           "events": events}
    ingest.EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{args.center}: {len(new)}件を反映（除外 {dropped}件）/ {args.ward} 合計 {len(events)}件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
