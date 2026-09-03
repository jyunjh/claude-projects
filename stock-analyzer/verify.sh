#!/bin/bash
# stock-analyzer ローカル検証ランナー
# node/deno 不要。macOS標準の JavaScriptCore で動作し、APIもネットワークも使わない。
cd "$(dirname "$0")" || exit 1
osascript -l JavaScript tools/verify.js
