/*
 * 多言語対応 (Internationalization) — 日本語 / English
 */

const I18N = {
  en: {
    appTitle: "US Stock Analyzer",
    appSubtitle: "Long-term · Fundamental · Contrarian",
    selectStock: "Select a stock",
    demoNotice: "Sample data based on public info as of {date} — for learning only, not investment advice.",

    // Sections
    overview: "Overview",
    valuation: "Valuation",
    contrarian: "Contrarian Signal",
    criticalFactors: "Critical Factors (EPIC)",
    recommendation: "Recommendation",

    // Overview labels
    price: "Price",
    fairValue: "Fair Value (est.)",
    marketCap: "Market Cap",
    sector: "Sector",

    // Metric labels
    pe: "P/E",
    forwardPe: "Forward P/E",
    evEbitda: "EV/EBITDA",
    pb: "P/B",
    psales: "P/Sales",
    divYield: "Dividend Yield",
    roe: "ROE",
    revenueGrowth: "Revenue Growth",
    grossMargin: "Gross Margin",
    netMargin: "Net Margin",
    debtToEquity: "Debt/Equity",
    fcfYield: "FCF Yield",

    // Valuation
    valuationIntro: "Multiple methods cross-check value. No single multiple is sufficient — compare against the stock's own history and peers.",
    upside: "Upside to fair value",
    downside: "Downside to fair value",
    overvalued: "Trading above estimated fair value",
    undervalued: "Trading below estimated fair value",
    fairlyValued: "Roughly fairly valued",

    // Contrarian
    marketSentiment: "Market Sentiment",
    fundamentalScore: "Fundamental Score",
    gap: "Sentiment vs. Fundamentals gap",
    contrarianBuy: "Contrarian opportunity: weak sentiment, solid fundamentals",
    crowdedTrade: "Crowded trade: strong sentiment, stretched fundamentals",
    aligned: "Sentiment and fundamentals broadly aligned",

    // Critical factors
    factor: "Factor",
    impact: "Impact",
    probability: "Probability",
    high: "High", medium: "Medium", low: "Low",

    // Recommendation
    recBuy: "BUY — undervalued with manageable risks",
    recHold: "HOLD — fairly valued or mixed signals",
    recAvoid: "AVOID — overvalued or deteriorating fundamentals",
    recDisclaimer: "Educational output based on sample data. Not investment advice.",

    // Sector specialization
    sectorFilter: "Sector",
    allSectors: "All sectors",
    sectorEnvironment: "Sector Environment",
    sectorKpis: "Sector KPIs",
    guide: "What to Look At",
    tailwind: "Tailwind",
    neutral: "Neutral",
    headwind: "Headwind",

    langButton: "日本語",
  },
  ja: {
    appTitle: "米国株アナライザー",
    appSubtitle: "長期 · ファンダメンタル · コントラリアン",
    selectStock: "銘柄を選択",
    demoNotice: "{date} 時点の公開情報を基にしたサンプルデータです — 学習目的のみ。投資助言ではありません。",

    overview: "概要",
    valuation: "バリュエーション",
    contrarian: "コントラリアン・シグナル",
    criticalFactors: "重要ファクター (EPIC)",
    recommendation: "投資判断",

    price: "株価",
    fairValue: "適正価値 (推定)",
    marketCap: "時価総額",
    sector: "セクター",

    pe: "PER",
    forwardPe: "予想PER",
    evEbitda: "EV/EBITDA",
    pb: "PBR",
    psales: "PSR",
    divYield: "配当利回り",
    roe: "ROE",
    revenueGrowth: "売上成長率",
    grossMargin: "粗利率",
    netMargin: "純利益率",
    debtToEquity: "負債資本比率",
    fcfYield: "FCF利回り",

    valuationIntro: "複数の手法で価値を相互チェックします。単一の指標だけでは不十分 — その銘柄の過去や同業他社と比較しましょう。",
    upside: "適正価値までの上昇余地",
    downside: "適正価値までの下落余地",
    overvalued: "推定適正価値より割高",
    undervalued: "推定適正価値より割安",
    fairlyValued: "概ね適正",

    marketSentiment: "市場センチメント",
    fundamentalScore: "ファンダメンタルスコア",
    gap: "センチメントとファンダメンタルの乖離",
    contrarianBuy: "逆張り好機: センチメントは弱いがファンダメンタルは堅調",
    crowdedTrade: "過熱トレード: センチメントは強いがファンダメンタルは割高",
    aligned: "センチメントとファンダメンタルは概ね一致",

    factor: "ファクター",
    impact: "影響度",
    probability: "発生確率",
    high: "高", medium: "中", low: "低",

    recBuy: "買い — 割安でリスクは管理可能",
    recHold: "中立 — 適正評価またはシグナルが混在",
    recAvoid: "回避 — 割高またはファンダメンタル悪化",
    recDisclaimer: "サンプルデータに基づく学習用の出力です。投資助言ではありません。",

    // Sector specialization
    sectorFilter: "セクター",
    allSectors: "全セクター",
    sectorEnvironment: "セクター市場環境",
    sectorKpis: "セクター特化指標",
    guide: "見るべきポイント解説",
    tailwind: "追い風",
    neutral: "中立",
    headwind: "逆風",

    langButton: "English",
  },
};
