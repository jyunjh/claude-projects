# 🛒 特売アラート

晴海五丁目から半径2kmのスーパーのチラシを読み取って蓄積し、**指定した品目の特売**を
夫婦で同じアプリで見られるようにし、**毎朝LINEで通知**します。

- アプリ（PWA）: <https://jyunjh.github.io/claude-projects/sale-alert/> — スマホでホーム画面に追加して使う
- 仕様: [`docs/SPEC.md`](docs/SPEC.md)
- LINE・共有品目の初期設定: [`gas/SETUP.md`](gas/SETUP.md)

## できること
| | |
|---|---|
| 今日 | 今日有効な、対象品目の特売（品目ごとに安い順）。◀▶で日付を移動 |
| 先の予定 | チラシで先の日付まで分かっているもの（取り込むたびに蓄積・更新） |
| すべて | 取り込んだ全特売を品名・日付で検索（品目を決めるのに使う） |
| 品目 | 対象品目の追加・編集・停止。夫婦で共有（LINEで「追加 卵」でも可） |
| 店舗 | 対象店舗と距離、チラシの取得元 |
| LINE | 毎朝7時台に配信。`今日` `明日` `一覧` `追加 卵` `削除 卵` `停止` `再開`。チラシ・SNSのスクショや店頭の写真を送ると次回の取り込みで読む |

## 仕組み
```
手元のMac（Claudeデスクトップの定期タスク 6:00 / 17:00）
  check_flyers.py（LLM不使用で新しい/差し替えチラシを検出）
  → Sonnet が画像を読む → Opus が検証 → merge_sales.py で蓄積 → git push
GitHub Pages: PWA と data/sales.json
Google Apps Script: 品目リスト（シート）・LINE webhook・毎朝の配信・受付箱
```

## ローカルでの作業
```bash
python3 -m http.server 9020 --directory sale-alert     # 画面の確認
./sale-alert/verify.sh                                  # 照合・蓄積・構文の検証（LLM不使用）
python3 sale-alert/ingest/check_flyers.py --out /tmp/new.json --dry-run   # チラシ取得の確認
```

- `gas/match.gs` は `match.js` の写し。`match.js` を変えたら `cp sale-alert/match.js sale-alert/gas/match.gs` して Apps Script にも貼り直す。
- 受付箱を使うには `sale-alert/.secrets.json`（git管理外）に `{"gasUrl": "…/exec", "passcode": "…"}` を置く。

## データ
- `data/stores.json` 店舗（id は不変。sales が参照）
- `data/flyers.json` チラシの索引（取得元のID・画像ハッシュ・取り込み済みハッシュ）
- `data/sales.json` 特売の蓄積。チラシが差し替わると価格変更は `history` に、消えた品は `withdrawn` に
- `data/items.example.json` 共有未設定時に表示する見本の品目
