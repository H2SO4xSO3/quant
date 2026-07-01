import { describe, expect, it } from "vitest";
import { buildTradeAttributionReport, formatTradeAttributionReport } from "./tradeAttribution";
import type { BacktestTrade } from "./backtest";

function trade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    symbol: "DOGEUSDT",
    entryTime: "2026-06-01T00:00:00.000Z",
    exitTime: "2026-06-01T01:00:00.000Z",
    entryPrice: 100,
    exitPrice: 99,
    entryQuoteQty: 20,
    quantity: 0.2,
    pnlUsdt: -0.25,
    pnlPct: -1.25,
    holdingMinutes: 60,
    reason: "timeout",
    exitReason: "timeout",
    exitType: "timeout",
    strategyId: "ema-vwap-quality-breakout",
    entryReason: "Price is above VWAP; RSI confirms momentum",
    rsiAtEntry: 68,
    priceVsVwapPctAtEntry: 0.85,
    emaFastSlopeAtEntry: 0.09,
    higherTrendGapPctAtEntry: 0.08,
    spreadPctAtEntry: 0.16,
    estimatedSlippagePct: 0.03,
    btcTrendAtEntry: "bearish",
    maxFavorableExcursionPct: 0.12,
    maxAdverseExcursionPct: -1.4,
    ...overrides
  };
}

describe("trade attribution", () => {
  it("summarizes expectancy, buckets, symbols, exits, and loss sources", () => {
    const report = buildTradeAttributionReport([
      trade({ pnlUsdt: -0.25, pnlPct: -1.25, symbol: "DOGEUSDT", exitType: "timeout", reason: "timeout" }),
      trade({ pnlUsdt: -0.2, pnlPct: -1, symbol: "DOGEUSDT", exitType: "stop_loss", reason: "stop_loss", holdingMinutes: 15 }),
      trade({ pnlUsdt: 0.15, pnlPct: 0.75, symbol: "BTCUSDT", exitType: "take_profit", reason: "take_profit", rsiAtEntry: 56, priceVsVwapPctAtEntry: 0.25, spreadPctAtEntry: 0.03, btcTrendAtEntry: "bullish", maxFavorableExcursionPct: 1.1, maxAdverseExcursionPct: -0.1 })
    ]);

    expect(report.totals.tradeCount).toBe(3);
    expect(report.totals.winRatePct).toBeCloseTo(33.333, 2);
    expect(report.totals.avgWinPct).toBeCloseTo(0.75);
    expect(report.totals.avgLossPct).toBeCloseTo(-1.125);
    expect(report.totals.expectancyPct).toBeLessThan(0);
    expect(report.totals.profitFactor).toBeCloseTo(0.333333, 5);
    expect(report.byExitType.timeout.count).toBe(1);
    expect(report.bySymbol.DOGEUSDT.tradeCount).toBe(2);
    expect(report.buckets.rsi["65-72"].tradeCount).toBe(2);
    expect(report.lossSources).toContain("追高后回落");
    expect(report.lossSources).toContain("大盘下跌时硬做多");
    expect(report.verdict).toContain("negative expectancy");
  });

  it("formats an operator-readable report", () => {
    const text = formatTradeAttributionReport(buildTradeAttributionReport([trade()]));

    expect(text).toContain("Trade Attribution Report");
    expect(text).toContain("Profit Factor");
    expect(text).toContain("Loss Sources");
  });
});
