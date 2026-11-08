# 取り込み手順書（定期タスク用）

Claudeデスクトップの定期タスク「【毎日】特売チラシの取り込み」はこの手順に従う。
人が手で回すときも同じ。

## 方針（厳守）
- チラシは **Claude が読む**（Gemini は使わない）。読み取りは Sonnet に委ね、検証は実行中のあなた（Opus）が行う。
- **原文に書かれた値だけ**。推測で埋めない（税込が書かれていなければ null。計算で出さない）。読めない・品名と価格の対応が不確かな品は載せない。
- 判断の要らない作業はローカルのスクリプトで行う。
- 一時ファイルはスクラッチパッド（無ければ `$TMPDIR/sale-alert/`）。リポジトリ内に置かない。
- git で扱うのは `sale-alert/data/` だけ。`git add -A` 禁止、パスを明示する。
- 取り込み元は `stores.json` の sources にあるもの（現状 Shufoo!）と LINE の受付箱だけ。**トクバイ（tokubai.co.jp、image.tokubai.co.jp、店舗公式ページに埋め込まれたトクバイのウィジェットを含む）は robots.txt で Claude/Anthropic を拒否しているので使わない。** トクバイにしか無い店（マルエツ系など）は、家族が LINE に送ったチラシのスクショ・写真で拾う。
- Shufoo! の画像は1ページ数MBある。check_flyers.py は同じ版（コンテンツID）を取り直さないので、手で何度も回さない。

## 0. 準備
```
cd /Users/juntaro/Claude && git checkout main && git pull --ff-only origin main
```
失敗したら（未プッシュのコミット等）中止して報告。

## 1. 変化の検出（LLM不使用。大半の回はここで終わる）
```
cd /Users/juntaro/Claude/sale-alert
python3 ingest/check_flyers.py --out <tmp>/new.json --cache <tmp>/flyers
python3 ingest/inbox.py pull --out <tmp>/inbox
```
- check_flyers: 0=新しいチラシなし / 3=あり / 1=エラー（全取得元で失敗）
- inbox: 0=なし（または未設定）/ 3=あり / 1=接続エラー
- **両方 0 なら** `flyers.json` の `checkedAt` 更新だけをコミットせずに破棄（`git checkout sale-alert/data/flyers.json`）し、「新しいチラシなし」と1行報告して終了。
- 一部の店の取得失敗は報告に残して続行。

## 2. 下ごしらえ（ローカル）
new.json の各チラシについて:
```
.venv/bin/python ingest/tile_images.py <images…> --out <tmp>/tiles/<key の : を _ に>/
```
（.venv が無ければ `python3 -m venv .venv && .venv/bin/pip install pillow`）

**同じチラシの使い回し**: チェーンの複数店（東武ストア2店・文化堂4店・サミット2店など）は同じチラシを出すことが多い。new.json で画像の hash（flyers.json の `hash`）が同じものは**1回だけ読み**、同じ結果ファイルを各店の flyerKey で merge する（読み取り結果に storeId を入れなければ、merge 時にチラシの店が入る）。

## 3. 読み取り（Sonnet に委譲）
Agent ツールで `model: sonnet` を起動（チラシが多ければ2〜3枚ずつ並列）。各チラシについて overview と全タイルを読ませ、`<tmp>/<key>_sales.json` を書かせる。指示:
- リポジトリのファイルに触れない。git 操作をしない。
- 今日の日付（JST）と、チラシの掲載期間の表記（new.json の periodText）を伝える。
- 出力は JSON 配列。1品1オブジェクト:
  ```json
  {"title": "国産豚こま切れ", "brand": null, "spec": "100gあたり", "price": 98, "priceTaxIncl": 105.84,
   "priceText": "本体98円(税込105.84円)", "validFrom": "YYYY-MM-DD", "validTo": "YYYY-MM-DD",
   "conditions": ["お一人様2点限り"], "category": "肉", "source": {"type": "flyer", "url": "<pageUrl>", "page": 1}}
  ```
- price は本体（税抜）、priceTaxIncl は税込。**書かれている方だけ**入れ、無い方は null。「よりどり3点500円」「2個で300円」等は price=null とし priceText と conditions に原文。
- 期間はチラシの掲載期間を既定とし、品ごとに「◯日限り」「◯日・◯日」「日替わり」があればそれを優先（日ごとに1件）。年は掲載期間から決める（12月→1月またぎに注意）。
- category は 肉/魚/野菜/果物/卵・乳/米・パン/日配/冷凍/菓子/飲料/調味料/日用品/その他 のどれか。
- conditions: 数量限定・時間帯・会員/アプリ限定・ポイント条件など、価格の条件を原文に近い形で。
- タイルの重なりで同じ品を二度読んだら1件にする。
- **その店で「取り扱いなし」と書かれた品は載せない**（チェーン共通チラシの「◯◯店では取り扱っておりません」）。「一部取り扱いのない商品あり」は載せて conditions に原文。
- 食品・日用品以外（家電・衣料・催事告知）、ポイント倍デー等の告知だけのものは載せない。
- 読めない・品名と価格の対応が不確かなものは載せず、「読めなかった箇所」として報告。
- 完了後に JSON として読めることを自己確認する。

受付箱（inbox.json）の写真・テキストも同じ規則で読ませ、`<tmp>/inbox_<id>.json` に。店舗は写真・テキスト（「店: …」）から stores.json の id に対応づけ、**店が特定できないもの・期間が分からないものは取り込まず** `inbox.py done --id <id> --status skipped --note "理由"`。チラシ以外（SNS投稿のスクショ等）で期間が「本日」なら受信日を validFrom=validTo にする。

## 4. 検証（あなたが行う・省略禁止）
1. 機械検査: `python3 ingest/merge_sales.py --check --flyer <key> --file <tmp>/<key>_sales.json`（受付箱は `--inbox <id> --store <storeId>`）。0 になるまで、指摘の箇所をタイル画像で確認して直す（原文に無いものは削除）。
2. 目視照合: タイル画像を自分で見て、**1チラシあたり最低8件（8件未満なら全件）**、品名・規格・価格・期間・条件が原文どおりか確認する。価格の桁違い、隣の品の価格との取り違え、本体/税込の取り違えが **1件でもあれば、そのチラシは全件を照合し直す**。
3. 通らないチラシは取り込まず、理由を報告に残す。食品の載っていないチラシは `merge_sales.py --skip-flyer <key> --note "理由"`。

## 5. 反映（ローカル）
```
python3 ingest/merge_sales.py --flyer <key> --file <tmp>/<key>_sales.json
python3 ingest/merge_sales.py --inbox <id> --store <storeId> --file <tmp>/inbox_<id>.json && python3 ingest/inbox.py done --id <id>
./verify.sh
```

## 6. コミット・公開
```
cd /Users/juntaro/Claude
git add sale-alert/data/sales.json sale-alert/data/flyers.json
git commit -m "data(sale-alert): 特売を更新（◯店・◯チラシ・+◯件/更新◯件/取り下げ◯件）"
git push origin main
```
本文にチラシごとの件数・検証結果・取り込まなかったものと理由を書き、末尾に `Co-Authored-By: Claude <noreply@anthropic.com>`。
push 後 `gh run list --limit 1` → `gh run watch <id> --exit-status` で Pages のデプロイ成功まで見届ける。

## 報告（日本語・簡潔）
- 変化なし: 「特売: 新しいチラシなし」の1行。
- 取り込んだ場合: チラシごとの件数（追加/更新/取り下げ）、検証（機械検査・目視照合の件数）、取り込まなかったものと理由、取得に失敗した店、デプロイ結果。
