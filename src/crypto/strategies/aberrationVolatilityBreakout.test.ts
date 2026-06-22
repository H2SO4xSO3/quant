import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { aberrationVolatilityBreakoutStrategy } from "./aberrationVolatilityBreakout";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 103,
    vwap: 101.8,
    priceVsVwapPct: 1.18,
    volatilityPct: 2.1,
    trend: {
      emaFast: 102.2,
      emaSlow: 101.4,
      emaTrend: 100.9,
      emaFastSlopePct: 0.12,
      higherEmaFast: 101.8,
      higherEmaSlow: 101.1,
      rsi: 63,
      atr: 0.55,
      atrPct: 0.53,
      trend: "bullish",
      higherTrend: "bullish"
    },
    technical: {
      volatilityChannel: {
        period: 20,
        basis: 100.6,
        upper: 102.1,
        lower: 99.1,
        highestHigh: 102.4,
        lowestLow: 98.8,
        breakoutLine: 102.4,
        breakoutPct: 0.58,
        bandwidthPct: 2.98
      }
    },
    volumeProfile: {
      pointOfControl: { price: 101.5, volume: 1, intensity: 1 },
      valueAreaLow: 99.5,
      valueAreaHigh: 102.2,
      currentPricePosition: "above_value"
    },
    footprint: { buyVolume: 1.3, sellVolume: 1, buySellImbalance: 0.13 },
    deepTrades: { largeTradeCount: 2, largeTradeBuyRatio: 0.61, score: 0.61 },
    liquidity: { bidWallPrice: 102.8, askWallPrice: 103.04, bidAskImbalance: 0.11, nearestAskDistancePct: 0.04 },
    reasons: [],
    ...overrides
  };
}

describe("aberration volatility breakout strategy", () => {
  it("buys a confirmed volatility-channel breakout with trend and tradable risk", () => {
    const signal = aberrationVolatilityBreakoutStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 10,
      config: {
        ...DEFAULT_STRATEGY_CONFIG,
        minBuyScore: 78,
        minExpectedValuePct: -0.05,
        minTakeProfitPct: 0.35,
        atrStopMultiplier: 1.6,
        takeProfitRiskMultiple: 1.45
      }
    });

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(78);
    expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
    expect(signal.takeProfit).toBeGreaterThan(signal.entryPrice);
    expect(signal.reasons.join(" ")).toContain("volatility channel breakout");
  });

  it("holds when price has not cleared the breakout line", () => {
    const signal = aberrationVolatilityBreakoutStrategy.generateSignal({
      analysis: analysis({
        price: 102.25,
        technical: {
          volatilityChannel: {
            period: 20,
            basis: 100.6,
            upper: 102.1,
            lower: 99.1,
            highestHigh: 102.4,
            lowestLow: 98.8,
            breakoutLine: 102.4,
            breakoutPct: -0.15,
            bandwidthPct: 2.98
          }
        }
      }),
      orderQuoteQty: 10,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 78, minExpectedValuePct: -0.05 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("has not cleared the volatility breakout line"))).toBe(true);
  });

  it("holds a breakout when the benchmark market regime is risk-off", () => {
    const signal = aberrationVolatilityBreakoutStrategy.generateSignal({
      analysis: analysis({
        marketRegime: {
          benchmarkSymbol: "BTCUSDT",
          isRiskOn: false,
          trend: "bearish",
          higherTrend: "bearish",
          volumeRatio: 0.66,
          volatilityBandwidthPct: 1.2,
          atrPct: 0.8,
          reasons: ["BTCUSDT benchmark trend is not bullish"]
        }
      }),
      orderQuoteQty: 10,
      config: {
        ...DEFAULT_STRATEGY_CONFIG,
        minBuyScore: 78,
        minExpectedValuePct: -0.05,
        minTakeProfitPct: 0.35,
        atrStopMultiplier: 1.6,
        takeProfitRiskMultiple: 1.45
      }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("Market regime blocked"))).toBe(true);
  });
});
