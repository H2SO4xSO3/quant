import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { factorLabelCompositeStrategy } from "./factorLabelComposite";

const baseAnalysis: CryptoMarketAnalysis = {
  symbol: "BNBUSDT",
  price: 650,
  vwap: 646,
  priceVsVwapPct: 0.62,
  volatilityPct: 3,
  trend: {
    emaFast: 648,
    emaSlow: 640,
    emaTrend: 635,
    emaFastSlopePct: 0.05,
    higherEmaFast: 640,
    higherEmaSlow: 632,
    rsi: 64,
    atr: 4,
    atrPct: 0.62,
    trend: "bullish",
    higherTrend: "bullish"
  },
  technical: {
    volumeRatio: 1.1,
    donchianClose: {
      period: 432,
      upperClose: 648,
      lowerClose: 610,
      breakoutPct: ((650 - 648) / 648) * 100,
      breakdownPct: ((650 - 610) / 610) * 100,
      rangePct: ((648 - 610) / 650) * 100
    }
  },
  volumeProfile: {
    pointOfControl: { price: 640, volume: 1, intensity: 1 },
    valueAreaLow: 620,
    valueAreaHigh: 645,
    currentPricePosition: "above_value"
  },
  footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0.03 },
  deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.52, score: 0.52 },
  liquidity: { bidWallPrice: 649, askWallPrice: 650.2, bidAskImbalance: 0, nearestAskDistancePct: 0.04 },
  reasons: []
};

describe("factor-label composite strategy", () => {
  it("routes BNB through the long breakout branch", () => {
    const signal = factorLabelCompositeStrategy.generateSignal({
      analysis: baseAnalysis,
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.reasons.join(" ")).toContain("BNB/BTC long close-channel breakout");
  });

  it("routes SOL through the rebound branch", () => {
    const signal = factorLabelCompositeStrategy.generateSignal({
      analysis: {
        ...baseAnalysis,
        symbol: "SOLUSDT",
        price: 80,
        technical: {
          recentReturn6Pct: -0.9,
          volumeRatio: 1.25,
          lowerWickPct: 0.16,
          closePosition: 0.7
        },
        trend: { ...baseAnalysis.trend!, rsi: 38 }
      },
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.reasons.join(" ")).toContain("factor-label alt rebound");
  });
});
