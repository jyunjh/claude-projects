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

    // Comparison view
    viewDetail: "Detail",
    viewCompare: "Compare ⇄",
    compareTitle: "Side-by-Side Comparison",
    compareMetric: "Metric",
    compareBestHint: "★ = best value in the group for that metric (green).",
    upsideShort: "Upside",
    recShort: "Verdict",

    // Live data update
    refresh: "Update to latest",
    refreshing: "Updating…",
    dataSample: "Sample data",
    dataLive: "Live · updated {time}",
    dataPartial: "Live (partial) · {time}",
    dataError: "Update failed — showing sample",
    apiSettings: "API settings",
    apiKeyPlaceholder: "Paste your free API key",
    saveKey: "Save",
    getKey: "Get a free key ↗",
    keySaved: "API key saved",
    noKeyMsg: "Enter a free API key, then press Update.",
    liveNote: "Live update covers price & valuation multiples. Fair value, sentiment and critical factors stay your own estimates.",

    // Price chart
    priceChart: "Price Chart (1Y)",
    chartSample: "illustrative sample series",
    chartLive: "live history",
    chartHigh: "High",
    chartLow: "Low",
    chartFairValue: "Fair value",

    // Mentor chat
    mentorTitle: "Mentor — Senior Portfolio Manager",
    mentorSub: "Discuss this analysis in real time. Coaching grounded in long-term, fundamental, contrarian principles (EPIC / valuation cross-check / TIER).",
    chatPlaceholder: "Ask about this stock… e.g. \"Is this a real contrarian setup?\"",
    chatSend: "Send",
    chatThinking: "Thinking…",
    chatWelcome: "I'm looking at the same analysis you are. What would you like to think through — the valuation, the contrarian read, or what to research next?",
    chatNoKey: "Add a free Google AI Studio (Gemini) API key in ⚙️ AI settings, then ask.",
    chatError: "Couldn't reach the model",
    aiSettings: "AI settings (Google AI Studio · Gemini key — free)",
    aiKeyPlaceholder: "Paste your Gemini API key (AIza…)",
    aiGetKey: "Get a free key ↗",
    mentorDisclaimer: "Educational coaching on sample/snapshot data. Not investment advice.",
    chatSuggest1: "Is this a genuine contrarian buy?",
    chatSuggest2: "What are the biggest risks to the thesis?",
    chatSuggest3: "What should I research next?",

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

    // Comparison view
    viewDetail: "個別分析",
    viewCompare: "横比較 ⇄",
    compareTitle: "グループ内 横比較",
    compareMetric: "指標",
    compareBestHint: "★ = その指標でグループ内ベストの値 (緑)。",
    upsideShort: "上昇余地",
    recShort: "判定",

    // Live data update
    refresh: "最新に更新",
    refreshing: "更新中…",
    dataSample: "サンプルデータ",
    dataLive: "最新 · {time} 更新",
    dataPartial: "最新(一部) · {time}",
    dataError: "更新失敗 — サンプル表示",
    apiSettings: "API設定",
    apiKeyPlaceholder: "無料APIキーを貼り付け",
    saveKey: "保存",
    getKey: "無料キーを取得 ↗",
    keySaved: "APIキーを保存しました",
    noKeyMsg: "無料APIキーを入力してから「更新」を押してください。",
    liveNote: "最新更新の対象は株価とバリュエーション指標です。適正価値・センチメント・重要ファクターはあなた自身の推定値のまま保持されます。",

    // Price chart
    priceChart: "株価チャート（1年）",
    chartSample: "サンプル系列（説明用）",
    chartLive: "実データ",
    chartHigh: "高値",
    chartLow: "安値",
    chartFairValue: "適正価値",

    // Mentor chat
    mentorTitle: "メンター相談（熟練ポートフォリオマネージャー）",
    mentorSub: "この分析を見ながらリアルタイムで相談できます。長期・ファンダメンタル・コントラリアン（EPIC / バリュエーション相互チェック / TIER）に基づく指導。",
    chatPlaceholder: "この銘柄について質問…例:「これは本物の逆張り局面？」",
    chatSend: "送信",
    chatThinking: "考え中…",
    chatWelcome: "あなたと同じ分析画面を見ています。何を深掘りしましょうか — バリュエーション、コントラリアン判定、それとも次に調べるべきこと？",
    chatNoKey: "⚙️ AI設定 に Google AI Studio (Gemini) の無料APIキーを登録してから質問してください。",
    chatError: "モデルに接続できませんでした",
    aiSettings: "AI設定（Google AI Studio · Gemini キー — 無料）",
    aiKeyPlaceholder: "Gemini APIキーを貼り付け (AIza…)",
    aiGetKey: "無料キーを取得 ↗",
    mentorDisclaimer: "サンプル/スナップショットデータに基づく学習用の指導です。投資助言ではありません。",
    chatSuggest1: "これは本物の逆張り買い場？",
    chatSuggest2: "この投資仮説の最大のリスクは？",
    chatSuggest3: "次に何を調べるべき？",

    langButton: "English",
  },
};
