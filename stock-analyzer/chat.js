/*
 * メンター相談チャット (Mentor chat) — Google AI Studio (Gemini API)
 * ----------------------------------------------------
 * 画面の分析結果を見ながら、熟練ファンドマネージャー役のAIに
 * 相談できる機能。投資哲学(長期・ファンダメンタル・コントラリアン)と
 * 添付フレームワーク(EPIC/ASPIRE/TIER/ENTER/ADViCE)に基づいて助言する。
 *
 * モデル戦略:
 *   - 通常は高品質な gemini-2.5-flash を優先利用。
 *   - 無料枠の上限(429)に当たったら gemini-2.5-flash-lite に自動フォールバックし、
 *     チャットに切り替えを通知。flash が回復したら自動で flash 優先に戻す。
 *
 * Gemini API は無料枠が手厚く、カード登録不要で使えるため採用。
 * APIキーはブラウザの localStorage に保存(個人利用向け)。
 * キー取得(無料): https://aistudio.google.com/apikey
 */

const PRIMARY_MODEL = "gemini-2.5-flash";       // 優先(高品質)
const FALLBACK_MODEL = "gemini-2.5-flash-lite"; // 上限時のフォールバック(無料枠が大きい)

// flash が429になったら一定時間 lite を使い、cooldown 経過後に flash を再試行する。
let flashCooldownUntil = 0; // この時刻まで flash をスキップ
let flashFailStreak = 0;    // 連続失敗数 (バックオフ用)

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
}
function shortName(model) {
  return model.replace("gemini-2.5-", ""); // "flash" / "flash-lite"
}

function getAiKey() {
  return (localStorage.getItem("geminiKey") || "").trim();
}
function setAiKey(k) {
  localStorage.setItem("geminiKey", (k || "").trim());
}

// メンターのシステムプロンプト。現在の画面分析(contextText)を埋め込む。
function mentorSystemPrompt(lang, contextText) {
  const langLine = lang === "ja"
    ? "回答は必ず自然な日本語で行うこと。専門用語には簡潔な補足を添える。"
    : "Always respond in clear English.";

  return `You are a seasoned equity portfolio manager with 25+ years of experience, now mentoring a promising junior analyst. You coach with the warmth and rigor of a master teaching a talented protégé: you push them to think for themselves, point out what they are missing, and are concrete and candid rather than vague or flattering.

YOUR INVESTMENT PHILOSOPHY (apply it consistently):
- Long-term horizon. You care about the durability of the business over years, not quarters.
- Fundamental first. Price is what you pay; value is what you get. Anchor on intrinsic value, cash flows, returns on capital, balance-sheet strength.
- Contrarian. The best opportunities appear when the crowd is wrong — when sentiment is weak but fundamentals are sound (or the reverse). You respect the gap between market sentiment and fundamentals.

ANALYTICAL FRAMEWORKS you teach and reference by name when relevant:
- EPIC — identify and monitor a stock's Critical Factors (the few variables that actually move the thesis), assess each factor's impact and probability.
- ASPIRE — cultivate differentiated, sustainable sources of insight; seek information asymmetry, live sources, primary research.
- Valuation cross-check — no single multiple is sufficient. Compare P/E, EV/EBITDA, P/B, P/Sales, dividend yield, and DCF against the stock's own history and peers; know each method's pros and cons.
- TIER — a checklist discipline for making accurate, well-reasoned stock recommendations.
- ENTER / ADViCE — how to communicate a stock call so it is differentiated, clear, and decision-useful.

HOW TO COACH:
- Ground your advice in the on-screen analysis below. Refer to the specific numbers ("your EV/EBITDA of X vs the sector...", "the sentiment-fundamental gap of Y suggests...").
- When the junior asks a question, give a real answer AND teach the reasoning, so they can do it themselves next time. Ask a sharpening question back when it helps them think.
- Separate market price (a fact) from intrinsic value (their judgment). Challenge weak assumptions. Name the 2-3 things they should research next.
- Be concise and practical — a few tight paragraphs or a short list, not an essay. Don't hedge into uselessness.
- ${langLine}

This is an educational coaching tool using sample/snapshot data. Make clear when something is your reasoning vs. a fact, and never present this as personalized investment advice.

--- CURRENT ON-SCREEN ANALYSIS (the stock the analyst is looking at right now) ---
${contextText}`;
}

// 1モデルにストリーミング送信。{ ok, status?, message? } を返す。
async function streamOnce(model, key, body, onDelta) {
  const res = await fetch(`${geminiUrl(model)}?alt=sse&key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch (e) { /* ignore */ }
    return { ok: false, status: res.status, message: `HTTP ${res.status}${detail ? " — " + detail : ""}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop(); // 未完の行は次回へ
    for (const line of parts) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (!data) continue;
      try {
        const chunk = JSON.parse(data);
        const text = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (text) onDelta(text);
      } catch (e) { /* 部分JSONは無視 */ }
    }
  }
  return { ok: true };
}

/*
 * メッセージを送信。flash優先 → 429ならlite自動フォールバック → flash回復で自動復帰。
 * onDelta(text), onDone(), onError(msg), onNotice(type, a, b) コールバック。
 *   onNotice("switch", from, to) … flashが上限でliteに切替
 *   onNotice("recovered", model) … flashが回復して優先利用に復帰
 */
async function streamMentorChat({ system, messages, onDelta, onDone, onError, onNotice }) {
  const key = getAiKey();
  if (!key) { onError("NO_KEY"); return; }

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  });

  try {
    const cooldownActive = Date.now() < flashCooldownUntil;

    // 1) cooldown中でなければ flash を試す
    if (!cooldownActive) {
      const r = await streamOnce(PRIMARY_MODEL, key, body, onDelta);
      if (r.ok) {
        if (flashFailStreak > 0 && onNotice) onNotice("recovered", shortName(PRIMARY_MODEL));
        flashFailStreak = 0;
        flashCooldownUntil = 0;
        onDone();
        return;
      }
      if (r.status === 429) {
        // 上限: バックオフして cooldown を設定し、lite にフォールバック
        flashFailStreak++;
        const cd = Math.min(60_000 * 2 ** (flashFailStreak - 1), 30 * 60_000); // 1分→…→最大30分
        flashCooldownUntil = Date.now() + cd;
        if (onNotice) onNotice("switch", shortName(PRIMARY_MODEL), shortName(FALLBACK_MODEL));
        // フォールバックへ続行
      } else {
        onError(r.message); // 429以外のflashエラーはフォールバックしない
        return;
      }
    }

    // 2) フォールバック(lite)
    const r2 = await streamOnce(FALLBACK_MODEL, key, body, onDelta);
    if (r2.ok) { onDone(); return; }
    onError(r2.message);
  } catch (e) {
    onError(String(e && e.message ? e.message : e));
  }
}
