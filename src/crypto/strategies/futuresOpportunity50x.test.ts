import { describe, expect, it } from "vitest";
import { chooseBestOpportunitySignal } from "./futuresOpportunity50x";
import type { CryptoSignal } from "../types";

function signal(overrides: Partial<CryptoSignal>): CryptoSignal {
  return {
    symbol: "BTCUSDT",
    action: "hold",
    score: 0,
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 104,
    orderQuoteQty: 20,
    reasons: ["test"],
    ...overrides
  };
}

describe("futures 50x opportunity selector", () => {
  it("selects the highest-score executable direction", () => {
    const selected = chooseBestOpportunitySignal([
      signal({ action: "buy", score: 91, reasons: ["long ok"] }),
      signal({ action: "sell", score: 96, reasons: ["short ok"] })
    ]);

    expect(selected.action).toBe("sell");
    expect(selected.score).toBe(96);
    expect(selected.reasons).toContain("50x opportunity selector picked sell score=96.0");
  });

  it("holds when neither direction is executable but keeps the strongest blocked reason", () => {
    const selected = chooseBestOpportunitySignal([
      signal({ action: "hold", score: 88, reasons: ["long blocked"] }),
      signal({ action: "hold", score: 93, reasons: ["short blocked"] })
    ]);

    expect(selected.action).toBe("hold");
    expect(selected.score).toBe(93);
    expect(selected.reasons).toContain("No executable 50x opportunity passed current long/short gates");
    expect(selected.reasons).toContain("short blocked");
  });
});