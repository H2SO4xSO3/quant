import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { bitgetCompositeRouterStrategy } from "./bitgetCompositeRouter";

type AnalysisOverrides = Omit<Partial<CryptoMarketAnalysis>, "trend"> & { trend?: Partial<NonNullable<CryptoMarketAnalysis["trend"]>> };

function analysis(overrides: AnalysisOverrides = {}): CryptoMarketAnalysis {
  const base: CryptoMarketAnalysis = {
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
      bollinger: { period: 20, middle: 101, upper: 104, lower: 99, bandwidthPct: 2.6, percentB: 0.34 },
      volatilityChannel: { period: 20, basis: 99.6, upper: 100.25, lower: 97.8, highestHigh: 100.4, lowestLow: 96.8, breakoutLine: 100.2, breakoutPct: 0.15, bandwidthPct: 2.4 },
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
    reasons: []
  };

  return {
    ...base,
    ...overrides,
    technical: { ...base.technical, ...overrides.technical },
    trend: { ...base.trend!, ...overrides.trend }
  };
}

const config = { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 88, minExpectedValuePct: 0.02, takeProfitRiskMultiple: 2 };

describe("Bitget composite router strategy", () => {
  it("uses the trend branch when continuation is executable instead of requiring reversion standards", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis({
        price: 101.1,
        priceVsVwapPct: 1.1,
        trend: { trend: "bullish", higherTrend: "bullish", rsi: 68, emaFastSlopePct: 0.07 },
        volumeProfile: {
          pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
          valueAreaLow: 99.4,
          valueAreaHigh: 101,
          currentPricePosition: "above_value"
        },
        technical: {
          volatilityChannel: { period: 20, basis: 100.2, upper: 101, lower: 98, highestHigh: 101.2, lowestLow: 98, breakoutLine: 100.8, breakoutPct: 0.3, bandwidthPct: 2.9 }
        }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("buy");
    expect(signal.reasons.join(" ")).toContain("Bitget composite selected trend branch");
    expect(signal.reasons.join(" ")).toContain("reversion=blocked");
  });

  it("uses the reversion branch during a low-buy reclaim without requiring breakout standards", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("buy");
    expect(signal.reasons.join(" ")).toContain("Bitget composite selected reversion branch");
    expect(signal.reasons.join(" ")).toContain("trend=blocked");
  });

  it("blocks BTC reversion-only entries after Bitget attribution showed branch drag", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis({ symbol: "BTCUSDT" }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("BTCUSDT reversion branch is disabled");
  });

  it("blocks XRP trend-only entries after Bitget attribution showed branch drag", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis({
        symbol: "XRPUSDT",
        price: 101.1,
        priceVsVwapPct: 1.1,
        trend: { trend: "bullish", higherTrend: "bullish", rsi: 70, emaFastSlopePct: 0.07 },
        volumeProfile: {
          pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
          valueAreaLow: 99.4,
          valueAreaHigh: 101,
          currentPricePosition: "above_value"
        },
        technical: {
          volatilityChannel: { period: 20, basis: 100.2, upper: 101, lower: 98, highestHigh: 101.2, lowestLow: 98, breakoutLine: 100.8, breakoutPct: 0.3, bandwidthPct: 2.9 }
        }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("XRPUSDT trend branch is disabled");
  });

  it("blocks low-buy reversion when the benchmark regime is risk-off", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis({
        marketRegime: {
          benchmarkSymbol: "BTCUSDT",
          isRiskOn: false,
          trend: "bearish",
          higherTrend: "bearish",
          volumeRatio: 0.8,
          volatilityBandwidthPct: 4.2,
          atrPct: 1.1,
          reasons: ["BTC benchmark is risk-off"]
        }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("reversion=blocked");
    expect(signal.reasons.join(" ")).toContain("risk-off");
  });

  it("uses overextension as a high-sell exit signal instead of opening another long", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis({
        price: 104.4,
        priceVsVwapPct: 4.4,
        trend: { trend: "bullish", higherTrend: "bullish", rsi: 81, emaFastSlopePct: -0.02 },
        technical: {
          bollinger: { period: 20, middle: 101, upper: 104, lower: 98, bandwidthPct: 5.8, percentB: 1.04 }
        },
        volumeProfile: {
          pointOfControl: { price: 100.1, volume: 10, intensity: 1.2 },
          valueAreaLow: 99.4,
          valueAreaHigh: 101,
          currentPricePosition: "above_value"
        },
        footprint: { buyVolume: 48, sellVolume: 52, buySellImbalance: -0.04 },
        deepTrades: { largeTradeCount: 4, largeTradeBuyRatio: 0.46, score: 0.46 },
        liquidity: { bidWallPrice: 104.1, askWallPrice: 104.5, bidAskImbalance: -0.08, nearestAskDistancePct: 0.07 }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("sell");
    expect(signal.reasons.join(" ")).toContain("Bitget composite selected overextension exit branch");
    expect(signal.reasons.some((reason) => reason.startsWith("Exit invalidation:"))).toBe(true);
    expect(signal.takeProfit).toBeLessThan(signal.entryPrice);
  });

  it("holds when branches conflict or only blocked scores exist", () => {
    const signal = bitgetCompositeRouterStrategy.generateSignal({
      analysis: analysis({
        price: 100.4,
        priceVsVwapPct: 0.4,
        trend: { trend: "neutral", higherTrend: "neutral", rsi: 79, emaFastSlopePct: 0 },
        footprint: { buyVolume: 50, sellVolume: 50, buySellImbalance: 0 },
        deepTrades: { largeTradeCount: 1, largeTradeBuyRatio: 0.5, score: 0.5 },
        liquidity: { bidWallPrice: 100.2, askWallPrice: 100.45, bidAskImbalance: 0, nearestAskDistancePct: 0.07 }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons.join(" ")).toContain("Bitget composite hold");
    expect(signal.score).toBeGreaterThan(0);
  });
});
