import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { factorLabelAltReboundStrategy } from "./factorLabelAltRebound";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "SOLUSDT",
    price: 80,
    vwap: 80.8,
    priceVsVwapPct: -1,
    volatilityPct: 2,
    trend: {
      emaFast: 79,
      emaSlow: 80.5,
      emaTrend: 82,
      emaFastSlopePct: -0.12,
      higherEmaFast: 83,
      higherEmaSlow: 84,
      rsi: 38,
      atr: 0.9,
      atrPct: 1.125,
      trend: "bearish",
      higherTrend: "bearish"
    },
    technical: {
      recentReturn6Pct: -0.9,
      volumeRatio: 1.25,
      lowerWickPct: 0.16,
      closePosition: 0.7,
      upperWickPct: 0.03,
      candleBodyPct: 0.2
    },
    volumeProfile: {
      pointOfControl: { price: 80.6, volume: 1, intensity: 1 },
      valueAreaLow: 78,
      valueAreaHigh: 83,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0 },
    deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.5, score: 0.5 },
    liquidity: { bidWallPrice: 79.9, askWallPrice: 80.03, bidAskImbalance: 0, nearestAskDistancePct: 0.04 },
    reasons: [],
    ...overrides
  };
}

describe("factor-label alt rebound strategy", () => {
  it("buys SOL/XRP when a selloff reclaims with volume and a lower wick", () => {
    const signal = factorLabelAltReboundStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(90);
    expect(signal.stopLoss).toBeCloseTo(79.2);
    expect(signal.takeProfit).toBeCloseTo(81.28);
    expect(signal.maxHoldingMinutes).toBe(240);
  });

  it("does not buy symbols outside the mined SOL/XRP bucket", () => {
    const signal = factorLabelAltReboundStrategy.generateSignal({
      analysis: analysis({ symbol: "ETHUSDT" }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("SOLUSDT/XRPUSDT");
  });
});
