# 特売アラート 仕様書 v1.0

晴海フラッグ周辺（基準点から半径2km）のスーパーのチラシ・投稿から、**指定した品目の特売**を拾って蓄積し、
夫婦で同じ画面を見られるようにし、**当日の朝にLINEで通知**する。

## 1. 全体構成

```
 ┌─────────────── 手元のMac（ローカル・無料） ───────────────┐
 │ Claudeデスクトップの定期タスク（毎日 6:00 / 17:00）          │
 │  1. ingest/check_flyers.py   … LLM不使用。各店のチラシが     │
 │                                新規/差し替えかをハッシュで判定 │
 │  2. Sonnet がチラシ画像を読む → sales JSON                     │
 │  3. Opus が画像と突き合わせて検証                              │
 │  4. ingest/merge_sales.py    … 蓄積・更新（先日付も保持）      │
 │  5. git push → GitHub Pages                                    │
 └──────────────────────────────┬───────────────────────────────┘
                                │ data/sales.json（公開・静的）
          ┌─────────────────────┴───────────────────┐
          ▼                                         ▼
 ┌──────────────────────┐   品目の読み書き   ┌──────────────────────────────┐
 │ PWA（GitHub Pages）  │ ◀───────────────▶ │ Google Apps Script + シート   │
 │ /sale-alert/          │  （合言葉つき）    │  ・品目リスト（夫婦で共有）    │
 │ 今日/先の予定/品目/店舗 │                    │  ・LINE webhook（追加/削除/…） │
 │ ホーム画面に追加して使う │                    │  ・毎朝7時台にLINEへ配信       │
 └──────────────────────┘                    │  ・写真/投稿の受付箱（inbox）  │
                                              └──────────────┬───────────────┘
                                                             ▼
                                                     LINE公式アカウント（夫婦）
```

### 1.1 この構成にした理由
| 要件 | 採用 | 理由 |
|---|---|---|
| チラシの読み取り | Claude（Sonnet読取＋Opus検証）を手元の定期タスクで | チラシは画像が主でOCR単体では価格と品名の対応が崩れる。Geminiは精度不足で不採用（児童館と同方針）。サブスク内で動くのでAPI費用ゼロ |
| 変更検知 | Pythonでハッシュ比較（LLM不使用） | 大半の回は「変化なし」で即終了でき、安く速い |
| 朝の通知 | GASの時間トリガー | Macが寝ていても届く。LINE Notifyは2025/3に終了したため Messaging API を使う |
| 夫婦の共有 | 同じURLのPWA＋同じLINE公式アカウント | アプリストア不要、iPhone/Androidどちらもホーム画面に置ける |
| 品目のカスタマイズ | Googleシートを正とし、PWA・LINE・シートのどこからでも編集 | サーバ不要・無料。妻はLINEで「追加 卵」と送るだけでよい |
| SNS投稿 | LINEへ写真・テキストを送ると受付箱へ → 次回の取り込みでClaudeが読む | X/InstagramはAPI有料・ログイン必須で自動取得が現実的でない。店頭POPやSNSのスクショも同じ経路で拾える |

### 1.2 チラシの取得元（2026-11-08 調査）
基準点（晴海五丁目3番付近）から2km以内の食品スーパーは28店。

| 取得元 | 扱い | 対象 |
|---|---|---|
| Shufoo!（shufoo.net） | **自動取得**。robots.txt で許可。店舗ページの一覧から号ごとに原寸画像（`index/orig/<n>.jpg`）を取る。同じ版（コンテンツID）は取り直さない | サミット2・東武ストア2・ライフ2・文化堂4・三和・イオンスタイル有明（12店） |
| トクバイ（tokubai.co.jp） | **使わない**。robots.txt で ClaudeBot / anthropic-ai / Claude-Web を拒否している。マルエツ公式ページのチラシもトクバイのウィジェット（画像は image.tokubai.co.jp）なので同様 | マルエツ系5・成城石井2・ダイエー・フードスタイル・ワイズマート等 |
| LINE の受付箱 | 家族がチラシのスクショ・店頭POP・SNS投稿を送る → 次回の取り込みで読む | 自動取得できない店すべて、SNS |
| X / Instagram | 使わない（API有料・ログイン必須） | — |

> Shufoo! の利用規約の自動取得に関する条項は確認できていない。個人利用・1日2回・新しい号の画像だけ、という負荷に抑えている。

## 2. データ（`sale-alert/data/`、すべて公開リポジトリに載る）

> 公開されるのは「チラシに載っている特売情報」と「店舗一覧」だけ。**品目リスト・LINEの宛先・受付箱の写真はGoogle側（非公開）**に置く。
> 基準点は建物名ではなく「晴海五丁目」として座標を丸めて記載する。

