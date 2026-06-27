/*
 * メンター相談チャット (Mentor chat) — Anthropic Messages API
 * ----------------------------------------------------
 * 画面の分析結果を見ながら、熟練ファンドマネージャー役のClaudeに
 * 相談できる機能。投資哲学(長期・ファンダメンタル・コントラリアン)と
 * 添付フレームワーク(EPIC/ASPIRE/TIER/ENTER/ADViCE)に基づいて助言する。
 *
 * APIキーはブラウザの localStorage に保存(個人利用向け)。
 * ブラウザから直接 API を呼ぶため anthropic-dangerous-direct-browser-access を使用。
 * キー取得: https://console.anthropic.com/
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MENTOR_MODEL = "claude-opus-4-8";

function getAnthropicKey() {
  return (localStorage.getItem("anthropicKey") || "").trim();
}
function setAnthropicKey(k) {
  localStorage.setItem("anthropicKey", (k || "").trim());
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

/*
 * メッセージをストリーミング送信。
 * onDelta(text) でトークンが届くたびに、onDone() 完了時、onError(msg) で失敗時。
 */
async function streamMentorChat({ system, messages, onDelta, onDone, onError }) {
  const key = getAnthropicKey();
  if (!key) { onError("NO_KEY"); return; }

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MENTOR_MODEL,
        max_tokens: 2048,
        stream: true,
        system,
        messages,
      }),
    });

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error?.message || ""; } catch (e) { /* ignore */ }
      onError(`HTTP ${res.status}${detail ? " — " + detail : ""}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE は "\n\n" 区切り。行単位で data: を拾う。
      const parts = buffer.split("\n");
      buffer = parts.pop(); // 未完の行は次回へ
      for (const line of parts) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            onDelta(ev.delta.text);
          } else if (ev.type === "error") {
            onError(ev.error?.message || "stream error");
            return;
          }
        } catch (e) { /* 部分JSONは無視 */ }
      }
    }
    onDone();
  } catch (e) {
    onError(String(e && e.message ? e.message : e));
  }
}
