import { describe, expect, it } from "vitest";
import { assessMarketRegime } from "./marketRegime";
import type { CryptoMarketAnalysis } from "./types";

function benchmark(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 104,
    vwap: 102,
    priceVsVwapPct: 1.96,
    volatilityPct: 1.4,
    trend: {
      emaFast: 103.6,
      emaSlow: 102.4,
      emaTrend: 101.2,
      emaFastSlopePct: 0.08,
      higherEmaFast: 102.8,
      higherEmaSlow: 101.9,
      rsi: 61,
      atr: 0.55,
      atrPct: 0.53,
      trend: "bullish",
      higherTrend: "bullish"
    },
    technical: {
      volumeRatio: 1.25,
      volatilityChannel: {
        period: 20,
        basis: 101,
        upper: 103,
        lower: 99,
        highestHigh: 103.2,
        lowestLow: 98.8,
        breakoutLine: 103.2,
        breakoutPct: 0.78,
        bandwidthPct: 3.96
      }
    },
    volumeProfile: {
      pointOfControl: { price: 102.8, volume: 1, intensity: 1 },
      valueAreaLow: 100,
      valueAreaHigh: 103,
      currentPricePosition: "above_value"
    },
    footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0 },
    deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.5, score: 0.5 },
    liquidity: { bidWallPrice: 103.8, askWallPrice: 104.05, bidAskImbalance: 0, nearestAskDistancePct: 0.05 },
    reasons: [],
    ...overrides
  };
}

describe("market regime assessment", () => {
  it("marks a bullish benchmark with volume and volatility expansion as risk-on", () => {
    const regime = assessMarketRegime(benchmark());

    expect(regime.isRiskOn).toBe(true);
    expect(regime.benchmarkSymbol).toBe("BTCUSDT");
    expect(regime.reasons.join(" ")).toContain("risk-on");
  });

  it("marks weak benchmark trend as risk-off", () => {
    const regime = assessMarketRegime(
      benchmark({
        price: 99,
        trend: {
          ...benchmark().trend!,
          trend: "bearish",
          higherTrend: "bearish",
          rsi: 38
        },
        technical: {
          ...benchmark().technical,
          volumeRatio: 0.62
        }
      })
    );

    expect(regime.isRiskOn).toBe(false);
    expect(regime.reasons.some((reason) => reason.includes("trend is not bullish"))).toBe(true);
  });
});
