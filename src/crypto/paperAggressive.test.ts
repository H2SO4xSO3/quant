import { describe, expect, it } from "vitest";
import { createPaperAggressiveStrategy } from "./paperAggressive";
import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoSignal } from "./types";

function fixedStrategy(signal: CryptoSignal): CryptoStrategy {
  return {
    id: "base",
    label: "base",
    generateSignal: () => signal
  };
}

function holdSignal(overrides: Partial<CryptoSignal> = {}): CryptoSignal {
  return {
    symbol: "BNBUSDT",
    action: "hold",
    score: 100,
    entryPrice: 594,
    stopLoss: 588,
    takeProfit: 608,
    orderQuoteQty: 20,
    reasons: ["15m EMA trend is not bullish", "15m EMA gap -0.263% is below the 0.05% trend floor"],
    ...overrides
  };
}

describe("paper aggressive strategy", () => {
  it("keeps holding when the 15m trend is not bullish", () => {
    const strategy = createPaperAggressiveStrategy(fixedStrategy(holdSignal()), { minScore: 94 });

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).not.toContain("Paper aggressive override: tolerated lagging 15m trend confirmation for simulation only");
  });

  it("allows paper buys only for high-score setups with a small positive 15m gap lag", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          reasons: ["15m trend confirms the 5m signal", "15m EMA gap 0.024% is below the 0.05% trend floor"]
        })
      ),
      { minScore: 98 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("buy");
    expect(signal.reasons).toContain("Paper aggressive override: tolerated small positive 15m gap lag for simulation only");
  });

  it("keeps holding when the positive 15m gap lag is too weak", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          reasons: ["15m trend confirms the 5m signal", "15m EMA gap 0.010% is below the 0.05% trend floor"]
        })
      ),
      { minScore: 98 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).not.toContain("Paper aggressive override: tolerated small positive 15m gap lag for simulation only");
  });

  it("keeps holding when the base strategy blocks weak flow confirmation", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          reasons: [
            "15m trend confirms the 5m signal",
            "15m EMA gap 0.040% is below the 0.05% trend floor",
            "Entry lacks at least two bullish flow confirmations from footprint, large trades, and order book support"
          ]
        })
      ),
      { minScore: 98 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).not.toContain("Paper aggressive override: tolerated small positive 15m gap lag for simulation only");
  });

  it("keeps holding when the base strategy blocks chasing above value area", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          reasons: [
            "15m trend confirms the 5m signal",
            "15m EMA gap 0.040% is below the 0.05% trend floor",
            "Price is above value area; avoid chasing extension in EMA/VWAP trend mode"
          ]
        })
      ),
      { minScore: 98 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).not.toContain("Paper aggressive override: tolerated small positive 15m gap lag for simulation only");
  });

  it("keeps holding when the base strategy requires stronger bid support", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          reasons: [
            "15m trend confirms the 5m signal",
            "15m EMA gap 0.040% is below the 0.05% trend floor",
            "Order book does not show stronger bid support; avoid long entry"
          ]
        })
      ),
      { minScore: 98 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).not.toContain("Paper aggressive override: tolerated small positive 15m gap lag for simulation only");
  });

  it("keeps holding below the stricter paper score floor", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          score: 97.9,
          reasons: ["15m trend confirms the 5m signal", "15m EMA gap 0.024% is below the 0.05% trend floor"]
        })
      ),
      { minScore: 98 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
  });

  it("keeps holding when critical entry blockers are present", () => {
    const strategy = createPaperAggressiveStrategy(
      fixedStrategy(
        holdSignal({
          reasons: [
            "15m EMA trend is not bullish",
            "Price is not above VWAP",
            "Expected value -0.242% is below the 0.08% minimum after estimated costs"
          ]
        })
      ),
      { minScore: 94 }
    );

    const signal = strategy.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).not.toContain("Paper aggressive override: tolerated lagging 15m trend confirmation for simulation only");
  });
});
