#!/usr/bin/env python3
"""
PDF予定表の下ごしらえと照合（Claude直読の前後をローカルで担う）
================================================================
Claude が予定表PDFを読んでイベントJSONを作る運用の、前処理と検証を受け持つ。
Read ツールは poppler が無いとPDFを画像化できないため、ここでページをPNGにする。

  render: PDF → ページごとのPNG ＋ テキスト層(.txt)。Claude はPNGを見て読む
  check : 作ったイベントJSONの「行事名」と「開始時刻」が、PDFのテキスト層に
          実在するかを機械照合する（読み違い・捏造の検出）。日付の割り当ては
          機械では確かめられないので、PNGとの目視照合で担保すること

要: jidokan-calendar/.venv（pypdfium2, pillow）。
  .venv/bin/python ingest/pdf_tools.py render in.pdf outdir/
  .venv/bin/python ingest/pdf_tools.py check  in.pdf events.json
check の終了コード: 0 = 全件照合OK / 1 = 原文に見当たらないものあり / 2 = テキスト層なし
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

import pypdfium2 as pdfium


def page_texts(pdf_path):
    pdf = pdfium.PdfDocument(str(pdf_path))
    return [pdf[i].get_textpage().get_text_range() for i in range(len(pdf))]


def render(pdf_path, outdir, scale=2.2):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(str(pdf_path))
    stem = Path(pdf_path).stem
    for i in range(len(pdf)):
        png = out / f"{stem}_p{i + 1}.png"
        pdf[i].render(scale=scale).to_pil().save(png)
        print(png)
    txt = out / f"{stem}.txt"
    txt.write_text("\n\f\n".join(page_texts(pdf_path)), encoding="utf-8")
    print(txt)


def norm(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or ""))


def time_forms(hm):
    h, m = (int(x) for x in hm.split(":"))
    forms = {f"{h}:{m:02d}", f"{h:02d}:{m:02d}"}
    forms.add(f"{h}時{m}分" if m else f"{h}時")
    if h > 12:  # 「午後2時」「2:00」表記の館もある
        forms |= {f"{h - 12}:{m:02d}", f"{h - 12}時{m}分" if m else f"{h - 12}時"}
    return forms


def check(pdf_path, events_path):
    text = norm("".join(page_texts(pdf_path)))
    if len(text) < 100:
        print("テキスト層がありません（スキャン画像）。機械照合は不可、PNGとの目視照合のみで担保すること")
        return 2
    events = json.loads(Path(events_path).read_text(encoding="utf-8"))
    miss = []
    for e in events:
        # 行事名の核（番号・括弧書き・記号を除いた先頭6文字）が原文にあるか
        core = norm(re.sub(r"[①-⑳『』「」【】]|[（(].*?[)）]", "", e.get("title") or ""))[:6]
        ok_title = bool(core) and core in text
        ok_time = not e.get("start") or any(f in text for f in time_forms(e["start"]))
        if not (ok_title and ok_time):
            miss.append((e.get("date"), e.get("title"), e.get("start"), ok_title, ok_time))
    print(f"{len(events)}件中 行事名・時刻とも原文に確認: {len(events) - len(miss)}件")
    for d, t, s, a, b in miss:
        print(f"  要確認: {d} {t} {s or ''}  "
              f"[{'行事名OK' if a else '行事名が原文に無い'} / {'時刻OK' if b else '時刻が原文に無い'}]")
    return 1 if miss else 0


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("render", "check"):
        print(__doc__)
        return 1
    if sys.argv[1] == "render":
        render(sys.argv[2], sys.argv[3])
        return 0
    return check(sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    sys.exit(main())
