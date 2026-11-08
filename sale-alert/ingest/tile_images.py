#!/usr/bin/env python3
"""チラシ画像を、読み取りやすい大きさのタイルに分割する（LLM不使用）。

チラシは1枚が大きく文字が細かいため、そのまま読ませると縮小されて価格の桁を読み違えやすい。
長辺 ~1600px を目安に、重なり（既定12%）を持たせて格子状に切る。重なりは境界で切れた品を
どちらかのタイルで丸ごと読めるようにするため。全体像（縮小版）も overview.png として出す。

  sale-alert/.venv/bin/python sale-alert/ingest/tile_images.py <画像…> --out <dir>
  （.venv が無ければ: python3 -m venv sale-alert/.venv && sale-alert/.venv/bin/pip install pillow）

出力: <dir>/p<ページ>_overview.png, <dir>/p<ページ>_r<行>c<列>.png と <dir>/tiles.json
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = 200_000_000


def tile(img: Image.Image, target: int, overlap: float):
    w, h = img.size
    cols = max(1, math.ceil(w / target))
    rows = max(1, math.ceil(h / target))
    tw, th = w / cols, h / rows
    ox, oy = int(tw * overlap), int(th * overlap)
    for r in range(rows):
        for c in range(cols):
            box = (max(0, int(c * tw) - ox), max(0, int(r * th) - oy),
                   min(w, int((c + 1) * tw) + ox), min(h, int((r + 1) * th) + oy))
            yield r, c, box


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", type=int, default=1600, help="タイルの長辺の目安(px)")
    ap.add_argument("--overlap", type=float, default=0.12)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for pi, src in enumerate(a.images, 1):
        img = Image.open(src).convert("RGB")
        ov = img.copy()
        ov.thumbnail((1400, 1400))
        ov_path = out / f"p{pi}_overview.png"
        ov.save(ov_path)
        page = {"page": pi, "source": src, "size": img.size, "overview": str(ov_path), "tiles": []}
        for r, c, box in tile(img, a.target, a.overlap):
            p = out / f"p{pi}_r{r + 1}c{c + 1}.png"
            img.crop(box).save(p)
            page["tiles"].append({"file": str(p), "row": r + 1, "col": c + 1, "box": box})
        index.append(page)
        print(f"p{pi}: {img.size[0]}x{img.size[1]} → {len(page['tiles'])} タイル")
    (out / "tiles.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
