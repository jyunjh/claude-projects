/*
 * バリュエーション・エンジン (Valuation engine)
 * ----------------------------------------------------
 * 添付フレームワーク 3.5 / 3.6 の手法をそのまま実装したもの。
 *
 *   価格目標 = 一株あたり指標 × (ピア倍率 × 相対倍率)
 *
 * 【アウトサイド・ビュー】機械が担当する部分。
 *   フレームワークいわく "We could almost let a computer do this ...
 *   it's important that we do this because it will remove some of the
 *   biases that naturally creep in"。
 *   同業ピア群(レファレンス・クラス)の倍率の中央値を、相対倍率 1.0 で当てる。
 *   = 「この銘柄はピア並みの評価に値する」という無色の出発点。
 *
 * 【インサイド・ビュー】人間が担当する部分。
 *   data.js の inside = { epsAdjust, relMultiple, note } で上書きする。
 *   - epsAdjust   … 収益力の補正 (1.10 = 実績比 +10%)
 *   - relMultiple … ピアに対するプレミアム/ディスカウント (1.10 = 10%割増)
 *   どちらも既定は 1.0。触らなければ純粋なアウトサイド・ビューのまま。
 *
 * 設計上の約束:
 * - 手書きの fairValue があれば、それが常に勝つ。機械は上書きしない。
 * - ピアが薄い(既定 5銘柄未満)ときは算出しない。レファレンス・クラスとして
 *   成立しないものから点推定を出すのは、推測を数字に見せかける行為なので。
 * - 算出できた方法が1つも無ければ null を返す。中立値でごまかさない。
 */

// レファレンス・クラスとして成立する最小のピア数
const MIN_PEERS = 5;

// 手法間の算出値がこの倍率を超えて開いたら警告する
const SPREAD_WARN = 1.5;

// 倍率の許容レンジ。赤字・異常値をピア統計から除く (中央値を歪めるため)
const MULTIPLE_BOUNDS = {
  pe: [0.5, 150],
  pb: [0.1, 40],
  psales: [0.05, 30],
};

/*
 * 採用する倍率法。フレームワーク 3.4 の「P/B・EV/Sales 等で相互チェックする」に対応。
 * perShare: 1株あたりの基礎数値 = 株価 ÷ 倍率
 * EV/EBITDA と配当利回り法は、無料枠で EBITDA が取れないため未実装。
 */
const VALUATION_METHODS = [
  { key: "pe", labelKey: "methodPe" },
  { key: "pb", labelKey: "methodPb" },
  { key: "psales", labelKey: "methodPs" },
];

const isFiniteNum = (n) => typeof n === "number" && isFinite(n);

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 四分位 (レファレンス・クラスの「幅」を見せるため。点推定だけを信じさせない)
function quartiles(nums) {
  if (nums.length < 4) return { q1: null, q3: null };
  const s = nums.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { q1: at(0.25), q3: at(0.75) };
}

/*
 * 倍率法の妥当性を左右するファンダメンタルズ。
 * ここがピアから大きく外れている銘柄に同じ倍率を当てるのは誤り
 * (フレームワーク 3.3 が挙げる multiples-based の限界そのもの)。
 * 倍率ごとに、理論上どのドライバーが効くかを紐づけておく。
 */
const QUALITY_DRIVERS = [
  { key: "roe", methodKey: "pb", tolerance: 0.4 },          // P/B ↔ ROE
  { key: "netMargin", methodKey: "psales", tolerance: 0.4 }, // P/S ↔ 利益率
  { key: "revenueGrowth", methodKey: "pe", tolerance: 0.5 }, // P/E ↔ 成長
];

/*
 * ピア群から倍率ごとの統計を作る。
 * peers は「合成後の銘柄」でよいが、fairValue には依存しない (循環を避けるため)。
 */
function buildPeerStats(peers, selfTicker) {
  const stats = {};
  QUALITY_DRIVERS.forEach(({ key }) => {
    const vals = peers
      .filter((p) => p.ticker !== selfTicker)
      .map((p) => p.metrics && p.metrics[key])
      .filter(isFiniteNum);
    stats[key] = { median: median(vals), n: vals.length };
  });
  VALUATION_METHODS.forEach(({ key }) => {
    const [lo, hi] = MULTIPLE_BOUNDS[key];
    const vals = peers
      .filter((p) => p.ticker !== selfTicker) // 自分自身は含めない
      .map((p) => p.metrics && p.metrics[key])
      .filter((v) => isFiniteNum(v) && v >= lo && v <= hi);
    stats[key] = Object.assign({ median: median(vals), n: vals.length }, quartiles(vals));
  });
  return stats;
}

/*
 * 1銘柄の適正価値を算出する。
 * 戻り値:
 *   null                      … 算出条件を満たさない (ピア不足・素材不足)
 *   { fairValue, methods, ... } … 算出できた
 */
