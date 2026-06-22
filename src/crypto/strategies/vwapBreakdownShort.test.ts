import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { vwapBreakdownShortStrategy } from "./vwapBreakdownShort";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 99.4,
    vwap: 100,
    priceVsVwapPct: -0.6,
    volatilityPct: 0.8,
    trend: {
      emaFast: 99.2,
      emaSlow: 99.8,
      emaTrend: 100.4,
      emaFastSlopePct: -0.08,
      higherEmaFast: 99.8,
      higherEmaSlow: 100.1,
      rsi: 44,
      atr: 0.35,
      atrPct: 0.35,
      trend: "bearish",
      higherTrend: "neutral"
    },
    technical: {
      volumeRatio: 1.18,
      recentReturn6Pct: -0.42,
      closePosition: 0.24,
      lowerWickPct: 0.03,
      upperWickPct: 0.14,
      candleBodyPct: 0.22
    },
    volumeProfile: {
      pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
      valueAreaLow: 99.6,
      valueAreaHigh: 101.2,
      currentPricePosition: "below_value"
    },
    footprint: { buyVolume: 36, sellVolume: 64, buySellImbalance: -0.28 },
    deepTrades: { largeTradeCount: 5, largeTradeBuyRatio: 0.34, score: 0.34 },
    liquidity: { bidWallPrice: 99.1, askWallPrice: 99.5, bidAskImbalance: -0.2, nearestAskDistancePct: 0.1 },
    reasons: [],
    ...overrides
  };
}

describe("VWAP breakdown short strategy", () => {
  it("sells short when price loses VWAP/POC/value area with sell flow", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("sell");
    expect(signal.score).toBeGreaterThanOrEqual(90);
    expect(signal.stopLoss).toBeGreaterThan(signal.entryPrice);
    expect(signal.takeProfit).toBeLessThan(signal.entryPrice);
    expect(signal.reasons.join(" ")).toContain("VWAP breakdown short");
  });

  it("holds instead of shorting when price is still above VWAP", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis({ price: 100.4, priceVsVwapPct: 0.4 }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("has not lost VWAP");
  });

  it("holds when order book does not show ask pressure", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis({ liquidity: { bidWallPrice: 99.1, askWallPrice: 99.5, bidAskImbalance: 0.02, nearestAskDistancePct: 0.1 } }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("ask pressure");
  });

  it("holds when RSI is already too washed out for a fresh short", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis({ trend: { ...analysis().trend!, rsi: 25 } }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("RSI");
  });

  it("blocks BNB shorts after the paper review showed persistent symbol drag", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis({ symbol: "BNBUSDT" }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("BNBUSDT short is disabled");
  });

  it("requires BTC shorts to be below value area, not merely below POC inside value", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis({
        symbol: "BTCUSDT",
        volumeProfile: {
          pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
          valueAreaLow: 99.6,
          valueAreaHigh: 101.2,
          currentPricePosition: "inside_value"
        }
      }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("BTC short requires price below value area");
  });

  it("blocks shorts whose gross target does not cover three times estimated friction", () => {
    const signal = vwapBreakdownShortStrategy.generateSignal({
      analysis: analysis({ trend: { ...analysis().trend!, atr: 0.05, atrPct: 0.2 } }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, minTakeProfitPct: 0.1, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("3x estimated round-trip cost");
  });
});
