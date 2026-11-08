#!/bin/sh
# 特売アラートのローカル検証（LLM不使用）。node 不要: JS は osascript(JavaScriptCore) で実行。
set -e
cd "$(dirname "$0")"
ng=0
echo "== gas/match.gs が match.js の写しか"
if cmp -s match.js gas/match.gs; then echo OK; else echo "NG: cp match.js gas/match.gs を実行"; ng=1; fi
echo "== 照合ロジック (match.js)"
r=$(osascript -l JavaScript tests/test_match.js "$PWD/match.js"); echo "$r"; case "$r" in OK*) ;; *) ng=1;; esac
echo "== Apps Script（模擬環境）"
r=$(osascript -l JavaScript tests/test_gas.js "$PWD"); echo "$r"; case "$r" in OK*) ;; *) ng=1;; esac
echo "== JS の構文 (app.js / sw.js / gas)"
for f in app.js sw.js gas/Code.gs; do
  osascript -l JavaScript -e "ObjC.import('Foundation'); new Function(\$.NSString.stringWithContentsOfFileEncodingError('$PWD/$f', \$.NSUTF8StringEncoding, null).js); 'ok'" >/dev/null && echo "OK $f" || { echo "NG $f"; ng=1; }
done
echo "== 蓄積・更新 (merge_sales.py)"
python3 tests/test_merge.py || ng=1
echo "== data/*.json が読めるか"
for f in data/*.json; do python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$f" && echo "OK $f" || { echo "NG $f"; ng=1; }; done
[ $ng -eq 0 ] && echo "すべてOK" || { echo "失敗あり"; exit 1; }
