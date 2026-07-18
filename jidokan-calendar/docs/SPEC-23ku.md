# 仕様書: 児童館イベントカレンダー 23区拡大

- 版: v1.0（2026-07-07 / 策定: Fable 5）
- 対象リポジトリ: `jyunjh/claude-projects` / ディレクトリ `jidokan-calendar/`
- この文書は**実装エージェント（Opus/Sonnet）に単体で渡せる**ことを目的とする。判断が必要な点は本書で確定済み。本書に無い判断が必要になったら、勝手に決めずに発注元へ差し戻すこと。

---

## 1. 目的・背景

現在は西葛西駅5km圏の9館（江戸川区8・江東区1）のみ。これを**東京23区全体に段階的に拡大**する。
一度に全区は行わず、**区単位のワークパッケージ**（§8）を繰り返して増やす。アプリはその増加に耐える構造へ先に改修する（P0）。

既存の価値（見やすさ重視・ビルド不要バニラJS・無料運用・GitHub Pages公開）は**維持**する。

## 2. 現状（2026-07-07 時点）

- `data/centers.json`: 9館（フラット1ファイル）
- `data/events.json`: `{mode, generatedAt, events[]}` 77件（7月・Claude直読で作成）
- 取り込み: `ingest/ingest.py`（Gemini、PDF/HTML/画像対応、429/503再試行、館別マージ）/ `ingest/eval.py`（精度測定）
- 配信: GitHub Pages（`.github/workflows/pages.yml`、`jidokan-calendar/` をルートに配信。**mansion-finder も同 workflow で配信中なので workflow の他ツール部分に触れないこと**）
- UI: 公開版(localhost以外)は 🔄更新/⚙️API設定 を自動非表示。スマホは既定リスト表示＋カレンダーはドット。

## 3. スコープ / 非スコープ

**スコープ**
- データの区別（くべつ）分割と遅延読み込み
- 区セレクタUI（対象区の切替・永続化）
- 取り込み(ingest/serve)の区単位対応
- 区ごとの施設データ整備（ワークパッケージ方式で順次）

**非スコープ（やらない）**
- サーバー/DB導入、ユーザーアカウント、通知
- 全区の一括データ整備（段階的に行う）
- 児童館・子育てひろば以外の施設種別

## 4. データ設計（確定）

### 4.1 ファイル構成

```
jidokan-calendar/data/
  wards.json              # 23区メタ＋カバレッジ状態（P0で作成）
  centers/<wardId>.json   # 区ごとの施設レジストリ
  events/<wardId>.json    # 区ごとの取り込み済みイベント（無い区は404で良い）
```

旧 `data/centers.json` / `data/events.json` は**P0で分割移行して削除**する。

### 4.2 wardId（ローマ字・固定）

| id | 区 | id | 区 | id | 区 |
|---|---|---|---|---|---|
| chiyoda | 千代田区 | shinagawa | 品川区 | toshima | 豊島区 |
| chuo | 中央区 | meguro | 目黒区 | kita | 北区 |
| minato | 港区 | ota | 大田区 | arakawa | 荒川区 |
| shinjuku | 新宿区 | setagaya | 世田谷区 | itabashi | 板橋区 |
| bunkyo | 文京区 | shibuya | 渋谷区 | nerima | 練馬区 |
| taito | 台東区 | nakano | 中野区 | adachi | 足立区 |
| sumida | 墨田区 | suginami | 杉並区 | katsushika | 葛飾区 |
| koto | 江東区 | edogawa | 江戸川区 | | |

### 4.3 スキーマ

**wards.json**（配列）
```json
{ "id": "edogawa", "name": "江戸川区", "lat": 35.7068, "lng": 139.8683,
  "status": "covered" }   // covered=施設登録済 / none=未整備（noneの区はファイルに含めなくて良い）
```

**centers/<wardId>.json**（配列・既存スキーマそのまま）
```json
{ "id": "kasai", "name": "...", "region": "江戸川区", "address": "...",
  "lat": 0, "lng": 0, "officialUrl": "...", "sourcePage": "...", "pdfUrl": "...", "color": "#4f86c6" }
```
- `id` は**全区を通して一意**（推奨: 既存は変更禁止、新規は `<wardId>-<slug>` 形式）
- **既存9館の id（kasai, nagisa, horie, nakakasai, seishincho, kasai_hc, funabori, beteru, minamisuna）は events が参照しているため絶対に変更しない**
- `color` は §4.4 のパレットを区内で先頭から巡回

**events/<wardId>.json** — 既存 events.json と同形式 `{mode, generatedAt, events[]}`。イベントのスキーマは変更なし（`dateEnd` 含む）。

