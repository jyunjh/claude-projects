#!/bin/bash
# macro-monitor 更新ランナー（手元で回すとき用。公開サイトは GitHub Actions が毎朝回す）
#   ./update.sh            通常更新（新しいキャッシュがあればネットに出ない）
#   ./update.sh --force    キャッシュを無視して取り直す
# NAHBの .xls を読むために xlrd が要る。初回だけ .venv を作って入れる（無料・PyPI）。
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv && .venv/bin/pip install --quiet xlrd || exit 1
fi
exec .venv/bin/python tools/update.py "$@"