function computeFairValue(stock, peerStats, inside) {
  if (stock.price == null) return null;

  const epsAdjust = inside && isFiniteNum(inside.epsAdjust) ? inside.epsAdjust : 1;
  const relMultiple = inside && isFiniteNum(inside.relMultiple) ? inside.relMultiple : 1;

  const methods = [];
  VALUATION_METHODS.forEach(({ key, labelKey }) => {
    const own = stock.metrics && stock.metrics[key];
    const st = peerStats[key];
    const [lo, hi] = MULTIPLE_BOUNDS[key];
    // 自社の倍率が無い/異常 = 1株あたりの基礎数値が出せない (赤字銘柄のPER等)
    if (!isFiniteNum(own) || own < lo || own > hi) return;
    if (!st || st.median == null || st.n < MIN_PEERS) return;

    const perShare = (stock.price / own) * epsAdjust; // EPS / BPS / SPS
    const multiple = st.median * relMultiple;
    methods.push({
      key,
      labelKey,
      perShare: Math.round(perShare * 1000) / 1000,
      peerMultiple: Math.round(st.median * 100) / 100,
      multiple: Math.round(multiple * 100) / 100,
      peerN: st.n,
      q1: st.q1,
      q3: st.q3,
      value: Math.round(perShare * multiple * 100) / 100,
    });
  });

  if (!methods.length) return null;

  // 相互チェック: 各法の中央値を採用し、幅も一緒に見せる
  const values = methods.map((m) => m.value);
  const lowV = Math.min.apply(null, values);
  const highV = Math.max.apply(null, values);
  const caveats = qualityCaveats(stock, peerStats);
  // 手法どうしが大きく食い違う = どれか(あるいは全部)が的外れ。
  // 個別のドライバー検査に引っかからなくても、この乖離自体が警告になる。
  if (methods.length > 1 && lowV > 0 && highV / lowV > SPREAD_WARN) {
    caveats.unshift({ dir: "spread", ratio: Math.round((highV / lowV) * 100) / 100 });
  }
  return {
    fairValue: Math.round(median(values) * 100) / 100,
    low: Math.round(lowV * 100) / 100,
    high: Math.round(highV * 100) / 100,
    methods,
    epsAdjust,
    relMultiple,
    // 市場が現在この銘柄に当てている相対倍率 (プレミアム/ディスカウントの実勢)
    marketRelative: impliedRelative(stock, peerStats),
    // ピア倍率をそのまま当ててよいかの警告
    caveats,
  };
}

/*
 * 「この銘柄にピアの倍率を当ててよいか」の検査。
 *
 * 例: 純利益率 5.7% の会社に、中央値 8.8% のピア群の P/S を当てれば
 * 当然「割安」に出る。それは発見ではなく、方法の誤用。
 * 差が閾値を超えたら、どの方法がどちら向きに歪むかを明示する。
 * 数字を補正して隠すのではなく、警告として見せる。
 */
function qualityCaveats(stock, peerStats) {
  const out = [];
  QUALITY_DRIVERS.forEach(({ key, methodKey, tolerance }) => {
    const own = stock.metrics && stock.metrics[key];
    const st = peerStats[key];
    if (!isFiniteNum(own) || !st || st.median == null || st.n < MIN_PEERS) return;
    if (Math.abs(st.median) < 1e-9) return;

    const gap = own / st.median - 1;
    if (own < 0) {
      // 赤字・マイナスROE。倍率法が成立しない領域。
      out.push({ driver: key, method: methodKey, dir: "negative", own, peer: st.median });
    } else if (Math.abs(gap) > tolerance) {
      // 質が低い → 割安に出すぎる / 質が高い → 割高に出すぎる
      out.push({ driver: key, method: methodKey, dir: gap < 0 ? "below" : "above", own, peer: st.median, gap: Math.round(gap * 100) });
    }
  });
  return out;
}

/*
 * 市場が今この銘柄に付けている「ピア対比の倍率」。
 * 1.0 未満 = ピアより安く評価されている = コントラリアンの入口。
 * フレームワーク 3.6 の「相対倍率」を、実勢として可視化するためのもの。
 */
function impliedRelative(stock, peerStats) {
  const ratios = [];
  VALUATION_METHODS.forEach(({ key }) => {
    const own = stock.metrics && stock.metrics[key];
    const st = peerStats[key];
    const [lo, hi] = MULTIPLE_BOUNDS[key];
    if (!isFiniteNum(own) || own < lo || own > hi) return;
    if (!st || !st.median || st.n < MIN_PEERS) return;
    ratios.push(own / st.median);
  });
  const m = median(ratios);
  return m == null ? null : Math.round(m * 100) / 100;
}
