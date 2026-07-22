# マンション検索 — 勝どき・晴海

SUUMO の賃貸掲載を**網羅的に・重複なく**閲覧し、同じ部屋を扱う不動産会社の中から
**初期費用が最安の店舗**を見つけるためのローカルサイト。
中古マンションの販売情報も取得し、**購入 vs 賃貸**の比較シミュレーションができる。

## 特徴

- **網羅的**: SUUMO の「部屋ごとに表示」(FR301FC005) を全ページ取得するので、
  全掲載広告（会社名つき）が漏れなく取れる
- **定期借家を除外**（SUUMO のこだわり条件 `tc=0401106` を使用。`--include-teishaku` で含められる）
- **重複整理**: 同じタイプの部屋（住所+築年+間取り+面積）を1件にまとめ、掲載中の全社を並べて比較。
  階数は「建物ごとに表示」(FR301FC001) から補完
- **初期費用の最安店舗**: 敷金+礼金+前家賃+仲介手数料の概算で並べて表示。
  仲介手数料（無料/半月なども）は詳細ページから取得
- **購入 vs 賃貸**: 販売中の中古マンションをクリックすると、similar な賃貸相場を家賃欄に
  自動セットしてローン込みの実質コストを比較

## 使い方

```bash
cd mansion-finder

# 1. データ取得（賃貸一覧 + 詳細300件 + 中古販売）。10分程度
python3 ingest/scrape_suumo.py

# 詳細（店舗名・仲介手数料）はキャッシュされるので、何度か実行すると埋まっていく
python3 ingest/scrape_suumo.py --max-details 1000

# 2. サイトを開く
python3 -m http.server 9010
# → http://localhost:9010
```

## データ更新（ワンコマンド・Claude不要）

スクレイプは純Python（LLM不使用）なので、Claudeを介さず何度でも無料で更新できる。

```bash
./update.sh            # data/*.json を更新するだけ
./update.sh --serve    # 更新してローカルでサイトを開く
./update.sh --publish  # 更新して git push（GitHub Pages に反映）
```

### 自動更新（毎朝ローカルで回す・macOS launchd）

Claudeもクラウドも使わず、Macで毎朝7時に自動更新したい場合:

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.mansionfinder.update.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.mansionfinder.update</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(pwd)/update.sh</string>
    <string>--publish</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/mansionfinder-update.log</string>
  <key>StandardErrorPath</key><string>/tmp/mansionfinder-update.log</string>
</dict></plist>
PLIST
launchctl load ~/Library/LaunchAgents/com.mansionfinder.update.plist
```

停止は `launchctl unload ~/Library/LaunchAgents/com.mansionfinder.update.plist`。
`--publish` を外せば push せずローカル更新のみ。

## エリアの追加

`ingest/scrape_suumo.py` の `AREAS` に SUUMO の町名コード（`oz` パラメータ）を追加する。
コードは町名選択API `https://suumo.jp/jj/chintai/common/frBukkenKensakuPanel01/searchMachi/?...&sc=<市区コード>`
で確認できる（例: 中央区=13102、勝どき=13102003、晴海=13102034）。

## ファイル構成

```
ingest/scrape_suumo.py   スクレイパー（標準ライブラリのみ・LLM不使用）
update.sh                データ更新ワンコマンド（Claude不要）
data/listings.json       賃貸（重複グルーピング済み）
data/buy.json            中古マンション販売
data/details_cache.json  詳細ページのキャッシュ（店舗名など）
index.html / app.js / styles.css   ビューア
```

## 注意

- データ出典は SUUMO。個人利用の範囲で、リクエスト間に1秒強のウェイトを入れている。
- 初期費用は概算（鍵交換・火災保険・保証会社費用は含まない）。実際の見積りは各社に確認。
