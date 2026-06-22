import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis, CryptoStrategyConfig } from "../types";
import { videoEmaStructure50xStrategy } from "./videoEmaStructure50x";

const config: CryptoStrategyConfig = {
  ...DEFAULT_STRATEGY_CONFIG,
  minBuyScore: 94,
  takeProfitRiskMultiple: 2,
  minExpectedValuePct: 0.15
};

function baseAnalysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
    symbol: "ETHUSDT",
    price: 102,
    vwap: 100.5,
    priceVsVwapPct: 1.49,
    volatilityPct: 1.2,
    trend: {
      emaFast: 101,
      emaSlow: 99,
      emaTrend: 96,
      emaFastSlopePct: 0.08,
      higherEmaFast: 103,
      higherEmaSlow: 100,
      rsi: 62,
      atr: 0.5,
      atrPct: 0.5,
      trend: "bullish",
      higherTrend: "bullish"
    },
    technical: {
      candleBodyPct: 0.42,
      closePosition: 0.88,
      lowerWickPct: 0.04,
      upperWickPct: 0.05,
      volumeRatio: 1.35,
      hourlyStructure: {
        bias: "long",
        support: 93,
        resistance: 100.5,
        brokenLevel: 100.5,
        brokenLevelKind: "resistance",
        breakoutPct: 1.5,
        distanceFromBrokenLevelPct: 1.5,
        rows: 24
      }
    },
    volumeProfile: {
      pointOfControl: { price: 99, volume: 100, intensity: 1 },
      valueAreaLow: 97,
      valueAreaHigh: 101,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 65, sellVolume: 35, buySellImbalance: 0.3 },
    deepTrades: { largeTradeCount: 6, largeTradeBuyRatio: 0.68, score: 0.68 },
    liquidity: { bidWallPrice: 99.8, askWallPrice: 101.2, bidAskImbalance: 0.22, nearestAskDistancePct: 0.04 },
    reasons: [],
    ...overrides
  };
}

describe("video EMA structure 50x strategy", () => {
  it("buys after 1h resistance breakout when 5m EMA and RSI momentum confirm", () => {
    const signal = videoEmaStructure50xStrategy.generateSignal({ analysis: baseAnalysis(), orderQuoteQty: 20, config });

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(94);
    expect(signal.takeProfit - signal.entryPrice).toBeCloseTo((signal.entryPrice - signal.stopLoss) * 2, 6);
    expect(signal.reasons).toContain("Video 1h bias is long after resistance breakout");
    expect(signal.reasons).toContain("5m EMA order confirms long trend: EMA21 > EMA50 > EMA200");
  });

  it("sells after 1h support breakdown when 5m EMA and RSI momentum confirm", () => {
    const analysis = baseAnalysis({
      price: 98,
      vwap: 99.5,
      priceVsVwapPct: -1.51,
      trend: {
        emaFast: 99,
        emaSlow: 101,
        emaTrend: 104,
        emaFastSlopePct: -0.08,
        higherEmaFast: 98,
        higherEmaSlow: 101,
        rsi: 42,
        atr: 0.5,
        atrPct: 0.5,
        trend: "bearish",
        higherTrend: "bearish"
      },
      technical: {
        candleBodyPct: 0.42,
        closePosition: 0.12,
        lowerWickPct: 0.05,
        upperWickPct: 0.04,
        volumeRatio: 1.35,
        hourlyStructure: {
          bias: "short",
          support: 99.5,
          resistance: 108,
          brokenLevel: 99.5,
          brokenLevelKind: "support",
          breakoutPct: -1.48,
          distanceFromBrokenLevelPct: 1.48,
          rows: 24
        }
      },
      footprint: { buyVolume: 35, sellVolume: 65, buySellImbalance: -0.3 },
      deepTrades: { largeTradeCount: 6, largeTradeBuyRatio: 0.32, score: 0.32 },
      liquidity: { bidWallPrice: 98.8, askWallPrice: 100.2, bidAskImbalance: -0.22, nearestAskDistancePct: 0.04 }
    });

    const signal = videoEmaStructure50xStrategy.generateSignal({ analysis, orderQuoteQty: 20, config });

    expect(signal.action).toBe("sell");
    expect(signal.score).toBeGreaterThanOrEqual(94);
    expect(signal.entryPrice - signal.takeProfit).toBeCloseTo((signal.stopLoss - signal.entryPrice) * 2, 6);
    expect(signal.reasons).toContain("Video 1h bias is short after support breakdown");
    expect(signal.reasons).toContain("5m EMA order confirms short trend: EMA21 < EMA50 < EMA200");
  });

  it("holds when 1h structure has not broken", () => {
    const signal = videoEmaStructure50xStrategy.generateSignal({
      analysis: baseAnalysis({
        technical: {
          ...baseAnalysis().technical,
          hourlyStructure: {
            bias: "neutral",
            support: 97,
            resistance: 103,
            breakoutPct: 0,
            distanceFromBrokenLevelPct: 0,
            rows: 24
          }
        }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).toContain("1h structure has no confirmed breakout/breakdown bias");
  });

  it("holds when the entry candle does not push away from the EMAs", () => {
    const signal = videoEmaStructure50xStrategy.generateSignal({
      analysis: baseAnalysis({
        technical: {
          ...baseAnalysis().technical,
          candleBodyPct: 0.08,
          closePosition: 0.52,
          volumeRatio: 0.9
        }
      }),
      orderQuoteQty: 20,
      config
    });

    expect(signal.action).toBe("hold");
    expect(signal.reasons).toContain("Entry candle body is not strong enough to push away from EMA21/EMA50");
  });
});
