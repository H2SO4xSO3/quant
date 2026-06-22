import { describe, expect, it } from "vitest";
import { evaluateRisk } from "./risk";

const baseSignal = {
  symbol: "BTCUSDT",
  action: "buy" as const,
  score: 80,
  entryPrice: 100,
  stopLoss: 98,
  takeProfit: 104,
  orderQuoteQty: 5,
  reasons: ["price above vwap"]
};

describe("crypto risk manager", () => {
  it("blocks live trading unless explicitly enabled", () => {
    const decision = evaluateRisk(baseSignal, { liveTrading: false, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }, []);

    expect(decision.allowed).toBe(false);
    expect(decision.mode).toBe("dry_run");
  });

  it("blocks oversized orders, daily loss breach and duplicate exposure", () => {
    expect(
      evaluateRisk({ ...baseSignal, orderQuoteQty: 7 }, { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }, [])
        .allowed
    ).toBe(false);
    expect(
      evaluateRisk(baseSignal, { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }, [
        { symbol: "ETHUSDT", side: "SELL", realizedPnlUsdt: -2.1, timestamp: new Date().toISOString() }
      ]).allowed
    ).toBe(false);
    expect(
      evaluateRisk(baseSignal, { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }, [
        { symbol: "BTCUSDT", side: "BUY", realizedPnlUsdt: 0, open: true, timestamp: new Date().toISOString() }
      ]).allowed
    ).toBe(false);
  });

  it("allows small live spot orders when all hard limits pass", () => {
    const decision = evaluateRisk(baseSignal, { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }, []);

    expect(decision.allowed).toBe(true);
    expect(decision.mode).toBe("live");
  });
});
