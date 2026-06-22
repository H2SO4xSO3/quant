import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { factorLabelCapitulationReclaimStrategy } from "./factorLabelCapitulationReclaim";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "ETHUSDT",
    price: 2000,
    vwap: 2010,
    priceVsVwapPct: -0.5,
    volatilityPct: 1.2,
    trend: {
      emaFast: 1990,
      emaSlow: 2005,
      emaTrend: 2020,
      emaFastSlopePct: -0.08,
      higherEmaFast: 2050,
      higherEmaSlow: 2060,
      rsi: 32,
      atr: 7,
      atrPct: 0.35,
      trend: "bearish",
      higherTrend: "bearish"
    },
    technical: {
      volumeRatio: 1.4,
      recentReturn6Pct: -0.72,
      closePosition: 0.68,
      lowerWickPct: 0.18,
      upperWickPct: 0.03,
      candleBodyPct: 0.12
    },
    volumeProfile: {
      pointOfControl: { price: 2010, volume: 1, intensity: 1 },
      valueAreaLow: 1980,
      valueAreaHigh: 2030,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0 },
    deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.5, score: 0.5 },
    liquidity: { bidWallPrice: 1998, askWallPrice: 2001, bidAskImbalance: 0, nearestAskDistancePct: 0.04 },
    reasons: [],
    ...overrides
  };
}

describe("factor-label capitulation reclaim strategy", () => {
  it("buys ETH when the labelled capitulation reclaim factors match", () => {
    const signal = factorLabelCapitulationReclaimStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(90);
    expect(signal.stopLoss).toBeCloseTo(1989);
    expect(signal.takeProfit).toBeCloseTo(2017);
    expect(signal.reasons.join(" ")).toContain("capitulation reclaim");
  });

  it("does not buy non-ETH symbols because the 14d label edge was ETH-specific", () => {
    const signal = factorLabelCapitulationReclaimStrategy.generateSignal({
      analysis: analysis({ symbol: "BTCUSDT" }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("ETHUSDT");
  });
});
