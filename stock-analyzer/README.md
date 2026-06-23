# US Stock Analyzer / 米国株アナライザー

長期・ファンダメンタル重視・コントラリアンの投資哲学に基づく、ブラウザで動く米国株分析ダッシュボードです。
A browser-based US stock analysis dashboard built around a long-term, fundamental, contrarian philosophy.

## 特徴 / Features

- 📊 **銘柄分析ダッシュボード** — 主要財務指標を一覧表示
- 💰 **バリュエーション** — 株価 vs 推定適正価値
- 🔄 **コントラリアン・シグナル** — 市場センチメントとファンダメンタルの乖離を可視化
- 🎯 **重要ファクター (EPIC)** — 各銘柄の Critical Factors を影響度・発生確率で整理
- ✅ **投資判断** — 上記を総合した BUY / HOLD / AVOID
- 🌐 **日本語 / English** ワンクリック切り替え

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
| `app.js` | 分析ロジックと描画 |

## 免責 / Disclaimer

学習目的のデモです。投資助言ではありません。
Educational demo only. Not investment advice.
