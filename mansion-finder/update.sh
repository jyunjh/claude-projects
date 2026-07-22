#!/usr/bin/env bash
# マンション検索データの更新をローカルで回す（Claude不要・トークン消費ゼロ）
# ==============================================================
# SUUMOのスクレイプは純Pythonで動く。LLMは一切使わないので、
# このスクリプトを直接実行すればClaudeを介さず何度でも無料で更新できる。
#
# 使い方:
#   ./update.sh              データだけ更新（data/*.json を書き換え）
#   ./update.sh --publish    更新して git commit + push（GitHub Pages に反映）
#   ./update.sh --serve      更新してローカルでサイトを開く（http://localhost:9010）
#
# 定期実行（毎朝7時に自動更新したい場合）は README の「自動更新」を参照。

set -euo pipefail
cd "$(dirname "$0")"

PUBLISH=0
SERVE=0
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --serve)   SERVE=1 ;;
    *) echo "不明なオプション: $arg" >&2; exit 1 ;;
  esac
done

echo "▶ データ更新を開始（数分かかります）"
python3 ingest/scrape_suumo.py --max-details 300

if [ "$PUBLISH" = "1" ]; then
  if [ -n "$(git status --porcelain data/)" ]; then
    echo "▶ 変更を commit / push（GitHub Pages に反映されます）"
    git add data/
    git commit -m "data: マンション検索データを更新 ($(date +%Y-%m-%d))"
    git push
  else
    echo "▶ データに変更なし。commit はスキップ"
  fi
fi

if [ "$SERVE" = "1" ]; then
  echo "▶ http://localhost:9010 で開いています（Ctrl+C で停止）"
  python3 -m http.server 9010
fi

echo "✓ 完了"
