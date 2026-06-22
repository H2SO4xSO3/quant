import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "../strategy";
import type { CryptoMarketAnalysis } from "../types";
import { factorLabelBnbBreakoutStrategy } from "./factorLabelBnbBreakout";

function analysis(overrides: Partial<CryptoMarketAnalysis> = {}): CryptoMarketAnalysis {
  return {
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
    reasons: [],
    ...overrides
  };
}

describe("factor-label BNB breakout strategy", () => {
  it("buys BNB when price clears the 432-bar close channel", () => {
    const signal = factorLabelBnbBreakoutStrategy.generateSignal({
      analysis: analysis(),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("buy");
    expect(signal.score).toBeGreaterThanOrEqual(80);
    expect(signal.stopLoss).toBeCloseTo(559);
    expect(signal.takeProfit).toBeGreaterThan(signal.entryPrice * 5);
    expect(signal.maxHoldingMinutes).toBe(0);
  });

  it("keeps an open breakout alive while price remains above the lower channel", () => {
    const signal = factorLabelBnbBreakoutStrategy.generateSignal({
      analysis: analysis({
        price: 630,
        technical: {
          volumeRatio: 0.9,
          donchianClose: {
            period: 432,
            upperClose: 648,
            lowerClose: 610,
            breakoutPct: ((630 - 648) / 648) * 100,
            breakdownPct: ((630 - 610) / 610) * 100,
            rangePct: ((648 - 610) / 630) * 100
          }
        }
      }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.score).toBeGreaterThan(20);
  });

  it("drops below the signal-exit threshold when price closes under the lower channel", () => {
    const signal = factorLabelBnbBreakoutStrategy.generateSignal({
      analysis: analysis({
        price: 605,
        technical: {
          volumeRatio: 1,
          donchianClose: {
            period: 432,
            upperClose: 648,
            lowerClose: 610,
            breakoutPct: ((605 - 648) / 648) * 100,
            breakdownPct: ((605 - 610) / 610) * 100,
            rangePct: ((648 - 610) / 605) * 100
          }
        }
      }),
      orderQuoteQty: 20,
      config: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 }
    });

    expect(signal.action).toBe("hold");
    expect(signal.score).toBeLessThan(20);
    expect(signal.reasons.join(" ")).toContain("below the 432-bar lower close channel");
  });
});
