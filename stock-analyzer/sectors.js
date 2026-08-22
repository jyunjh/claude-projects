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
    icon: "🛡️",
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
  aerospace: {
    icon: "✈️",
    name: { en: "Aerospace Aftermarket", ja: "航空アフターマーケット" },

    /* このセクターを分析する前提となる「独自の市場環境」 */
    environment: [
      {
        key: "installedBase",
        label: { en: "Installed Base & Flight Hours", ja: "搭載機数とフライト時間" },
        status: "tailwind",
        reading: { en: "Aftermarket revenue tracks flight hours, not new orders", ja: "アフターマーケット売上は新規受注でなくフライト時間に連動" },
        why: {
          en: "Once a part is on the aircraft, it generates spares and repair revenue for the airframe's 25-30 year life. This is the 'blades' annuity — far more stable and higher-margin than OEM shipments.",
          ja: "一度機体に搭載されれば、その機体の25〜30年の寿命にわたりスペア・修理売上を生む。これが「替刃」のannuityで、OEM出荷より遥かに安定し高採算。",
        },
      },
      {
        key: "certification",
        label: { en: "Certification Barrier", ja: "型式証明の参入障壁" },
        status: "tailwind",
        reading: { en: "Sole-source positions locked in at type certification", ja: "初期型式証明時に設計へ組み込まれ sole-source が固定化" },
        why: {
          en: "Displacing an incumbent part requires re-certification — millions of dollars and years of work — for a component that may be a rounding error in the aircraft's cost. Economically irrational to switch. This is the real moat, not brand or scale.",
          ja: "既存部品の置換には数百万ドルと年単位の再認証が必要。機体コスト比では誤差レベルの部品にそこまでする経済合理性がない。ブランドや規模ではなく、これこそが本当の堀。",
        },
      },
      {
        key: "fleetAging",
        label: { en: "OEM Delivery Delays", ja: "新造機の納入遅延" },
        status: "tailwind",
        reading: { en: "Older fleet flying longer → more spares demand", ja: "旧型機の運用長期化 → スペア需要増" },
        why: {
          en: "When new aircraft are delayed, airlines fly existing fleets harder and longer. That is directly accretive to aftermarket volumes — a headwind for OEM-levered suppliers is a tailwind for blade owners.",
          ja: "新造機が遅延すると航空会社は既存機を酷使・長期運用する。これはアフターマーケット数量に直結。OEM依存企業には逆風でも、替刃保有者には追い風。",
        },
      },
      {
        key: "consolidation",
        label: { en: "PE / Strategic Consolidation", ja: "PE・事業会社による再編" },
        status: "headwind",
        reading: { en: "Small-cap IP holders nearly extinct on public markets", ja: "小型のIP保有上場企業がほぼ消滅" },
        why: {
          en: "Aerojet→L3Harris, Circor→KKR, Kaman→Arcline, Barnes→Apollo, Triumph→Warburg/Berkshire. Private equity has been buying this exact profile, lifting sector multiples and shrinking the listed universe. The key question for any remaining name: why has it NOT been taken out?",
          ja: "Aerojet→L3Harris、Circor→KKR、Kaman→Arcline、Barnes→Apollo、Triumph→Warburg/Berkshire。PEがまさにこのプロファイルを買い漁り、業界マルチプルを押し上げ上場ユニバースを縮小させた。残存銘柄への問いは「なぜまだ買われていないのか」。",
        },
      },
      {
        key: "misclassification",
        label: { en: "Classification Gap", ja: "市場の分類ギャップ" },
        status: "neutral",
        reading: { en: "Some IP holders sit inside 'industrials' buckets", ja: "一部のIP保有者が「産業機械」に分類されている" },
        why: {
          en: "Where the aftermarket annuity is buried inside a diversified industrial segment mix, the market may price the whole company on industrial multiples. Separating the aerospace segment's aftermarket economics from the industrial noise is where the mispricing lives.",
          ja: "アフターマーケットのannuityが多角化した産業セグメントに埋もれていると、市場は全社を産業機械のマルチプルで評価しうる。航空セグメントのアフターマーケット採算を産業ノイズから分離することにこそ、価格の歪みが宿る。",
        },
      },
    ],

    /* 航空アフターマーケット特化のKPI */
    kpis: [
      { key: "aftermarketPct", label: { en: "Aftermarket mix", ja: "アフターマーケット比率" }, unit: "%", good: (v) => v >= 50, bad: (v) => v < 25 },
      { key: "proprietaryPct", label: { en: "Proprietary / sole-source", ja: "自社IP・sole-source比率" }, unit: "%", good: (v) => v >= 60, bad: (v) => v < 30 },
      { key: "ipStrength", label: { en: "IP strength", ja: "IP強度" }, unit: "tag", good: null, bad: null },
      { key: "certMoat", label: { en: "Certification moat", ja: "型式証明の障壁" }, unit: "tag", good: null, bad: null },
      { key: "coverage", label: { en: "Analyst coverage", ja: "アナリストカバレッジ" }, unit: "i18n", good: null, bad: null },
      { key: "model", label: { en: "Business model", ja: "ビジネスモデル区分" }, unit: "i18n", good: null, bad: null },
    ],

    /* 見るべきポイント */
    guide: [
      {
        term: { en: "Razor and Blades", ja: "剃刀と替刃 (Razor and Blades)" },
        desc: {
          en: "The razor (OEM shipment) is often sold at thin or negative margin to win the platform slot. The blades (spares, repairs, overhaul) carry the profit for decades. Judge these companies on the blade stream, not on OEM revenue growth.",
          ja: "剃刀（OEM出荷）はプラットフォームの座を取るため薄利・逆ざやで売られることも多い。利益は数十年にわたる替刃（スペア・修理・オーバーホール）が生む。OEM売上の成長率ではなく、替刃の流れで評価する。",
        },
      },
      {
        term: { en: "Aftermarket mix", ja: "アフターマーケット比率" },
        desc: {
          en: "Share of revenue from spares and services rather than new-build shipments. Above ~50% the business behaves like an annuity: less cyclical, structurally higher margin. This single number separates Model A from a supplier that merely ships parts.",
          ja: "新造機向け出荷ではなくスペア・サービスから得る売上比率。おおむね50%超でannuity的な性格になり、循環性が下がり構造的に高採算。この一つの数字が、モデルAと単なる部品供給者を分ける。",
        },
      },
      {
        term: { en: "Proprietary / sole-source share", ja: "自社IP・sole-source比率" },
        desc: {
          en: "The fraction of products the company designed and owns rights to, versus build-to-print work made to a customer's drawings. Build-to-print has no pricing power — the customer owns the IP and can re-bid it. Ask what the company's own definition of 'proprietary' is; it varies by issuer.",
          ja: "顧客図面どおりに作る受託製造(build-to-print)ではなく、自社が設計し権利を持つ製品の比率。build-to-printに価格決定力はない（IPは顧客のもので、再入札されうる）。なお「proprietary」の定義は企業ごとに異なるので、必ず自社定義を確認すること。",
        },
      },
      {
        term: { en: "Type certificate, STC and PMA", ja: "型式証明・STC・PMA" },
        desc: {
          en: "Owning an STC (Supplemental Type Certificate) or PMA means holding a regulatory asset, not just a factory. It confers the legal right to sell that part or modification — a durable, transferable moat that a low-cost manufacturer cannot replicate by cutting price.",
          ja: "STC（追加型式証明）やPMAの保有は、工場ではなく「規制上の資産」を持つということ。その部品・改修を販売する法的権利であり、低コスト業者が値下げで模倣できない、持続的かつ譲渡可能な堀になる。",
        },
      },
      {
        term: { en: "Content per shipset", ja: "1機あたり搭載金額 (content per shipset)" },
        desc: {
          en: "The dollar value the company captures on each aircraft built. Growth can be organic (winning more slots on a new platform) or inorganic (buying an adjacent product line — sometimes handed over as an antitrust remedy in someone else's merger). Rising content compounds the future blade stream.",
          ja: "1機の製造あたりに獲得する金額。成長は有機的（新プラットフォームでの採用枠拡大）にも無機的（隣接製品ラインの買収。他社M&Aの独禁対応で売却された事業を拾う場合もある）にも起こる。搭載金額の増加は将来の替刃流列を複利で膨らませる。",
        },
      },
      {
        term: { en: "Where the misclassification hides", ja: "誤分類はどこに潜むか" },
        desc: {
          en: "If the aerospace unit is one segment among industrial businesses, screens and indices may bucket the whole company as 'industrials'. Rebuild the segment P&L yourself: aerospace OEM vs aftermarket revenue split, and the margin gap between them. If the gap is wide and durable, the market is paying an industrial multiple for an annuity.",
          ja: "航空部門が産業事業の一セグメントに過ぎない場合、スクリーニングや指数は全社を「産業機械」として扱いうる。自分でセグメントP/Lを組み直すこと — 航空のOEM／アフターマーケット売上構成と、その利益率の差。差が大きく持続的なら、市場はannuityに産業機械のマルチプルしか払っていない。",
        },
      },
      {
        term: { en: "Why is it still listed?", ja: "なぜまだ買収されていないのか" },
        desc: {
          en: "Given how aggressively private equity has bought this profile, any small-cap IP holder still trading publicly deserves the question. Legitimate answers exist — controlled/dual-class ownership, family control, size below a sponsor's threshold, or an unresolved issue. An answer you cannot find is itself a red flag.",
          ja: "PEがこのプロファイルを買い漁った事実を踏まえれば、いまだ上場している小型IP保有者には必ずこの問いを立てるべき。正当な理由もある（種類株・創業家支配、スポンサーの検討下限を下回る規模、未解決の懸案など）。答えが見つからないこと自体が危険信号。",
        },
      },
    ],
  },
};
