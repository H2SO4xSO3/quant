import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import { buildLongTradePlan, buildShortTradePlan, roundTripCostPct } from "./tradeMath";
import type { CryptoMarketAnalysis } from "./types";

function analysis(): CryptoMarketAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 100,
    vwap: 99,
    priceVsVwapPct: 1.01,
    volatilityPct: 1,
    trend: {
      emaFast: 101,
      emaSlow: 100,
      emaTrend: 98,
      emaFastSlopePct: 0.1,
      higherEmaFast: 101,
      higherEmaSlow: 100,
      rsi: 58,
      atr: 1,
      atrPct: 1,
      trend: "bullish",
      higherTrend: "bullish"
    },
    volumeProfile: {
      pointOfControl: { price: 99.5, volume: 1, intensity: 1 },
      valueAreaLow: 98,
      valueAreaHigh: 101,
      currentPricePosition: "inside_value"
    },
    footprint: { buyVolume: 1, sellVolume: 1, buySellImbalance: 0 },
    deepTrades: { largeTradeCount: 0, largeTradeBuyRatio: 0.5, score: 0.5 },
    liquidity: { bidWallPrice: 99.5, askWallPrice: 100.1, bidAskImbalance: 0, nearestAskDistancePct: 0.05 },
    reasons: []
  };
}

describe("trade math", () => {
  it("keeps round-trip trading costs in one reusable calculation", () => {
    expect(roundTripCostPct(DEFAULT_STRATEGY_CONFIG)).toBeCloseTo(0.27);
  });

  it("risk-sizes the quote amount from the stop distance", () => {
    const plan = buildLongTradePlan({
      analysis: analysis(),
      trend: analysis().trend!,
      score: 80,
      orderQuoteQty: 10,
      config: { ...DEFAULT_STRATEGY_CONFIG, maxPositionLossUsdt: 0.05 }
    });

    expect(plan.orderQuoteQty).toBeLessThan(10);
    expect(plan.stopLoss).toBeLessThan(plan.entryPrice);
    expect(plan.takeProfit).toBeGreaterThan(plan.entryPrice);
  });

  it("sets take-profit from the configured reward-to-risk multiple", () => {
    const nearVwap = {
      ...analysis(),
      vwap: 99.8,
      priceVsVwapPct: 0.2
    };
    const plan = buildLongTradePlan({
      analysis: nearVwap,
      trend: nearVwap.trend!,
      score: 95,
      orderQuoteQty: 10,
      config: { ...DEFAULT_STRATEGY_CONFIG, takeProfitRiskMultiple: 2 }
    });

    const risk = plan.entryPrice - plan.stopLoss;
    const reward = plan.takeProfit - plan.entryPrice;

    expect(reward / risk).toBeCloseTo(2, 6);
  });

  it("builds a short plan with stop above entry and 2R take-profit below entry", () => {
    const shortAnalysis = {
      ...analysis(),
      price: 100,
      vwap: 101,
      priceVsVwapPct: -0.99,
      volumeProfile: {
        pointOfControl: { price: 100.8, volume: 1, intensity: 1 },
        valueAreaLow: 99,
        valueAreaHigh: 102,
        currentPricePosition: "inside_value" as const
      }
    };
    const plan = buildShortTradePlan({
      analysis: shortAnalysis,
      trend: shortAnalysis.trend!,
      score: 95,
      orderQuoteQty: 10,
      config: { ...DEFAULT_STRATEGY_CONFIG, takeProfitRiskMultiple: 2 }
    });

    const risk = plan.stopLoss - plan.entryPrice;
    const reward = plan.entryPrice - plan.takeProfit;

    expect(plan.stopLoss).toBeGreaterThan(plan.entryPrice);
    expect(plan.takeProfit).toBeLessThan(plan.entryPrice);
    expect(reward / risk).toBeCloseTo(2, 6);
  });
});
