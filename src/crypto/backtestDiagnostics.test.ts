import { describe, expect, it } from "vitest";
import { summarizeSymbolDiagnostics, type BacktestTrade } from "./backtest";

function trade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    symbol: "DOGEUSDT",
    entryTime: "2026-06-01T00:00:00.000Z",
    exitTime: "2026-06-01T01:00:00.000Z",
    entryPrice: 1,
    exitPrice: 0.99,
    entryQuoteQty: 20,
    quantity: 20,
    pnlUsdt: -0.2,
    reason: "stop_loss",
    ...overrides
  };
}

describe("backtest symbol diagnostics", () => {
  it("summarizes exit reasons and recommends excluding persistent losers", () => {
    const diagnostics = summarizeSymbolDiagnostics([
      trade({ pnlUsdt: -0.2, reason: "stop_loss" }),
      trade({ pnlUsdt: -0.1, reason: "timeout" }),
      trade({ pnlUsdt: -0.05, reason: "signal_exit" })
    ], {
      netPnlUsdt: -0.35,
      profitFactor: 0,
      winRate: 0
    });

    expect(diagnostics.averagePnlUsdt).toBeCloseTo(-0.116666);
    expect(diagnostics.exitReasons.stop_loss).toBe(1);
    expect(diagnostics.exitReasons.timeout).toBe(1);
    expect(diagnostics.recommendation).toBe("exclude");
  });

  it("recommends keeping symbols with positive expectancy and acceptable profit factor", () => {
    const diagnostics = summarizeSymbolDiagnostics([
      trade({ pnlUsdt: 0.4, reason: "take_profit" }),
      trade({ pnlUsdt: -0.1, reason: "stop_loss" }),
      trade({ pnlUsdt: 0.2, reason: "timeout" })
    ], {
      netPnlUsdt: 0.5,
      profitFactor: 6,
      winRate: 2 / 3
    });

    expect(diagnostics.recommendation).toBe("keep");
    expect(diagnostics.bestTradePnlUsdt).toBe(0.4);
    expect(diagnostics.worstTradePnlUsdt).toBe(-0.1);
  });
});
