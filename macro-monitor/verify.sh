#!/bin/bash
# macro-monitor ローカル検証（ネットワーク不要）
#   ./verify.sh           snapshot の自己検証 ＋ JSの構文チェック
#   ./verify.sh --fresh   データの鮮度も確認する
cd "$(dirname "$0")" || exit 1
fail=0
python3 tools/verify.py "$@" || fail=1
# node は入れていないので、macOS 標準の JavaScriptCore（JXA）で構文だけ確かめる
for f in app.js chart.js knowledge.js data/snapshot.js; do
  out=$(osascript -l JavaScript -e "try{ new Function(\$.NSString.stringWithContentsOfFileEncodingError('$f',4,null).js); 'ok' }catch(e){ String(e) }" 2>&1)
  if [ "$out" = "ok" ]; then echo "✓ 構文OK: $f"; else echo "✗ 構文エラー: $f — $out"; fail=1; fi
done
exit $fail
