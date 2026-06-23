/*
 * サンプル銘柄データ (Sample stock data)
 * ----------------------------------------------------
 * これは学習・デモ用のダミーデータです。実際の市場データではありません。
 * This is dummy data for learning/demo purposes only — NOT real market data.
 *
 * 後で無料API (Financial Modeling Prep / Alpha Vantage 等) に差し替えできるよう、
 * データ構造を実際のAPIに近い形にしています。
 */

const SAMPLE_STOCKS = {
  AAPL: {
    ticker: "AAPL",
    name: { en: "Apple Inc.", ja: "アップル" },
    sector: { en: "Technology", ja: "テクノロジー" },
    price: 212.4,
    fairValue: 195.0, // 推定本源的価値 (intrinsic value estimate)
    marketCap: 3250, // 単位: 10億ドル (USD bn)
    metrics: {
      pe: 33.1, forwardPe: 30.2, evEbitda: 24.5, pb: 48.2, psales: 8.6,
      divYield: 0.45, roe: 147.0, revenueGrowth: 4.9,
      grossMargin: 46.2, netMargin: 26.3, debtToEquity: 1.45, fcfYield: 3.1,
    },
    sentiment: { analystRating: "Buy", sentimentScore: 78, shortInterest: 0.8 },
    criticalFactors: [
      { factor: { en: "iPhone upgrade cycle demand", ja: "iPhone買い替えサイクルの需要" }, impact: "high", probability: 65 },
      { factor: { en: "Services revenue growth", ja: "サービス部門の成長" }, impact: "high", probability: 80 },
      { factor: { en: "China market exposure", ja: "中国市場への依存" }, impact: "medium", probability: 55 },
    ],
  },
  KO: {
    ticker: "KO",
    name: { en: "Coca-Cola Co.", ja: "コカ・コーラ" },
    sector: { en: "Consumer Staples", ja: "生活必需品" },
    price: 62.1,
    fairValue: 68.0,
    marketCap: 268,
    metrics: {
      pe: 24.8, forwardPe: 22.1, evEbitda: 18.9, pb: 10.1, psales: 5.8,
      divYield: 3.1, roe: 39.5, revenueGrowth: 3.2,
      grossMargin: 59.5, netMargin: 22.8, debtToEquity: 1.6, fcfYield: 3.8,
    },
    sentiment: { analystRating: "Hold", sentimentScore: 52, shortInterest: 0.9 },
    criticalFactors: [
      { factor: { en: "Pricing power vs. volume", ja: "価格決定力 vs 数量" }, impact: "high", probability: 70 },
      { factor: { en: "Emerging market growth", ja: "新興国市場の成長" }, impact: "medium", probability: 60 },
      { factor: { en: "Health/sugar regulation trends", ja: "健康・砂糖規制の動向" }, impact: "medium", probability: 50 },
    ],
  },
  PFE: {
    ticker: "PFE",
    name: { en: "Pfizer Inc.", ja: "ファイザー" },
    sector: { en: "Healthcare", ja: "ヘルスケア" },
    price: 24.3,
    fairValue: 33.0,
    marketCap: 138,
    metrics: {
      pe: 11.2, forwardPe: 9.8, evEbitda: 8.1, pb: 1.6, psales: 2.3,
      divYield: 6.9, roe: 9.8, revenueGrowth: -1.5,
      grossMargin: 63.0, netMargin: 18.5, debtToEquity: 0.65, fcfYield: 7.2,
    },
    sentiment: { analystRating: "Hold", sentimentScore: 31, shortInterest: 1.4 },
    criticalFactors: [
      { factor: { en: "Post-COVID revenue normalization", ja: "コロナ後の売上正常化" }, impact: "high", probability: 75 },
      { factor: { en: "Pipeline / new drug approvals", ja: "新薬パイプラインの承認" }, impact: "high", probability: 50 },
      { factor: { en: "Patent cliff exposure", ja: "特許切れリスク" }, impact: "medium", probability: 60 },
    ],
  },
  INTC: {
    ticker: "INTC",
    name: { en: "Intel Corp.", ja: "インテル" },
    sector: { en: "Technology", ja: "テクノロジー" },
    price: 21.5,
    fairValue: 28.0,
    marketCap: 92,
    metrics: {
      pe: 0, forwardPe: 18.5, evEbitda: 9.2, pb: 0.9, psales: 1.7,
      divYield: 1.6, roe: -3.2, revenueGrowth: -2.1,
      grossMargin: 32.7, netMargin: -1.8, debtToEquity: 0.48, fcfYield: -2.0,
    },
    sentiment: { analystRating: "Sell", sentimentScore: 24, shortInterest: 3.2 },
    criticalFactors: [
      { factor: { en: "Foundry turnaround execution", ja: "ファウンドリ事業の立て直し" }, impact: "high", probability: 40 },
      { factor: { en: "Data center share vs. AMD/NVDA", ja: "データセンター市場シェア" }, impact: "high", probability: 45 },
      { factor: { en: "Government subsidy (CHIPS Act)", ja: "政府補助金 (CHIPS法)" }, impact: "medium", probability: 70 },
    ],
  },
  JNJ: {
    ticker: "JNJ",
    name: { en: "Johnson & Johnson", ja: "ジョンソン・エンド・ジョンソン" },
    sector: { en: "Healthcare", ja: "ヘルスケア" },
    price: 152.8,
    fairValue: 165.0,
    marketCap: 368,
    metrics: {
      pe: 22.4, forwardPe: 15.1, evEbitda: 13.5, pb: 5.4, psales: 4.3,
      divYield: 3.3, roe: 24.1, revenueGrowth: 4.3,
      grossMargin: 68.5, netMargin: 19.5, debtToEquity: 0.52, fcfYield: 4.5,
    },
    sentiment: { analystRating: "Buy", sentimentScore: 64, shortInterest: 0.7 },
    criticalFactors: [
      { factor: { en: "Litigation (talc) overhang", ja: "訴訟リスク (タルク)" }, impact: "high", probability: 55 },
      { factor: { en: "Pharma pipeline strength", ja: "医薬品パイプラインの強さ" }, impact: "high", probability: 70 },
      { factor: { en: "MedTech segment growth", ja: "医療機器部門の成長" }, impact: "medium", probability: 65 },
    ],
  },
  NVDA: {
    ticker: "NVDA",
    name: { en: "NVIDIA Corp.", ja: "エヌビディア" },
    sector: { en: "Technology", ja: "テクノロジー" },
    price: 134.7,
    fairValue: 110.0,
    marketCap: 3300,
    metrics: {
      pe: 55.3, forwardPe: 38.4, evEbitda: 48.0, pb: 52.1, psales: 28.5,
      divYield: 0.03, roe: 115.0, revenueGrowth: 122.0,
      grossMargin: 75.0, netMargin: 55.8, debtToEquity: 0.18, fcfYield: 1.6,
    },
    sentiment: { analystRating: "Strong Buy", sentimentScore: 92, shortInterest: 1.1 },
    criticalFactors: [
      { factor: { en: "AI datacenter capex durability", ja: "AIデータセンター投資の持続性" }, impact: "high", probability: 60 },
      { factor: { en: "Competition (custom silicon)", ja: "競争 (自社チップ化)" }, impact: "high", probability: 50 },
      { factor: { en: "Gross margin sustainability", ja: "粗利率の持続性" }, impact: "medium", probability: 55 },
    ],
  },
};
