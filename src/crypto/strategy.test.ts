import { describe, expect, it } from "vitest";
import { decideSignal } from "./strategy";
import type { CryptoMarketAnalysis } from "./types";

function baseAnalysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 104,
    vwap: 102,
    priceVsVwapPct: 1.96,
    volatilityPct: 0.8,
    trend: {
      emaFast: 103.8,
      emaSlow: 102.6,
      emaTrend: 101.4,
      emaFastSlopePct: 0.18,
      higherEmaFast: 102.8,
      higherEmaSlow: 101.9,
      rsi: 58,
      atr: 0.42,
      atrPct: 0.4,
      trend: "bullish",
      higherTrend: "bullish"
    },
    volumeProfile: {
      pointOfControl: { price: 103.8, volume: 100, intensity: 1 },
      valueAreaLow: 101,
      valueAreaHigh: 104.5,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 80, sellVolume: 40, buySellImbalance: 0.333 },
    deepTrades: { largeTradeCount: 3, largeTradeBuyRatio: 0.78, score: 0.78 },
    liquidity: { bidWallPrice: 103.5, askWallPrice: 104.05, bidAskImbalance: 0.22, nearestAskDistancePct: 0.05 },
    reasons: [],
    ...overrides
  };
}

describe("crypto strategy", () => {
  it("produces a buy signal with entries, exits and reasons for aligned bullish flow", () => {
    const signal = decideSignal(baseAnalysis());

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(70);
    expect(signal.orderQuoteQty).toBe(10);
    expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
    expect(signal.takeProfit).toBeGreaterThan(signal.entryPrice);
    expect(signal.reasons.length).toBeGreaterThan(2);
  });

  it("holds when price is below VWAP and sell flow dominates", () => {
    const signal = decideSignal(
      baseAnalysis({
        price: 99,
        vwap: 102,
        priceVsVwapPct: -2.94,
        footprint: { buyVolume: 20, sellVolume: 90, buySellImbalance: -0.63 },
        deepTrades: { largeTradeCount: 4, largeTradeBuyRatio: 0.2, score: 0.2 },
        liquidity: { bidWallPrice: 98.8, askWallPrice: 99.6, bidAskImbalance: -0.25, nearestAskDistancePct: 0.61 }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.score).toBeLessThan(55);
  });

  it("holds when the target is too small to overcome fees", () => {
    const signal = decideSignal(
      baseAnalysis({
        price: 100.2,
        vwap: 100,
        priceVsVwapPct: 0.2,
        trend: {
          emaFast: 100.18,
          emaSlow: 100,
          emaTrend: 99.7,
          emaFastSlopePct: 0.08,
          higherEmaFast: 100.2,
          higherEmaSlow: 100,
          rsi: 58,
          atr: 0.02,
          atrPct: 0.02,
          trend: "bullish",
          higherTrend: "bullish"
        }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("Gross take-profit"))).toBe(true);
  });

  it("holds when bullish trend lacks enough flow confirmation", () => {
    const signal = decideSignal(
      baseAnalysis({
        footprint: { buyVolume: 52, sellVolume: 48, buySellImbalance: 0.04 },
        deepTrades: { largeTradeCount: 1, largeTradeBuyRatio: 0.52, score: 0.52 },
        liquidity: { bidWallPrice: 103.5, askWallPrice: 104.05, bidAskImbalance: 0.02, nearestAskDistancePct: 0.05 }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("bullish flow confirmations"))).toBe(true);
  });

  it("holds when taker flow and large trades are bullish but the order book lacks bid support", () => {
    const signal = decideSignal(
      baseAnalysis({
        footprint: { buyVolume: 80, sellVolume: 40, buySellImbalance: 0.333 },
        deepTrades: { largeTradeCount: 3, largeTradeBuyRatio: 0.78, score: 0.78 },
        liquidity: { bidWallPrice: 103.5, askWallPrice: 104.05, bidAskImbalance: 0.02, nearestAskDistancePct: 0.05 }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("does not show stronger bid support"))).toBe(true);
  });

  it("holds instead of chasing price above the value area", () => {
    const signal = decideSignal(
      baseAnalysis({
        volumeProfile: {
          pointOfControl: { price: 103.8, volume: 100, intensity: 1 },
          valueAreaLow: 101,
          valueAreaHigh: 103.5,
          currentPricePosition: "above_value"
        }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("above value area"))).toBe(true);
  });

  it("holds when the trend signal is still below the value area", () => {
    const signal = decideSignal(
      baseAnalysis({
        price: 103.2,
        vwap: 102,
        priceVsVwapPct: 1.18,
        volumeProfile: {
          pointOfControl: { price: 104, volume: 100, intensity: 1 },
          valueAreaLow: 103.5,
          valueAreaHigh: 105,
          currentPricePosition: "below_value"
        }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("below value area"))).toBe(true);
  });

  it("holds when the order book shows heavier ask pressure", () => {
    const signal = decideSignal(
      baseAnalysis({
        liquidity: { bidWallPrice: 103.5, askWallPrice: 104.05, bidAskImbalance: -0.2, nearestAskDistancePct: 0.05 }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.reasons.some((reason) => reason.includes("heavier ask pressure"))).toBe(true);
  });

  it("keeps the raw score and records the hard entry gate when a strong setup is blocked", () => {
    const signal = decideSignal(
      baseAnalysis({
        trend: {
          ...baseAnalysis().trend!,
          emaFastSlopePct: 0.01
        }
      })
    );

    expect(signal.action).toBe("hold");
    expect(signal.score).toBe(100);
    expect(signal.reasons.some((reason) => reason.includes("momentum floor"))).toBe(true);
  });
});
