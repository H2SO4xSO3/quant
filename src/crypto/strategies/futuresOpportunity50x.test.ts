import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { chooseBestOpportunitySignal } from "./futuresOpportunity50x";
import type { CryptoSignal } from "../types";
import { futuresOpportunity50xStrategy } from "./futuresOpportunity50x";

function signal(overrides: Partial<CryptoSignal>): CryptoSignal {
  return {
    symbol: "BTCUSDT",
    action: "hold",
    score: 0,
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 104,
    orderQuoteQty: 20,
    reasons: ["test"],
    ...overrides
  };
}

function videoReadyAnalysis(): CryptoMarketAnalysis {
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
      volumeRatio: 1.35,
      chan: {
        trend: "up",
        fractals: [],
        strokes: [{ direction: "up", start: { kind: "bottom", index: 1, openTime: 1, price: 96 }, end: { kind: "top", index: 5, openTime: 5, price: 102 }, high: 102, low: 96, bars: 4, strengthPctPerBar: 1.2 }],
        pricePosition: "above_pivot",
        divergence: "none",
        setup: "third_buy_candidate"
      },
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
    reasons: []
  };
}

describe("futures 50x opportunity selector", () => {
  it("selects the highest-score executable direction", () => {
    const selected = chooseBestOpportunitySignal([
      signal({ action: "buy", score: 91, reasons: ["long ok"] }),
      signal({ action: "sell", score: 96, reasons: ["short ok"] })
    ]);

    expect(selected.action).toBe("sell");
    expect(selected.score).toBe(96);
    expect(selected.reasons).toContain("50x opportunity selector picked sell score=96.0");
  });

  it("holds when neither direction is executable but keeps the strongest blocked reason", () => {
    const selected = chooseBestOpportunitySignal([
      signal({ action: "hold", score: 88, reasons: ["long blocked"] }),
      signal({ action: "hold", score: 93, reasons: ["short blocked"] })
    ]);

    expect(selected.action).toBe("hold");
    expect(selected.score).toBe(93);
    expect(selected.reasons).toContain("No executable 50x opportunity passed current long/short gates");
    expect(selected.reasons).toContain("short blocked");
  });

  it("converts an executable signal to hold when its target is too thin for selector friction", () => {
    const selected = chooseBestOpportunitySignal(
      [
        signal({
          action: "sell",
          score: 99,
          entryPrice: 100,
          stopLoss: 100.2,
          takeProfit: 99.6,
          reasons: ["short executable"]
        })
      ],
      { minExecutableTakeProfitPct: 0.8 }
    );

    expect(selected.action).toBe("hold");
    expect(selected.score).toBe(99);
    expect(selected.reasons.join(" ")).toContain("Selector blocked");
    expect(selected.reasons.join(" ")).toContain("gross target 0.40%");
  });

  it("blocks non-major symbols from 50x execution", () => {
    const selected = chooseBestOpportunitySignal([
      signal({ symbol: "DOGEUSDT", action: "sell", score: 100, reasons: ["alt executable"] })
    ]);

    expect(selected.action).toBe("hold");
    expect(selected.reasons.join(" ")).toContain("50x execution is limited to BTCUSDT, ETHUSDT, BNBUSDT");
  });

  it("uses the right-side video structure branch instead of the old EMA long branch", () => {
    const selected = futuresOpportunity50xStrategy.generateSignal({
      analysis: videoReadyAnalysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 94, takeProfitRiskMultiple: 2, minExpectedValuePct: 0.15 }
    });

    expect(selected.action).toBe("buy");
    expect(selected.reasons).toContain("Video 1h bias is long after resistance breakout");
  });
});
