import { describe, expect, it } from "vitest";
import { reviewSignalWithAi } from "./aiReview";

const signal = {
  symbol: "BTCUSDT",
  action: "buy" as const,
  score: 96,
  entryPrice: 100,
  stopLoss: 98.8,
  takeProfit: 103,
  orderQuoteQty: 10,
  reasons: ["5m EMA trend is bullish", "15m trend confirms the 5m signal"]
};

describe("AI trade review", () => {
  it("parses a conservative JSON review from an OpenAI-compatible endpoint", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ decision: "veto", confidence: 0.8, reason: "weak continuation", riskTags: ["weak_trend"] }) } }]
        }),
        { status: 200 }
      );
    };

    const review = await reviewSignalWithAi(
      { enabled: true, apiKey: "local-test-key", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", timeoutMs: 1000 },
      signal,
      fetchImpl
    );

    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(review.decision).toBe("veto");
    expect(review.confidence).toBe(0.8);
    expect(review.riskTags).toEqual(["weak_trend"]);
  });
});
