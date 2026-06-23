import { describe, expect, it } from "vitest";
import { createFuturesSignalLabelReportFromRows } from "./futuresSignalLabelResearch";
import type { BinanceKline } from "./types";

function row(index: number, close: number, high = close, low = close): BinanceKline {
  return [
    index * 5 * 60 * 1000,
    String(close),
    String(high),
    String(low),
    String(close),
    "1000",
    index * 5 * 60 * 1000 + 5 * 60 * 1000 - 1,
    String(close * 1000)
  ];
}

describe("futures signal label research", () => {
  it("shows random direction can be below 50% net win rate after costs", () => {
    const rows = [
      row(0, 100),
      row(1, 100.2, 100.2, 99.8),
      row(2, 100),
      row(3, 100.2, 100.2, 99.8),
      row(4, 100),
      row(5, 100.2, 100.2, 99.8)
    ];

    const report = createFuturesSignalLabelReportFromRows({
      days: 1,
      symbols: [{ symbol: "BTCUSDT", rows }],
      horizonBars: 1,
      takeProfitPct: 0.3,
      stopLossPct: 0.3,
      costPct: 0.27,
      leverage: 50,
      warmupBars: 0
    });

    expect(report.baseline.trades).toBe(10);
    expect(report.baseline.winRate).toBeLessThan(0.5);
    expect(report.baseline.netPnlPct).toBeLessThan(0);
    expect(report.randomDirectionNote).toContain("direction can be near 50/50 while net profitability is negative");
  });
});
