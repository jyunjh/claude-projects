# US Stock Analyzer / 米国株アナライザー

長期・ファンダメンタル重視・コントラリアンの投資哲学に基づく、ブラウザで動く米国株分析ダッシュボードです。
A browser-based US stock analysis dashboard built around a long-term, fundamental, contrarian philosophy.

## 特徴 / Features

- 📊 **銘柄分析ダッシュボード** — 主要財務指標を一覧表示
- 💰 **バリュエーション** — 株価 vs 推定適正価値
- 🔄 **コントラリアン・シグナル** — 市場センチメントとファンダメンタルの乖離を可視化
- 🎯 **重要ファクター (EPIC)** — 各銘柄の Critical Factors を影響度・発生確率で整理
- 🛡️ **セクター特化分析** — セクター独自の市場環境と特化KPIで分析（現在は **防衛セクター** 対応）
- 📋 **グループ内 横比較** — 同セクター銘柄を一覧表で並べ、指標ごとに最良値を★でハイライト
- 📖 **見るべきポイント解説** — 各指標の見方を折りたたみで解説
- ✅ **投資判断** — 上記を総合した BUY / HOLD / AVOID
- 🌐 **日本語 / English** ワンクリック切り替え

### 防衛セクター特化 / Defense specialization

防衛銘柄（LMT / RTX / NOC / GD）を選ぶと、以下が追加表示されます：

- **セクター市場環境** — 国防予算・地政学的緊張・売上見通し・予算リスク等を追い風/逆風で評価
- **特化KPI** — 受注/売上比率 (Book-to-Bill)、受注残高(年)、政府向け売上比率、海外比率、主力プログラム集中度
- **見るべきポイント解説** — 防衛セクター特有の着眼点

## 使い方 / How to run

ビルド不要。ローカルサーバーで `index.html` を開くだけです。

```bash
cd stock-analyzer
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## データについて / About the data

現在は **サンプル（デモ）データ** を使用しています（`data.js`）。実際の市場データではありません。
データ構造は無料API（Financial Modeling Prep / Alpha Vantage 等）に差し替えやすい形にしてあります。

## ファイル構成 / Structure

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み |
| `styles.css` | スタイル |
| `data.js` | サンプル銘柄データ |
| `i18n.js` | 日本語/英語の翻訳 |
| `sectors.js` | セクター特化設定（市場環境・特化KPI・解説） |
| `app.js` | 分析ロジックと描画 |

## 免責 / Disclaimer

学習目的のデモです。投資助言ではありません。
Educational demo only. Not investment advice.