### 2.1 `stores.json`
```json
{
  "origin": {"label": "晴海五丁目", "lat": 35.651, "lng": 139.777},
  "radiusKm": 2.0,
  "stores": [{
    "id": "maruetsu-kachidoki6",          // 全期間で不変。salesが参照する
    "chain": "マルエツ", "name": "マルエツ 勝どき六丁目店",
    "address": "…", "lat": 0, "lng": 0, "distanceKm": 1.23, "hours": "…",
    "sources": [                           // チラシの取得先（adapterごと）
      {"kind": "tokubai", "url": "https://tokubai.co.jp/…"}
    ],
    "sns": {"x": null, "instagram": null, "line": null},
    "active": true
  }]
}
```

### 2.2 `flyers.json`（チラシの索引。check_flyers.py が更新）
```json
{"flyers": [{
  "key": "maruetsu-kachidoki6:tokubai:12345",   // 店:取得元:チラシID（取得元のID。無ければ画像URLのハッシュ）
  "storeId": "…", "title": "週末特売", "periodText": "11/8(土)〜11/10(月)",
  "pageUrl": "…", "images": ["…"], "hash": "sha1(画像バイト列の連結)",
  "firstSeenAt": "ISO", "lastSeenAt": "ISO",
  "ingestedHash": "取り込み済みの hash（hash と違えば要再取り込み）", "ingestedAt": "ISO|null",
  "status": "new|changed|ingested|skipped|gone", "note": "…"
}]}
```

### 2.3 `sales.json`（蓄積の本体）
```json
{"generatedAt": "ISO", "sales": [{
  "id": "sha1(storeId|validFrom|validTo|正規化品名) の先頭12桁",
  "storeId": "…", "flyerKey": "…（inbox由来は inbox:<id>）",
  "title": "国産豚こま切れ",            // 原文どおりの品名
  "brand": null, "spec": "100gあたり",   // 規格・量
  "price": 98,                           // 本体価格（税抜）。書かれていなければ null
  "priceTaxIncl": 105.84,                // 税込。書かれていなければ null（計算で埋めない）
  "priceText": "本体98円(税込105.84円)",  // 原文
  "validFrom": "2026-11-08", "validTo": "2026-11-10",
  "conditions": ["お一人様2点限り", "16時から"],
  "category": "肉|魚|野菜|果物|卵・乳|米・パン|日配|冷凍|菓子|飲料|調味料|日用品|その他",
  "source": {"type": "flyer|inbox", "url": "…", "page": 1},
  "status": "active|withdrawn",          // 差し替えで消えた品は withdrawn（履歴として残す）
  "firstSeenAt": "ISO", "updatedAt": "ISO",
  "history": [{"at": "ISO", "price": 128, "validFrom": "…", "validTo": "…"}]  // 変更前の値
}]}
```

#### 蓄積・更新の規則（`merge_sales.py`）
1. 取り込みは**チラシ（flyerKey）単位**で差し替える。同じ flyerKey の既存分と突き合わせ:
   - 同じ id → 価格・期間・条件を更新し、変わった値を `history` に積む。
   - 新しいものに無い既存分 → `status: "withdrawn"`（消さない）。
   - 新規 → 追加。
2. 日付は年まで解決済みで受け取る（読み取り側が「チラシの掲載日」から年を決める）。merge 側で `今日-7日 ≦ validFrom ≦ 今日+60日` と `validFrom ≦ validTo` を検査し、外れたら拒否。
3. `validTo < 今日-45日` のものは削除（ファイル肥大の防止）。
4. 同じ入力で冪等（差分は generatedAt のみ）。

### 2.4 品目（Googleシート `items` タブ。正はここ）
| 列 | 例 | 意味 |
|---|---|---|
| id | `i-…` | 自動採番 |
| name | 卵 | 表示名 |
| keywords | 卵,たまご,玉子 | どれかが品名に含まれれば一致（ひらがな/カタカナ・全角半角は同一視） |
| exclude | 卵焼き,うずら | 含まれたら除外 |
| maxPrice | 200 | 本体価格がこれ以下のときだけ通知（空欄なら価格を問わない） |
| enabled | TRUE | 通知対象か |
| addedBy | 妻 | LINE表示名 / PWA |
| updatedAt | ISO | |

`data/items.example.json` は**シート未設定時の見本**（PWAはこれを表示し「共有されていない」と明示する）。

