import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import { bollingerBreakevenStrategy } from "./bollingerBreakeven";
import type { CryptoMarketAnalysis } from "../types";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 98,
    vwap: 100,
    priceVsVwapPct: -2,
    volatilityPct: 1,
    trend: {
      emaFast: 98.5,
      emaSlow: 99,
      emaTrend: 100,
      emaFastSlopePct: -0.02,
      higherEmaFast: 100,
      higherEmaSlow: 99.8,
      rsi: 36,
      atr: 0.25,
      atrPct: 0.25,
      trend: "neutral",
      higherTrend: "bullish"
    },
    technical: {
      bollinger: {
        period: 20,
        middle: 99.2,
        upper: 100.4,
        lower: 97.8,
        bandwidthPct: 2.62,
        percentB: 0.077
      }
    },
    volumeProfile: {
      pointOfControl: { price: 99, volume: 1, intensity: 1 },
      valueAreaLow: 97.5,
      valueAreaHigh: 100.5,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0 },
    deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.5, score: 0.5 },
    liquidity: { bidWallPrice: 97.9, askWallPrice: 98.03, bidAskImbalance: 0, nearestAskDistancePct: 0.03 },
    reasons: [],
    ...overrides
  };
}

describe("bollinger breakeven strategy", () => {
  it("buys a lower-band mean reversion setup with enough middle-band room", () => {
    const signal = bollingerBreakevenStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 10,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 70, minTakeProfitPct: 0.3, minExpectedValuePct: -0.1 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
    expect(signal.takeProfit).toBeGreaterThan(signal.entryPrice);
    expect(signal.reasons.join(" ")).toContain("lower Bollinger edge");
  });

  it("holds when price is not near the lower Bollinger edge", () => {
    const signal = bollingerBreakevenStrategy.generateSignal({
      analysis: analysis({
        price: 100,
        technical: {
          bollinger: {
            period: 20,
            middle: 100,
            upper: 102,
            lower: 98,
            bandwidthPct: 4,
            percentB: 0.5
          }
        }
      }),
      orderQuoteQty: 10,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 70, minTakeProfitPct: 0.3 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("not close enough"))).toBe(true);
  });
});