### 4.4 カラーパレット（巡回・確定）

```
#4f86c6 #e8804f #5cb85c #a06cd5 #d6477f #2bb3a3 #e0a32e #7e6cd6
#d2691e #3b9e8f #c0567a #5b8def #6aa84f #b5892f #8e5ad6 #c95555
```

## 5. アプリ要件（app.js / index.html / styles.css）

### 5.1 区セレクタ
- 児童館パネルの**上**に折りたたみパネル「🗾 対象の区を選ぶ」（`details.panel`、既定は畳み）を置く。`wards.json` の `status:"covered"` の区のみチップで表示。マルチ選択。畳んだ状態でも summary 右のヒントに選択中の区名を「・」区切りで要約表示（未選択なら「未選択」）。
- 選択は `localStorage("selectedWards")` に永続化。初回既定は `["edogawa","koto"]`。
- 区の選択変更時: その区の centers/events を**遅延fetch**（未取得の区のみ）。イベント無し(404)は空扱いで落ちないこと。
- 区を外したら、その区の館は地図・凡例・カレンダーから消える（選択状態 `state.selected` からも除外）。

### 5.2 表示スケール対策（将来100館超に耐える）
- 凡例: 表示中の館が**12館まではそのまま**、超えたら12館＋「他 N 館」（クリックで全展開/折りたたみ）。
- 館リスト（パネル内）: 区ごとの見出しでグルーピング。
- 地図: 選択区のマーカーのみ描画。区切替時にマーカー再構築。既定中心は選択区の施設の重心（1区なら区の `lat/lng`）。
- 「すべて選択/解除」は**読み込み済みの選択区内**で動作。距離フィルタ・年齢フィルタ・期間集約・初期月ロジックは変更しない。

### 5.3 状態バー
- `対象: 江戸川区・江東区 ｜ 最終更新: <選択区のgeneratedAtの最大> ` 形式に拡張。
- イベント未取込の区がある場合は `（△△区は予定未取込）` を後置。mode はどれか一つでも live なら「実データ」バッジ。

### 5.5 お気に入り（favorites）
- 館リストの各行に ⭐ トグル。登録は `localStorage("favoriteCenters")` に `{centerId: wardId}` で永続化。
- フィルタ行に「⭐ お気に入りのみ」チェック（`localStorage("favoritesOnly")`）。ONで表示対象＝お気に入り館に限定。
- **次回起動時に自動復元**: お気に入り館の区は（選択区に無くても）自動ロードし、favOnly保存時はお気に入りのみで表示。
- 手動の選択変更（館チェック・すべて選択/解除・距離フィルタ・地図クリック）を行うと favOnly は解除（＝ favOnly は常に「表示＝お気に入り」を意味する不変条件）。区チップ切替時は favOnly なら favorites に追従。

### 5.4 互換・回帰
- **P0完了時、既存9館・77件の表示は改修前と完全一致**すること（回帰基準）。
- スマホ挙動（既定リスト・ドット表示）、公開版の更新UI非表示、noindex は維持。

## 6. 取り込み要件（ingest / serve）

- `ingest.py`: `--ward <wardId>` を追加。`data/centers/<ward>.json` を読み、`data/events/<ward>.json` へ書き出す。`--center <id>` は ward 内での単館差し替え。**ward 指定必須**（全区一括は禁止＝無料枠保護）。
- 館別マージ保持・429/503再試行・スロットル・曜日表・URL月判定は現行のまま。
- `serve.py /api/ingest`: body `{apiKey, ward, center?}`。ward 必須。
- `eval.py`: centers の探索を `data/centers/*.json` 横断に変更（正解データの置き場・形式は不変）。
- **Claude直読運用**（推奨・正確）: 「〇〇区の予定を更新して」→ 担当セッションが各館PDFを読み `data/events/<ward>.json` を直接生成。本書 §8.3 の品質基準に従う。

## 7. 段階的ロールアウト

### P0: アーキテクチャ改修（担当: **Opus**）
1. `wards.json` 新設（23区全メタ。covered は edogawa/koto のみ）
2. 既存 centers.json → `centers/edogawa.json`(8館) と `centers/koto.json`(minamisuna) に分割
3. 既存 events.json → `events/edogawa.json` と `events/koto.json` に分割（generatedAt/mode は両方に複製）
4. 旧2ファイル削除、app.js/ingest.py/serve.py/eval.py/README を新構成に対応
5. §5 のUI要件を実装
6. 受け入れ: §9.1

### P1: パイロット区 = 江東区フル整備（担当: **Sonnet**、§8のワークパッケージ初回実行）
- 江東区の児童館（区内約18館）＋区運営の子育てひろばを `centers/koto.json` に追記（minamisuna は id/color 維持）。
- 受け入れ: §9.2

