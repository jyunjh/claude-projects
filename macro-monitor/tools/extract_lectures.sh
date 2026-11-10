#!/bin/bash
# 講義（.docx）を手元でテキスト化する。knowledge.js の解説を見直すときの元資料になる。
#   tools/extract_lectures.sh "/Users/…/CFA Level3 PSM Macro"
# 出力先の knowledge/raw/ は .gitignore 済み。講義の本文は公開リポジトリに入れない。
# macOS 標準の textutil だけを使う（追加インストール不要）。
set -e
src="${1:?講義の .docx が入ったフォルダを指定してください}"
out="$(cd "$(dirname "$0")/.." && pwd)/knowledge/raw"
mkdir -p "$out"
n=0
for f in "$src"/*.docx; do
  textutil -convert txt -output "$out/$(basename "${f%.docx}").txt" "$f" && n=$((n + 1))
done
echo "$n 本をテキスト化しました → $out"
