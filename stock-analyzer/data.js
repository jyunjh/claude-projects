/*
 * サンプル銘柄データ (Sample stock data)
 * ----------------------------------------------------
 * これは学習・デモ用のダミーデータです。実際の市場データではありません。
 * This is dummy data for learning/demo purposes only — NOT real market data.
 *
 * 後で無料API (Financial Modeling Prep / Alpha Vantage 等) に差し替えできるよう、
 * データ構造を実際のAPIに近い形にしています。
 *
 * 防衛セクターの数値は 2026年6月時点の公開情報を基にしたスナップショットです
 * (株価・PER・受注残など)。あくまで学習用の参考値です。
 */

const DATA_AS_OF = "2026-06"; // 防衛セクターデータの基準時点

const SAMPLE_STOCKS = {
  AAPL: {
    ticker: "AAPL",
    sectorKey: "tech",
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
    sectorKey: "staples",
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
    sectorKey: "healthcare",
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
    sectorKey: "tech",
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
    sectorKey: "healthcare",
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
    sectorKey: "tech",
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

  /* ---------- 防衛セクター (Defense) ---------- */
  LMT: {
    ticker: "LMT",
    sectorKey: "defense",
    name: { en: "Lockheed Martin", ja: "ロッキード・マーティン" },
    sector: { en: "Defense", ja: "防衛" },
    price: 493.6, // 2026-06-22
    fairValue: 570.0, // アナリスト目標 ~$625 を割り引いた保守的推定
    marketCap: 115,
    metrics: {
      pe: 23.9, forwardPe: 21.8, evEbitda: 15.1, pb: 18.5, psales: 1.6,
      divYield: 2.8, roe: 78.0, revenueGrowth: 3.0,
      grossMargin: 12.4, netMargin: 9.4, debtToEquity: 2.5, fcfYield: 5.0,
    },
    defense: { bookToBill: 1.00, backlogYears: 2.4, govRevenuePct: 73, internationalPct: 27, programConcentration: "high" },
    // 52週高値$692→$493と約29%下落 (弱気センチメント)
    sentiment: { analystRating: "Hold", sentimentScore: 45, shortInterest: 1.1 },
    criticalFactors: [
      { factor: { en: "F-35 program (orders & sustainment)", ja: "F-35プログラム (受注・維持整備)" }, impact: "high", probability: 75 },
      { factor: { en: "Missiles & hypersonics demand", ja: "ミサイル・極超音速の需要" }, impact: "high", probability: 70 },
      { factor: { en: "US/allied budget appropriations", ja: "米・同盟国の予算成立" }, impact: "high", probability: 80 },
    ],
  },
  RTX: {
    ticker: "RTX",
    sectorKey: "defense",
    name: { en: "RTX Corp. (Raytheon)", ja: "RTX (レイセオン)" },
    sector: { en: "Defense", ja: "防衛" },
    price: 187.0, // 2026-06-17
    fairValue: 195.0, // 高PERで上値は限定的との見方
    marketCap: 249,
    metrics: {
      pe: 34.6, forwardPe: 26.6, evEbitda: 18.5, pb: 3.0, psales: 3.0,
      divYield: 1.9, roe: 10.0, revenueGrowth: 8.2,
      grossMargin: 19.5, netMargin: 8.5, debtToEquity: 0.72, fcfYield: 3.5,
    },
    // 受注残高$271B (商業$162B/防衛$109B, 前年比+18.5%), Q1'26 book-to-bill 1.14
    defense: { bookToBill: 1.14, backlogYears: 3.3, govRevenuePct: 45, internationalPct: 43, programConcentration: "medium" },
    // 昨年+50%上昇、PER34.6と過熱気味 (強いセンチメント)
    sentiment: { analystRating: "Buy", sentimentScore: 75, shortInterest: 0.9 },
    criticalFactors: [
      { factor: { en: "Air-defense (Patriot/NASAMS) demand", ja: "防空システム (Patriot/NASAMS) 需要" }, impact: "high", probability: 78 },
      { factor: { en: "Commercial aero recovery (Pratt)", ja: "民間航空エンジンの回復 (Pratt)" }, impact: "medium", probability: 65 },
      { factor: { en: "GTF engine inspection costs", ja: "GTFエンジン検査コスト" }, impact: "medium", probability: 55 },
    ],
  },
  NOC: {
    ticker: "NOC",
    sectorKey: "defense",
    name: { en: "Northrop Grumman", ja: "ノースロップ・グラマン" },
    sector: { en: "Defense", ja: "防衛" },
    price: 507.5, // 2026-06-23
    fairValue: 600.0, // 記録的受注残・低PERで25%程度の割安との指摘
    marketCap: 74,
    metrics: {
      pe: 16.3, forwardPe: 15.0, evEbitda: 11.2, pb: 5.0, psales: 1.7,
      divYield: 1.77, roe: 28.0, revenueGrowth: 6.0,
      grossMargin: 20.1, netMargin: 9.2, debtToEquity: 0.95, fcfYield: 5.0,
    },
    // 記録的受注残$96B (売上2年超), B-21プログラム進行
    defense: { bookToBill: 1.00, backlogYears: 2.3, govRevenuePct: 84, internationalPct: 16, programConcentration: "high" },
    // 直近30日で-19% (好決算にもかかわらず売られ、割安・弱気センチメント=逆張り候補)
    sentiment: { analystRating: "Hold", sentimentScore: 38, shortInterest: 1.2 },
    criticalFactors: [
      { factor: { en: "B-21 Raider program ramp/margins", ja: "B-21レイダーの量産・採算" }, impact: "high", probability: 60 },
      { factor: { en: "Space systems growth", ja: "宇宙システムの成長" }, impact: "high", probability: 68 },
      { factor: { en: "High US-government concentration", ja: "米政府への高い依存" }, impact: "medium", probability: 70 },
    ],
  },
  GD: {
    ticker: "GD",
    sectorKey: "defense",
    name: { en: "General Dynamics", ja: "ゼネラル・ダイナミクス" },
    sector: { en: "Defense", ja: "防衛" },
    price: 339.2, // 2026-06-01
    fairValue: 365.0,
    marketCap: 91,
    metrics: {
      pe: 21.4, forwardPe: 19.0, evEbitda: 14.0, pb: 3.6, psales: 1.7,
      divYield: 1.94, roe: 18.5, revenueGrowth: 7.0,
      grossMargin: 15.5, netMargin: 8.5, debtToEquity: 0.27, fcfYield: 4.5,
    },
    // Q1'26 受注$26.6B, book-to-bill 2:1, 受注残$131B, 34年連続増配
    defense: { bookToBill: 1.30, backlogYears: 2.6, govRevenuePct: 66, internationalPct: 22, programConcentration: "medium" },
    sentiment: { analystRating: "Buy", sentimentScore: 62, shortInterest: 0.8 },
    criticalFactors: [
      { factor: { en: "Submarine (Columbia/Virginia) demand", ja: "潜水艦 (Columbia/Virginia) 需要" }, impact: "high", probability: 80 },
      { factor: { en: "Gulfstream business-jet cycle", ja: "ガルフストリーム機の需要サイクル" }, impact: "medium", probability: 60 },
      { factor: { en: "Combat systems (ground vehicles)", ja: "戦闘システム (地上車両)" }, impact: "medium", probability: 65 },
    ],
  },
};