### P2以降: 残り21区（担当: **Sonnet**、1〜3区ずつ§8を反復）
- 推奨順: 隣接区から（墨田→葛飾→中央→台東→…）。各区完了ごとにPR。

## 8. ワークパッケージ「1区追加」手順書（Sonnet向け・反復用）

**入力**: wardId（§4.2）。**出力**: `data/centers/<wardId>.json` ＋ `wards.json` の該当区を `covered` に更新。

1. 区公式サイト（`city.<ward>.tokyo.jp` 等）から**児童館・子育てひろばの一覧**を収集（名称・住所・公式ページURL）。民間委託館は運営サイトも可。
2. 各館の**月間予定の掲載場所**を特定し `pdfUrl` に設定：
   - PDF直リンクがあればそれ（月替わりURLなら**予定表一覧ページ**のURLで良い＝取り込み時に自動解決）
   - HTML表のみの館はそのページURL
   - `sourcePage` は人間が見る予定表ページ、`officialUrl` は館トップ
3. 座標: 丁目レベルの住所を Nominatim でジオコーディング（UA必須・**1リクエスト/秒**）。区外に落ちた座標は住所を見直す。
4. 検証（**全件必須**）:
   - `officialUrl` / `pdfUrl` が HTTP 200（curl、UA付き）
   - `ingest.py` の `fetch_source()` で全館 PDF/HTMLテキスト取得可
   - JSON valid・id 一意（`<wardId>-<slug>`）・color はパレット巡回
5. `wards.json` の該当区を `covered` に変更。
6. 報告: 館数、除外した施設と理由（例: 中高生専用）、fetch_source の形式内訳。

### 8.3 データ品質基準
- 施設種別: 乳幼児〜小学生向けの児童館・子育てひろばを対象。**中高生専用施設は除外**。
- **予定表が公開Webで取得できない施設は除外**（例: 要ログインのアプリ・会員サイトのみで配信 ＝ fetch_source 検証を満たせない）。除外したら報告に施設名と理由を残す（判例: 江東区の子ども家庭支援センター「みずべ」8か所は予定が認証アプリ限定のため除外 / 2026-07 Fable判定）。
- イベント整備（任意・別作業）: Claude直読で `events/<ward>.json` を作る場合、対象月・日付・時間・対象年齢をPDF原文に忠実に。曖昧な日付のものは載せない。

## 9. 受け入れ条件

### 9.1 P0（アーキテクチャ）
- [ ] 既存9館・77件が改修前と同一に表示（件数・色・詳細リンク・期間集約）
- [ ] 区チップで江東区を外す→南砂が地図/凡例/カレンダーから消える。再選択で戻る。リロード後も選択が維持される
- [ ] `events/` が無い区を covered にしても落ちない（空扱い＋状態バーに未取込表示）
- [ ] `python3 -m py_compile serve.py ingest/ingest.py ingest/eval.py` 成功、全JSON valid
- [ ] `ingest.py --ward edogawa` がキー無しでは「未設定」エラー、`fetch_source` は全館成功
- [ ] スマホ幅・PC幅の両方で console エラーなし
- [ ] `pages.yml` は**無変更**（`cp -r jidokan-calendar/. _site/` が data/ サブディレクトリを含むため対応不要）

### 9.2 P1（江東区）
- [ ] §8 の検証全件パス。館数・一覧を報告
- [ ] アプリで江東区を選択すると全館がマーカー表示・距離フィルタが機能

## 10. 作業分担とモデルルーティング

| 役割 | モデル | 作業 |
|---|---|---|
| 仕様策定・発注・受け入れ判定・マージ | **Fable** | 本書の維持、エージェント成果物の検証、コミット/PR |
| 難: アーキテクチャ改修・ingest改修・UI変更 | **Opus** | P0、および将来のスキーマ変更 |
| 定型: 区データ整備・README更新・軽微修正 | **Sonnet** | P1以降のワークパッケージ、文書更新 |

- 実装エージェントは**コミット・プッシュ・PR作成をしない**（Fableが検証後に行う）。
- 実装エージェントは本書に反する変更・スコープ外の変更をしない。疑問点は変更せず報告する。

## 11. 変更履歴
- v1.0: 初版（P0/P1定義、データ設計確定）
- v1.1: §8.3に非公開予定表施設の除外基準を追記（みずべ判定を判例化）
- v1.2: §5.1 区セレクタを折りたたみパネル化（要約ヒント付き）に更新
- v1.3: §5.5 お気に入り（⭐で保存・次回自動復元）を追加
