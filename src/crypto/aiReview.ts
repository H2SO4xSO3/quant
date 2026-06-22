import type { AiReviewConfig, AiTradeReview, CryptoSignal } from "./types";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function jsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI review did not return JSON");
  }
  return JSON.parse(match[0]);
}

function normalizeReview(value: unknown): AiTradeReview {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const decision = record.decision === "approve" ? "approve" : "veto";
  const confidence = clamp(Number(record.confidence ?? 0));
  const reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : "No AI reason returned";
  const riskTags = Array.isArray(record.riskTags)
    ? record.riskTags.filter((item): item is string => typeof item === "string").slice(0, 6)
    : [];
  return { decision, confidence, reason, riskTags };
}

function baseUrl(config: AiReviewConfig): string {
  return config.baseUrl.replace(/\/+$/, "");
}

export async function reviewSignalWithAi(config: AiReviewConfig, signal: CryptoSignal, fetchImpl: typeof fetch = fetch): Promise<AiTradeReview> {
  if (!config.apiKey) {
    throw new Error("AI_REVIEW_ENABLED is true but DEEPSEEK_API_KEY or AI_REVIEW_API_KEY is missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl(config)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "You are a conservative spot-crypto trade reviewer. You cannot force a buy. Return JSON only: {\"decision\":\"approve|veto\",\"confidence\":0-1,\"reason\":\"short reason\",\"riskTags\":[\"tag\"]}. Approve only if the deterministic signal is clean, not overextended, and the reward after fees is worth the risk."
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Review this deterministic Binance spot long signal. Veto if uncertain.",
              signal: {
                symbol: signal.symbol,
                score: signal.score,
                entryPrice: signal.entryPrice,
                stopLoss: signal.stopLoss,
                takeProfit: signal.takeProfit,
                orderQuoteQty: signal.orderQuoteQty,
                reasons: signal.reasons.slice(0, 16)
              }
            })
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        temperature: 0
      })
    });

    if (!response.ok) {
      throw new Error(`AI review request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI review response was empty");
    }
    return normalizeReview(jsonFromContent(content));
  } finally {
    clearTimeout(timeout);
  }
}