## 3. 照合ロジック（`match.js`。PWAとGASで同一ファイルを使う）
- 正規化: NFKC → 小文字 → カタカナをひらがなへ → 空白・記号除去。
- 一致: `keywords` のいずれかが品名（title + brand + spec）に部分一致し、`exclude` のどれにも一致しない。
- 価格: `maxPrice` があれば `price`（無ければ `priceTaxIncl`）が以下のものだけ。価格不明は「価格不明」として残す。
- 対象日: `validFrom ≦ 日付 ≦ validTo` かつ `status = active` かつ店舗が半径内・active。
- 並び: 品目ごとに価格の安い順。
- `gas/match.gs` は `match.js` の完全な写し（`verify.sh` で一致を検査）。

## 4. PWA（`sale-alert/`、ビルド不要のバニラJS）
- タブ: **今日** / **先の予定**（日付ごと・蓄積分すべて）/ **すべての特売**（検索）/ **品目** / **店舗** / **設定**。
- 品目の読み書きは GAS 経由。合言葉をURLに載せないため読み取りも POST（`{action: "items.list"|"items.save"|"items.delete", passcode, …}`、Content-Type `text/plain` でCORSプリフライトを避ける）。
- GASのURLと合言葉は**リポジトリに入れない**。設定画面で入力し localStorage に保存。妻には「共有リンク」（`#setup=<base64>`）を送れば1タップで設定が済む。
- オフライン: service worker でアプリ本体をキャッシュ、データはネットワーク優先。
- 配信: GitHub Pages の `/sale-alert/`。

## 5. LINE（GAS `gas/Code.gs`）
- コマンド（1:1でもグループでも可）:
  `追加 卵` / `追加 豚こま 150`（上限価格つき）/ `削除 卵` / `一覧` / `今日` / `明日` / `ヘルプ`
- 写真・テキストを送る → `inbox` タブ（写真はDriveのフォルダ）に保存し「受け付けました。次回の取り込みで反映」と返信。テキストに `店:` が無ければ店舗は読み取り側が推定し、不明なら取り込まない。
- 宛先: 友だち追加（follow）とグループ参加（join）で `recipients` タブに自動登録。朝の配信は有効な宛先すべてへ push。
- 朝の配信（時間トリガー 7時台）: 今日有効な一致品目を品目ごとに最安から最大3件、明日から始まる一致を最大5件、データ最終更新日（3日以上古ければ警告）、PWAへのリンク。一致なしの日も「今日の対象特売はありません」を1行送る（動いていることが分かるように。設定で無効化可）。
- 無料枠: 月200通。夫婦2人×30日＝60通程度。返信（reply）は無料。

## 6. 取り込みの定期タスク（Claudeデスクトップ）
児童館カレンダーの `jidokan-chuo-new-issue` と同じ型。
1. `git pull` → `python3 ingest/check_flyers.py --out <tmp>/new.json`（終了コード 0=変化なし→即終了 / 3=要取り込み / 1=エラー）
2. `python3 ingest/inbox.py pull --out <tmp>/inbox/`（GASの受付箱から未処理分を取得。未設定ならスキップ）
3. Sonnet がチラシ画像を読み `<tmp>/<flyerKey>_sales.json` を作る（規則は §7）
4. Opus が検証: `merge_sales.py --check` の機械検査 ＋ 1チラシあたり最低8件（少なければ全件）を画像で目視照合。価格の桁違い・品名と価格の取り違えが1件でもあればそのチラシは全件照合し直す
5. `merge_sales.py --flyer <key> --file …` で反映 → flyers.json に ingestedHash を記録
6. `sale-alert/data/` だけをコミットして push

## 7. 読み取り規則（Sonnetへの指示の核）
- 原文に書かれた値だけ。推測で埋めない（税込が無ければ null、規格が無ければ null）。
- 1品1レコード。「よりどり3点500円」のような条件付きは `price: null`, `priceText` と `conditions` に原文。
- 日付は、チラシの掲載期間を既定とし、品ごとに「◯日限り」「日替わり」があればそれを優先。年は掲載期間の近くで決める（12月→1月またぎに注意）。
- 読めない・価格と品名の対応が不確かなものは載せず、報告に書く。
- 食品・日用品以外（家電・衣料・催事告知）は載せない。

## 8. 受け入れ条件
- [ ] 同じ入力で merge が冪等。差し替えで消えた品が withdrawn になり、価格変更が history に残る。
- [ ] `match.js` と `gas/match.gs` が一致し、`verify.sh` の照合テストが通る。
- [ ] PWA: GAS未設定でも見本の品目で一覧が出る。GAS設定後は品目の追加・削除が両端末に反映される。
- [ ] LINE: 「追加 卵」→ シートに行が増え、PWAに出る。毎朝の配信が届く。
- [ ] 定期タスク: 変化なしの日はLLMを使わずに終わる。
