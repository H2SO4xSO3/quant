import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { vwapPullbackReclaimStrategy } from "./vwapPullbackReclaim";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "SOLUSDT",
    price: 100.35,
    vwap: 100,
    priceVsVwapPct: 0.35,
    volatilityPct: 0.55,
    trend: {
      emaFast: 100.3,
      emaSlow: 100.1,
      emaTrend: 99.8,
      emaFastSlopePct: 0.04,
      higherEmaFast: 100.2,
      higherEmaSlow: 100,
      rsi: 56,
      atr: 0.28,
      atrPct: 0.28,
      trend: "bullish",
      higherTrend: "neutral"
    },
    technical: {
      volumeRatio: 1.12,
      recentReturn6Pct: -0.08,
      closePosition: 0.72,
      lowerWickPct: 0.11,
      upperWickPct: 0.03,
      candleBodyPct: 0.16
    },
    volumeProfile: {
      pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
      valueAreaLow: 99.4,
      valueAreaHigh: 101,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 62, sellVolume: 38, buySellImbalance: 0.24 },
    deepTrades: { largeTradeCount: 4, largeTradeBuyRatio: 0.64, score: 0.64 },
    liquidity: { bidWallPrice: 100.2, askWallPrice: 100.42, bidAskImbalance: 0.2, nearestAskDistancePct: 0.07 },
    reasons: [],
    ...overrides
  };
}

describe("VWAP pullback reclaim strategy", () => {
  it("buys a reclaimed VWAP/POC pullback with bid support and fresh buy flow", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    const risk = signal.entryPrice - signal.stopLoss;
    const reward = signal.takeProfit - signal.entryPrice;

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(90);
    expect(reward / risk).toBeCloseTo(2, 6);
    expect(signal.reasons.join(" ")).toContain("VWAP pullback reclaim");
  });

  it("holds instead of chasing above the value area", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis({
        price: 102.2,
        priceVsVwapPct: 2.2,
        volumeProfile: {
          pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
          valueAreaLow: 99.4,
          valueAreaHigh: 101,
          currentPricePosition: "above_value"
        }
      }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("above value area");
  });

  it("holds when price is too extended above VWAP for a reclaim entry", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis({ price: 101.15, priceVsVwapPct: 1.15 }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("too extended");
  });

  it("holds when the order book does not confirm bid support", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis({
        liquidity: { bidWallPrice: 100.2, askWallPrice: 100.42, bidAskImbalance: 0.03, nearestAskDistancePct: 0.07 }
      }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("bid support");
  });

  it("holds when RSI is overheated", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis({ trend: { ...analysis().trend!, rsi: 71 } }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("RSI");
  });

  it("holds when price has not reclaimed VWAP and POC", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis({ price: 99.85, priceVsVwapPct: -0.15 }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("has not reclaimed");
  });

  it("emits an explicit exit invalidation reason after a reclaim is lost", () => {
    const signal = vwapPullbackReclaimStrategy.generateSignal({
      analysis: analysis({ price: 99.85, priceVsVwapPct: -0.15 }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 90, takeProfitRiskMultiple: 2 }
    });

    expect(signal.score).toBeGreaterThan(DEFAULT_STRATEGY_CONFIG.signalExitScore);
    expect(signal.reasons.some((reason) => reason.startsWith("Exit invalidation:"))).toBe(true);
  });
});
