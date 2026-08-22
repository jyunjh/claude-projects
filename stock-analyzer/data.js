/*
 * サンプル銘柄データ (Sample stock data)
 * ----------------------------------------------------
 * これは学習・デモ用のダミーデータです。実際の市場データではありません。
 * This is dummy data for learning/demo purposes only — NOT real market data.
 *
 * 後で無料API (Financial Modeling Prep / Alpha Vantage 等) に差し替えできるよう、
 * データ構造を実際のAPIに近い形にしています。
 *
 * 防衛セクターの数値は 2026年8月時点の公開情報を基にしたスナップショットです
 * (株価・PER・受注残など)。あくまで学習用の参考値です。
 *
 * 航空アフターマーケットは調査由来のカバレッジ。事業構造・モデル分類は一次調査、
 * 株価/バリュエーションは意図的に null (推測で埋めず、APIから取得する方針)。
 */

const DATA_AS_OF = "2026-08"; // データの基準時点

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
    price: 598.75, // 2026-08-17
    fairValue: 615.0, // $493→$599と回復。逆張り妙味は縮小、適正圏に接近
    marketCap: 138,
    metrics: {
      pe: 22.4, forwardPe: 20.3, evEbitda: 15.5, pb: 18.5, psales: 1.7,
      divYield: 2.35, roe: 78.0, revenueGrowth: 3.5,
      grossMargin: 12.4, netMargin: 9.4, debtToEquity: 2.5, fcfYield: 4.6,
    },
    defense: { bookToBill: 1.02, backlogYears: 2.4, govRevenuePct: 73, internationalPct: 27, programConcentration: "high" },
    // 6月$493から約+21%回復し$599 (逆張りの好機はほぼ消化、センチメント改善)
    sentiment: { analystRating: "Hold", sentimentScore: 58, shortInterest: 1.0 },
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
    price: 223.25, // 2026-08-06 (8/10に最高値$226.88)
    fairValue: 232.0, // アナリスト平均目標は現値+4%程度と上値限定的
    marketCap: 299,
    metrics: {
      pe: 40.0, forwardPe: 30.0, evEbitda: 20.5, pb: 3.4, psales: 3.4,
      divYield: 1.8, roe: 10.5, revenueGrowth: 9.0,
      grossMargin: 19.5, netMargin: 8.7, debtToEquity: 0.70, fcfYield: 3.2,
    },
    // 記録的受注残$289B (防衛$119B, 前年比+22%), Tomahawk $22.9B受注
    defense: { bookToBill: 1.30, backlogYears: 3.4, govRevenuePct: 45, internationalPct: 43, programConcentration: "medium" },
    // 過去1年で+44%、最高値圏・PER40と過熱 (強いセンチメント=過熱トレード)
    sentiment: { analystRating: "Buy", sentimentScore: 82, shortInterest: 0.8 },
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
    price: 585.87, // 2026-08
    fairValue: 640.0, // アナリスト目標$645前後、PER18と依然割安
    marketCap: 84,
    metrics: {
      pe: 18.2, forwardPe: 16.5, evEbitda: 11.8, pb: 5.2, psales: 1.8,
      divYield: 1.55, roe: 28.0, revenueGrowth: 6.5,
      grossMargin: 20.1, netMargin: 9.2, debtToEquity: 0.95, fcfYield: 4.8,
    },
    // 記録的受注残$104.7B (売上2年超), B-21プログラム進行
    defense: { bookToBill: 1.05, backlogYears: 2.5, govRevenuePct: 84, internationalPct: 16, programConcentration: "high" },
    // 6月$507から$586へ回復。PER18・目標比+11%とバリュー妙味は残る
    sentiment: { analystRating: "Buy", sentimentScore: 55, shortInterest: 1.0 },
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
    price: 391.65, // 2026-08-17
    fairValue: 410.0,
    marketCap: 106,
    metrics: {
      pe: 24.1, forwardPe: 20.0, evEbitda: 14.6, pb: 3.8, psales: 1.8,
      divYield: 1.56, roe: 18.5, revenueGrowth: 7.5,
      grossMargin: 15.5, netMargin: 8.5, debtToEquity: 0.27, fcfYield: 4.3,
    },
    // Q2'26 記録的受注残$136.5B, 売上$14.1B, 通期ガイダンス引上げ, 34年連続増配
    defense: { bookToBill: 1.20, backlogYears: 2.6, govRevenuePct: 66, internationalPct: 22, programConcentration: "medium" },
    sentiment: { analystRating: "Buy", sentimentScore: 65, shortInterest: 0.8 },
    criticalFactors: [
      { factor: { en: "Submarine (Columbia/Virginia) demand", ja: "潜水艦 (Columbia/Virginia) 需要" }, impact: "high", probability: 80 },
      { factor: { en: "Gulfstream business-jet cycle", ja: "ガルフストリーム機の需要サイクル" }, impact: "medium", probability: 60 },
      { factor: { en: "Combat systems (ground vehicles)", ja: "戦闘システム (地上車両)" }, impact: "medium", probability: 65 },
    ],
  },
  /* ---------- 航空アフターマーケット (Aerospace Aftermarket) ----------
   * スクリーニング由来のカバレッジ。時価総額・事業構造・モデル分類は一次調査ベース。
   * 株価/バリュエーション指標は意図的に null(未取得) — 「🔄 最新に更新」でAPIから取得する。
   * fairValue はアナリスト自身の推定値。設定するまで投資判断は出さない設計。
   * proprietary/aftermarket 比率は企業側の定義に依存するため、10-Kで裏取りすること。
   */

  // === グループ1: 純粋なモデルA (市場も既に認識済み) ===
  TDG: {
    ticker: "TDG", sectorKey: "aerospace",
    name: { en: "TransDigm Group", ja: "トランスダイム" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 67.7,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: 90, ipStrength: "high", certMoat: "high", coverage: "covThick", model: "modelA" },
    thesis: {
      en: "The benchmark. ~90% of products are sole-source or limited-competition, designed into the airframe at initial type certification. Displacement costs millions and years of re-certification. Very large cap — the model is fully understood by the market.",
      ja: "基準点。製品の約90%がsole-sourceまたは限定競争で、初期型式証明時に機体設計へ組み込まれている。置換には数百万ドルと年単位の再認証が必要。ただし超大型で、モデルは市場に完全に理解されている。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 80, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Durability of sole-source pricing power", ja: "sole-source価格決定力の持続性" }, impact: "high", probability: 80 },
      { factor: { en: "M&A pipeline & capital deployment discipline", ja: "M&Aパイプラインと資本配分の規律" }, impact: "high", probability: 65 },
      { factor: { en: "Premium already embedded in valuation", ja: "既にバリュエーションに織り込まれたプレミアム" }, impact: "high", probability: 75 },
    ],
  },
  LOAR: {
    ticker: "LOAR", sectorKey: "aerospace",
    name: { en: "Loar Holdings", ja: "ロアー・ホールディングス" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 6.6,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: 50, proprietaryPct: 85, ipStrength: "high", certMoat: "high", coverage: "covMedium", model: "modelA" },
    thesis: {
      en: "~85% of the portfolio is self-designed, aftermarket mix above 50%, GAAP operating margin ~22%. Over 15,000 parts, so no single-product or single-platform dependence. The market already frames it as a 'small TransDigm' — so a cheap-quality-business argument is hard to make. The live question is M&A durability and post-deal integration, not valuation.",
      ja: "ポートフォリオの約85%が自社設計、アフターマーケット比率50%超、GAAP営業利益率約22%。15,000点超の部品を持ち単一製品・単一プラットフォーム依存がない。市場は既に「小型TransDigm」と認識しており、割安な優良ビジネスという主張は成立しにくい。論点はバリュエーションではなくM&Aの持続性と統合実績。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 78, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Sustainability of the M&A compounding engine", ja: "M&A複利マシンの持続性" }, impact: "high", probability: 70 },
      { factor: { en: "Post-acquisition integration track record", ja: "買収後の統合実績" }, impact: "high", probability: 65 },
      { factor: { en: "Rising deal multiples from PE competition", ja: "PEとの競合による買収マルチプル上昇" }, impact: "medium", probability: 70 },
    ],
  },

  // === グループ2: Misclassification候補 (本命) ===
  WWD: {
    ticker: "WWD", sectorKey: "aerospace",
    name: { en: "Woodward", ja: "ウッドワード" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 21.4,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "high", certMoat: "high", coverage: "covMedium", model: "modelA" },
    thesis: {
      en: "PRIMARY CANDIDATE. Fuel control and flight control — Model A economics, but classified with diversified industrials (power generation, engine control), which dilutes the aftermarket annuity in the reported mix. FY26 Q2 revenue $1.1B, +23% YoY. Also acquired Collins Aerospace's North American actuator unit — divested as an antitrust remedy in Safran's $1.8B purchase of the Collins flight-control business — i.e. inorganic content-per-shipset growth. The work: separate the aerospace segment's OEM vs aftermarket split and margin gap from the industrial noise.",
      ja: "本命候補。燃料制御・フライトコントロールというモデルAの経済性を持ちながら、多角化した産業機械（発電・エンジン制御）と同居して分類され、アフターマーケットのannuityが希薄化して見えている。FY26 Q2は売上11億ドル・前年比23%増。加えて、SafranによるCollinsフライトコントロール事業買収(18億ドル)の独禁対応として北米アクチュエーター部門を取得 — 無機的なcontent per shipset獲得。作業は、航空セグメントのOEM/アフターマーケット構成と利益率差を産業ノイズから分離すること。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 60, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Aerospace segment OEM vs aftermarket split (10-K work)", ja: "航空セグメントのOEM/アフターマーケット構成 (10-K作業)" }, impact: "high", probability: 70 },
      { factor: { en: "Segment margin gap = proof the razor/blades split is real", ja: "セグメント利益率差 = Razor and Bladesの実在確認" }, impact: "high", probability: 65 },
      { factor: { en: "Collins actuator deal impact on content per shipset", ja: "Collinsアクチュエーター取得のcontent per shipsetへの影響" }, impact: "high", probability: 60 },
      { factor: { en: "Industrial segment drag on the multiple", ja: "産業セグメントによるマルチプルの重石" }, impact: "medium", probability: 65 },
    ],
  },
  "MOG-A": {
    ticker: "MOG-A", sectorKey: "aerospace",
    name: { en: "Moog Inc. (Class A)", ja: "ムーグ (クラスA)" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 12.8,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "high", certMoat: "high", coverage: "covMedium", model: "modelA" },
    thesis: {
      en: "Precision actuation with genuine IP, but split across four segments (Space & Defense, Military Aircraft, Commercial Aircraft, Industrial). The commercial aircraft segment — where the aftermarket annuity would live — is the smaller share. Risk: owns the IP, but the 'blade' may not be big enough to drive the whole company.",
      ja: "精密アクチュエーションで実際にIPを保有するが、4セグメント（宇宙防衛・軍用機・商用機・産業）に分散。アフターマーケットのannuityが宿るはずの商用機セグメントの比率が小さい。リスクは「IPは保有するが刃の規模が足りない」可能性。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 55, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Commercial aircraft segment share of total", ja: "商用機セグメントの全体比率" }, impact: "high", probability: 70 },
      { factor: { en: "Is the blade large enough to move the company?", ja: "刃の規模が全社を動かすに足るか" }, impact: "high", probability: 60 },
      { factor: { en: "Dual-class structure and control", ja: "種類株構造と支配権" }, impact: "medium", probability: 55 },
    ],
  },
  CW: {
    ticker: "CW", sectorKey: "aerospace",
    name: { en: "Curtiss-Wright", ja: "カーチス・ライト" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 25.5,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "medium", certMoat: "medium", coverage: "covThick", model: "modelDiversified" },
    thesis: {
      en: "DOWNGRADED on inspection. Q2'26 Commercial Aerospace was $114M (+11%), but the growth driver is OEM revenue from narrowbody/widebody production ramp — not aftermarket annuity. In substance this is a nuclear and naval-defense conglomerate; the aerospace-aftermarket framing does not fit. Keep as a contrast case, not a candidate.",
      ja: "精査により降格。Q2\'26のCommercial Aerospaceは1.14億ドル(+11%)だが、成長ドライバーは狭胴・広胴の生産ランプアップによるOEM売上であり、アフターマーケットのannuityではない。実質は原子力・海軍防衛のコングロマリットで、航空アフターマーケットの枠組みに合わない。候補ではなく対照群として保持。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 65, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Nuclear / naval defense is the actual core", ja: "実際の主戦場は原子力・海軍防衛" }, impact: "high", probability: 85 },
      { factor: { en: "Commercial aero growth is OEM-led, not aftermarket", ja: "商用航空の成長はOEM主導でアフターマーケットではない" }, impact: "high", probability: 75 },
    ],
  },

  // === グループ3: 小型・カバレッジ空白 ===
  ATRO: {
    ticker: "ATRO", sectorKey: "aerospace",
    name: { en: "Astronics", ja: "アストロニクス" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 3.3,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "medium", certMoat: "medium", coverage: "covThin", model: "modelA" },
    thesis: {
      en: "Cabin power, lighting and avionics databus. Q2 revenue $260M, +27% YoY, beating consensus by 6% with full-year guidance raised; the stock rose 24.6% after the print. Small cap with thin coverage. The open question is IP strength: is the cabin-power position genuinely proprietary and aftermarket-generating, or is it competed content?",
      ja: "客室電源・照明・アビオニクスデータバス。Q2は売上2.6億ドル・前年比27%増でコンセンサスを6%上回り、通期ガイダンスも引き上げ。決算後に株価は24.6%上昇。小型でカバレッジが薄い。論点はIP強度 — 客室電源のポジションが本当にproprietaryでアフターマーケットを生むのか、それとも競争的コンテンツか。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 72, shortInterest: null },
    criticalFactors: [
      { factor: { en: "IP strength of the cabin-power position", ja: "客室電源ポジションのIP強度" }, impact: "high", probability: 60 },
      { factor: { en: "Aftermarket conversion of installed cabin content", ja: "搭載済み客室コンテンツのアフターマーケット化" }, impact: "high", probability: 60 },
      { factor: { en: "Post-earnings re-rating already banked", ja: "決算後の株価上昇で織り込み済みの部分" }, impact: "medium", probability: 70 },
    ],
  },
  ISSC: {
    ticker: "ISSC", sectorKey: "aerospace",
    name: { en: "Innovative Aerosystems", ja: "イノベーティブ・エアロシステムズ" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 0.36,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "high", certMoat: "high", coverage: "covThin", model: "modelA" },
    thesis: {
      en: "Formerly Innovative Solutions & Support. Avionics retrofit built on STCs the company owns itself — structurally an IP holder, since the STC is a regulatory asset conferring the right to sell the modification. Micro cap with almost no coverage. Liquidity is a real constraint.",
      ja: "旧Innovative Solutions & Support。自社保有のSTC（追加型式証明）に立脚したレトロフィット事業 — STCは改修販売権という規制上の資産であり、構造的にIP保有型。超小型でカバレッジはほぼ皆無。流動性が実際の制約。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 50, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Breadth and renewal of the owned STC portfolio", ja: "保有STCポートフォリオの幅と更新" }, impact: "high", probability: 65 },
      { factor: { en: "Micro-cap liquidity constraint", ja: "超小型ゆえの流動性制約" }, impact: "high", probability: 85 },
      { factor: { en: "Customer concentration", ja: "顧客集中度" }, impact: "medium", probability: 60 },
    ],
  },
  TATT: {
    ticker: "TATT", sectorKey: "aerospace",
    name: { en: "TAT Technologies", ja: "TATテクノロジーズ" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 0.52,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "low", certMoat: "medium", coverage: "covThin", model: "modelC" },
    thesis: {
      en: "MODEL UPGRADE IN PROGRESS. Historically Model B (build/repair to others' specs). In July 2026 it became the sole authorized global distributor of spare parts for Honeywell Aerospace's GTCP 331-200/250 APU platform and extended its MRO licence on that platform to 2036. It does not own the IP, but it now holds contractual exclusive access to someone else's IP — Model C. That is no longer a subcontractor. Micro cap, thin coverage, so an undervaluation case is easy to argue; liquidity is the offsetting problem.",
      ja: "モデル格上げの進行中。従来はモデルB（他社仕様での製造・修理）。2026年7月、Honeywell AerospaceのGTCP 331-200/250 APUプラットフォームのスペアパーツ唯一の正規グローバル販売代理店となり、同プラットフォームのMROライセンスを2036年まで延長。IPは持たないが、他社IPへの独占アクセス権を契約で獲得 = モデルC。もはや下請けではない。超小型・カバレッジ薄で過小評価は主張しやすいが、流動性が難点。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 48, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Durability of the Honeywell exclusive distributorship", ja: "Honeywell独占代理店契約の持続性" }, impact: "high", probability: 70 },
      { factor: { en: "GTCP 331 platform installed base and retirement curve", ja: "GTCP 331搭載機数と退役カーブ" }, impact: "high", probability: 65 },
      { factor: { en: "Contract renewal risk at 2036 licence expiry", ja: "2036年ライセンス期限での更新リスク" }, impact: "medium", probability: 55 },
      { factor: { en: "Micro-cap liquidity constraint", ja: "超小型ゆえの流動性制約" }, impact: "high", probability: 85 },
    ],
  },

  // === グループ4: 除外すべき「似て非なる」銘柄 (対照群) ===
  DCO: {
    ticker: "DCO", sectorKey: "aerospace",
    name: { en: "Ducommun", ja: "デュコモン" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 3.0,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "low", certMoat: "low", coverage: "covMedium", model: "modelB" },
    thesis: {
      en: "EXCLUDE. Structural parts and assemblies with a high build-to-print share — it manufactures to the customer's drawings, so the customer owns the IP and can re-bid the work. No pricing power, no blade. Model B.",
      ja: "除外。構造部品・アセンブリ中心でbuild-to-print比率が高い — 顧客図面どおりに製造するため、IPは顧客のもので再入札されうる。価格決定力も替刃もない。モデルB相当。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 55, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Build-to-print share = no IP ownership", ja: "build-to-print比率 = IP非保有" }, impact: "high", probability: 85 },
    ],
  },
  HXL: {
    ticker: "HXL", sectorKey: "aerospace",
    name: { en: "Hexcel", ja: "ヘクセル" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 7.8,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "medium", certMoat: "medium", coverage: "covThick", model: "modelMaterial" },
    thesis: {
      en: "EXCLUDE. Tier 4 composite materials. Structural material is not replaced during the aircraft's life, so there is no blade — revenue is levered to new-build rates, which is the opposite of the annuity profile being screened for.",
      ja: "除外。Tier 4の複合材。構造材は機体寿命中に交換されないため替刃にならない。売上は新造機レートに連動し、探しているannuityとは逆の性格。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 50, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Structural material is not replaced — no blade", ja: "構造材は交換されない = 刃にならない" }, impact: "high", probability: 90 },
    ],
  },
  PKE: {
    ticker: "PKE", sectorKey: "aerospace",
    name: { en: "Park Aerospace", ja: "パーク・エアロスペース" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 0.8,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "medium", certMoat: "low", coverage: "covThin", model: "modelMaterial" },
    thesis: {
      en: "EXCLUDE. Same structural logic as Hexcel — advanced materials, consumed at build, not replaced in service.",
      ja: "除外。ヘクセルと同じ構造的理由 — 先端素材であり製造時に消費され、就航後に交換されない。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 45, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Materials business — no aftermarket annuity", ja: "素材事業 — アフターマーケットannuityなし" }, impact: "high", probability: 90 },
    ],
  },
  MRCY: {
    ticker: "MRCY", sectorKey: "aerospace",
    name: { en: "Mercury Systems", ja: "マーキュリー・システムズ" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 6.5,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "high", certMoat: "medium", coverage: "covMedium", model: "modelDefenseEl" },
    thesis: {
      en: "EXCLUDE from this thesis. Defense electronics with genuine IP, but no commercial aftermarket annuity — defense programs are funded through procurement cycles rather than flight-hour-driven spares demand.",
      ja: "本仮説からは除外。防衛エレクトロニクスで実際にIPは持つが、商用アフターマーケットのannuityがない。防衛プログラムはフライト時間連動のスペア需要ではなく調達サイクルで賄われる。",
    },
    sentiment: { analystRating: "Hold", sentimentScore: 58, shortInterest: null },
    criticalFactors: [
      { factor: { en: "IP yes, but no commercial aftermarket annuity", ja: "IPはあるが商用アフターマーケットannuityがない" }, impact: "high", probability: 85 },
    ],
  },
  KRMN: {
    ticker: "KRMN", sectorKey: "aerospace",
    name: { en: "Karman Holdings", ja: "カーマン・ホールディングス" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 7.7,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "high", certMoat: "medium", coverage: "covMedium", model: "modelDefenseEl" },
    thesis: {
      en: "EXCLUDE from this thesis. Defense and space. Same reason as Mercury — the annuity is programme-funded, not flight-hour driven.",
      ja: "本仮説からは除外。防衛・宇宙。マーキュリーと同じ理由 — annuityはプログラム予算依存でフライト時間連動ではない。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 62, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Defense/space — no commercial flight-hour annuity", ja: "防衛・宇宙 — 商用フライト時間annuityがない" }, impact: "high", probability: 85 },
    ],
  },
  AIR: {
    ticker: "AIR", sectorKey: "aerospace",
    name: { en: "AAR Corp.", ja: "AARコーポレーション" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 5.6,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "low", certMoat: "low", coverage: "covThick", model: "modelC" },
    thesis: {
      en: "OUT OF SCOPE for the IP-holder thesis. Aftermarket services and parts distribution — genuinely exposed to flight hours, but as a service provider rather than an IP owner. Useful as a comparison for aftermarket demand, not as a razor-and-blades candidate.",
      ja: "IP保有者仮説の対象外。アフターマーケットのサービス・部品流通で、フライト時間には確かに連動するが、IP保有者ではなくサービス提供者。アフターマーケット需要の比較対象としては有用だが、Razor and Blades候補ではない。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 60, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Service provider, not IP owner", ja: "IP保有者ではなくサービス提供者" }, impact: "high", probability: 85 },
    ],
  },
  SARO: {
    ticker: "SARO", sectorKey: "aerospace",
    name: { en: "StandardAero", ja: "スタンダードエアロ" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 9.7,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "low", certMoat: "medium", coverage: "covThick", model: "modelC" },
    thesis: {
      en: "OUT OF SCOPE for the IP-holder thesis. Engine MRO at scale, operating under OEM licences. Model C — access rather than ownership. Relevant as an aftermarket-demand read-through.",
      ja: "IP保有者仮説の対象外。OEMライセンス下で運営される大規模エンジンMRO。モデルC（保有ではなくアクセス）。アフターマーケット需要の読み取りには有用。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 65, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Operates under OEM licence — access, not ownership", ja: "OEMライセンス下で運営 — 保有ではなくアクセス" }, impact: "high", probability: 80 },
    ],
  },
  VSEC: {
    ticker: "VSEC", sectorKey: "aerospace",
    name: { en: "VSE Corp.", ja: "VSEコーポレーション" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 6.1,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "low", certMoat: "low", coverage: "covMedium", model: "modelC" },
    thesis: {
      en: "OUT OF SCOPE for the IP-holder thesis. Aftermarket distribution and MRO. Model B/C economics — distribution margins, not proprietary pricing power.",
      ja: "IP保有者仮説の対象外。アフターマーケットの流通とMRO。モデルB/Cの経済性で、proprietaryな価格決定力ではなく流通マージン。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 60, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Distribution margins, not proprietary pricing power", ja: "流通マージンでありproprietaryな価格決定力ではない" }, impact: "high", probability: 80 },
    ],
  },

  // === 番外: 構造変化として見逃せない2社 ===
  HONA: {
    ticker: "HONA", sectorKey: "aerospace",
    name: { en: "Honeywell Aerospace", ja: "ハネウェル・エアロスペース" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 53.4,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "high", certMoat: "high", coverage: "covThin", model: "modelA" },
    thesis: {
      en: "STRUCTURAL EVENT. Now a separately listed aerospace pure-play. Large cap, but in a coverage-transition window: analysts who covered the conglomerate are re-initiating on a differently-shaped company, which is exactly when analytical gaps open. Note it is also the OEM whose APU IP TAT Technologies now distributes.",
      ja: "構造変化。航空単独の上場エンティティとして分離済み。大型だがカバレッジ移行期にあり、コングロマリットを担当していたアナリストが別形状の企業をカバー再開する局面 — まさに分析の空白が生じるタイミング。なお、TATが販売権を得たAPUのIP保有元でもある。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 60, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Coverage transition gap after separation", ja: "分離後のカバレッジ移行による空白" }, impact: "high", probability: 65 },
      { factor: { en: "Standalone aftermarket margin structure once disclosed", ja: "単独開示後のアフターマーケット採算構造" }, impact: "high", probability: 70 },
      { factor: { en: "Size limits the mispricing available", ja: "規模の大きさが歪みの余地を制約" }, impact: "medium", probability: 70 },
    ],
  },
  FTAI: {
    ticker: "FTAI", sectorKey: "aerospace",
    name: { en: "FTAI Aviation", ja: "FTAIアビエーション" },
    sector: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },
    price: null, fairValue: null, marketCap: 22.2,
    metrics: { pe: null, forwardPe: null, evEbitda: null, pb: null, psales: null, divYield: null, roe: null, revenueGrowth: null, grossMargin: null, netMargin: null, debtToEquity: null, fcfYield: null },
    aerospace: { aftermarketPct: null, proprietaryPct: null, ipStrength: "medium", certMoat: "medium", coverage: "covThick", model: "modelHybrid" },
    thesis: {
      en: "THE FIFTH MODEL. CFM56 module-swap business: rather than sending an engine through a full overhaul, modules are exchanged and cycled. This restructures the economics of the shop visit itself, so it does not fit the four-model taxonomy — a Model C/D hybrid. Analytically interesting but heavy: the accounting treatment and asset valuation debate is substantial work.",
      ja: "第5のモデル。CFM56のモジュール交換ビジネス — エンジンを丸ごとオーバーホールせず、モジュール単位で交換して回す。ショップビジットの経済性そのものを組み替えるため4分類の枠外にあり、モデルC/Dのハイブリッド。分析対象として面白いが、会計処理と資産評価の議論が重い。",
    },
    sentiment: { analystRating: "Buy", sentimentScore: 70, shortInterest: null },
    criticalFactors: [
      { factor: { en: "Accounting treatment and asset valuation", ja: "会計処理と資産評価" }, impact: "high", probability: 75 },
      { factor: { en: "Module-swap economics vs full overhaul", ja: "モジュール交換 vs 丸ごとオーバーホールの経済性" }, impact: "high", probability: 70 },
      { factor: { en: "CFM56 fleet retirement curve", ja: "CFM56搭載機の退役カーブ" }, impact: "high", probability: 65 },
    ],
  },
};
