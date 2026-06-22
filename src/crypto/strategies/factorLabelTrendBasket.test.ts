import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { factorLabelTrendBasketStrategy } from "./factorLabelTrendBasket";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "ZECUSDT",
    price: 300,
    vwap: 296,
    priceVsVwapPct: 1.35,
    volatilityPct: 8,
    trend: {
      emaFast: 299,
      emaSlow: 286,
      emaTrend: 270,
      emaFastSlopePct: 0.08,
      higherEmaFast: 290,
      higherEmaSlow: 275,
      rsi: 68,
      atr: 4,
      atrPct: 1.33,
      trend: "bullish",
      higherTrend: "bullish"
    },
    technical: {
      volumeRatio: 1.1,
      donchianCloseByPeriod: {
        576: {
          period: 576,
          upperClose: 298,
          lowerClose: 230,
          breakoutPct: ((300 - 298) / 298) * 100,
          breakdownPct: ((300 - 230) / 230) * 100,
          rangePct: ((298 - 230) / 300) * 100
        }
      }
    },
    volumeProfile: {
      pointOfControl: { price: 285, volume: 1, intensity: 1 },
      valueAreaLow: 250,
      valueAreaHigh: 295,
      currentPricePosition: "above_value"
    },
    footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0.04 },
    deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.54, score: 0.54 },
    liquidity: { bidWallPrice: 299, askWallPrice: 300.1, bidAskImbalance: 0, nearestAskDistancePct: 0.04 },
    reasons: [],
    ...overrides
  };
}

describe("factor-label trend basket strategy", () => {
  it("buys a basket symbol when it clears that symbol's mined Donchian period", () => {
    const signal = factorLabelTrendBasketStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(80);
    expect(signal.maxHoldingMinutes).toBe(0);
    expect(signal.reasons.join(" ")).toContain("trend basket");
  });

  it("does not buy symbols outside the researched trend basket", () => {
    const signal = factorLabelTrendBasketStrategy.generateSignal({
      analysis: analysis({ symbol: "DOGEUSDT" }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("researched trend basket");
  });

  it("drops below the signal-exit threshold after a lower-channel breakdown", () => {
    const signal = factorLabelTrendBasketStrategy.generateSignal({
      analysis: analysis({
        price: 228,
        technical: {
          volumeRatio: 1,
          donchianCloseByPeriod: {
            576: {
              period: 576,
              upperClose: 298,
              lowerClose: 230,
              breakoutPct: ((228 - 298) / 298) * 100,
              breakdownPct: ((228 - 230) / 230) * 100,
              rangePct: ((298 - 230) / 228) * 100
            }
          }
        }
      }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.score).toBeLessThan(20);
  });
});
