/*
 * セクター特化設定 (Sector-specific configuration)
 * ----------------------------------------------------
 * セクターごとに「独自の市場環境」「特化KPI」「見るべきポイント解説」を定義します。
 * 現在は防衛 (defense) セクターに特化。今後、他セクターをここに追加できます。
 */

/* どのセクターにも共通する基本指標の見方 (common guide) */
const COMMON_GUIDE = [
  {
    term: { en: "P/E (Price/Earnings)", ja: "PER (株価収益率)" },
    desc: {
      en: "Price relative to earnings. Lower can mean cheaper — but always compare to the company's own history and peers, not in isolation.",
      ja: "利益に対する株価の倍率。低いほど割安の可能性があるが、単独ではなく過去や同業との比較で見ること。",
    },
  },
  {
    term: { en: "FCF Yield (Free Cash Flow)", ja: "FCF利回り (フリーCF)" },
    desc: {
      en: "Free cash flow per dollar of market value. High and stable FCF is the lifeblood of long-term, fundamental investing.",
      ja: "時価総額に対する純現金創出力。高く安定したFCFは、長期・ファンダメンタル投資の生命線。",
    },
  },
  {
    term: { en: "Contrarian gap", ja: "コントラリアンの乖離" },
    desc: {
      en: "When market sentiment is weak but fundamentals are solid, the crowd may be wrong — the core of contrarian investing.",
      ja: "センチメントが弱いのにファンダメンタルが堅調なとき、市場が間違っている可能性がある。逆張りの核心。",
    },
  },
];

const SECTORS = {
  defense: {
    name: { en: "Defense", ja: "防衛" },

    /* この銘柄群を分析するうえで前提となる「独自の市場環境」 */
    environment: [
      {
        key: "budget",
        label: { en: "US Defense Budget", ja: "米国防予算" },
        status: "tailwind",
        reading: { en: "Record NDAA, growing ~3–5%/yr", ja: "過去最大級のNDAA、年率約3〜5%増" },
        why: {
          en: "Defense revenue ultimately tracks government appropriations. A rising, bipartisan budget underpins multi-year demand.",
          ja: "防衛企業の売上は最終的に政府予算に連動する。超党派で増額傾向の予算は数年単位の需要を下支えする。",
        },
      },
      {
        key: "geopolitics",
        label: { en: "Geopolitical Tension", ja: "地政学的緊張" },
        status: "tailwind",
        reading: { en: "Elevated (Europe, Middle East, Indo-Pacific)", ja: "高水準 (欧州・中東・インド太平洋)" },
        why: {
          en: "Conflicts and rearmament drive replenishment orders and allied foreign military sales (FMS).",
          ja: "紛争や再軍備は、補充発注や同盟国向け対外有償軍事援助 (FMS) を押し上げる。",
        },
      },
      {
        key: "visibility",
        label: { en: "Revenue Visibility", ja: "売上の見通し" },
        status: "tailwind",
        reading: { en: "Multi-year programs, large backlogs", ja: "複数年プログラム・潤沢な受注残" },
        why: {
          en: "Long program cycles (10–30 yrs) and big backlogs make revenue unusually predictable vs. other sectors.",
          ja: "10〜30年に及ぶ長期プログラムと大きな受注残により、他セクターより売上が予測しやすい。",
        },
      },
      {
        key: "policy",
        label: { en: "Budget / Shutdown Risk", ja: "予算・政府閉鎖リスク" },
        status: "headwind",
        reading: { en: "Continuing resolutions can delay programs", ja: "暫定予算でプログラムが遅延しうる" },
        why: {
          en: "Government shutdowns and continuing resolutions can delay contract awards and payments.",
          ja: "政府閉鎖や暫定予算 (CR) は、契約授与や支払いを遅らせることがある。",
        },
      },
      {
        key: "valuation",
        label: { en: "Sector Valuation", ja: "セクターの評価" },
        status: "neutral",
        reading: { en: "Re-rated higher after 2022", ja: "2022年以降に水準訂正で上昇" },
        why: {
          en: "Strong demand has pushed multiples up — entry price discipline matters more now (contrarian caution).",
          ja: "需要の強さで倍率が上昇済み。今は買値の規律がより重要 (逆張りの観点で要注意)。",
        },
      },
    ],

    /* 防衛セクター特化のKPI (per-stock の defense ブロックを表示) */
    kpis: [
      { key: "bookToBill", label: { en: "Book-to-Bill", ja: "受注/売上比率 (B2B)" }, unit: "x", good: (v) => v >= 1.0, bad: (v) => v < 0.9 },
      { key: "backlogYears", label: { en: "Backlog (years)", ja: "受注残高 (年)" }, unit: "y", good: (v) => v >= 2.5, bad: (v) => v < 1.5 },
      { key: "govRevenuePct", label: { en: "Gov't Revenue", ja: "政府向け売上比率" }, unit: "%", good: null, bad: null },
      { key: "internationalPct", label: { en: "International", ja: "海外売上比率" }, unit: "%", good: (v) => v >= 25, bad: null },
      { key: "programConcentration", label: { en: "Program Concentration", ja: "主力プログラム集中度" }, unit: "tag", good: null, bad: null },
    ],

    /* 防衛セクターで「見るべきポイント」の解説 */
    guide: [
      {
        term: { en: "Book-to-Bill ratio", ja: "受注/売上比率 (Book-to-Bill)" },
        desc: {
          en: "New orders divided by revenue. Above 1.0 means the order book is growing faster than sales — future revenue is building. Below 1.0 is a warning sign.",
          ja: "新規受注 ÷ 売上。1.0超なら受注が売上を上回って積み上がり、将来の売上が育っている。1.0未満は警戒サイン。",
        },
      },
      {
        term: { en: "Backlog (years of revenue)", ja: "受注残高 (売上の何年分か)" },
        desc: {
          en: "Contracted-but-not-yet-delivered work, expressed as years of revenue. Larger backlogs give visibility and downside protection.",
          ja: "契約済みで未納入の仕事量を、売上の何年分かで表したもの。大きいほど見通しが立ち、下値抵抗になる。",
        },
      },
      {
        term: { en: "Government revenue dependency", ja: "政府向け売上への依存度" },
        desc: {
          en: "High government exposure means stable demand but also budget/political risk. Watch for over-reliance on a single customer or country.",
          ja: "政府依存が高いと需要は安定するが、予算・政治リスクも背負う。単一顧客・単一国への偏りに注意。",
        },
      },
      {
        term: { en: "Program concentration", ja: "主力プログラム集中度" },
        desc: {
          en: "How dependent the company is on one flagship program (e.g. F-35). High concentration raises risk if that program is cut or delayed.",
          ja: "F-35のような単一の主力プログラムへの依存度。集中が高いと、その削減・遅延時のリスクが大きい。",
        },
      },
      {
        term: { en: "International / FMS mix", ja: "海外・FMS 比率" },
        desc: {
          en: "Foreign Military Sales diversify away from a single national budget and often carry attractive margins. Rising allied defense spending is a tailwind.",
          ja: "対外有償軍事援助 (FMS) は単一国予算への依存を分散し、利益率も良いことが多い。同盟国の防衛費増は追い風。",
        },
      },
      {
        term: { en: "Free cash flow conversion", ja: "FCF転換率" },
        desc: {
          en: "Long programs can tie up cash in working capital. Check that reported profit actually converts into free cash flow over time.",
          ja: "長期プログラムは運転資本に資金を寝かせやすい。利益が時間をかけて実際にFCFへ変わっているか確認する。",
        },
      },
    ],
  },
};
