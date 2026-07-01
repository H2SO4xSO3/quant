import { describe, expect, it } from "vitest";
import { runFixedRiskSignalBacktest } from "./strategyResearch";
import type { TradingViewSignal } from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

function row(index: number, close: number, low = close - 1, high = close + 1): ParsedKline {
  return {
    openTime: index * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 1,
    quoteVolume: close
  };
}

describe("fixed-risk strategy research helpers", () => {
  it("sizes each trade from fixed account risk and exits at 1.5R take profit", () => {
    const rows = [
      row(0, 100, 98, 101),
      row(1, 103, 102, 104)
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 100,
      stopPrice: 98,
      takeProfitPrice: 103,
      riskUsdt: 10,
      pnlUsdt: 15,
      exitReason: "take_profit"
    });
    expect(result.endingEquityUsdt).toBe(115);
  });

  it("skips neutral FRAMA candles when color gate is enabled", () => {
    const rows = [row(0, 100, 98, 101), row(1, 103, 102, 104)];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      framaColors: ["neutral", "up"],
      colorGate: "withTrend",
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(0);
    expect(result.endingEquityUsdt).toBe(100);
  });

  it("aggregates daily returns by Asia Shanghai calendar days", () => {
    const rows = [
      { ...row(0, 100, 98, 101), openTime: Date.UTC(2026, 5, 24, 15, 59) },
      { ...row(1, 103, 102, 104), openTime: Date.UTC(2026, 5, 24, 16, 0) }
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.daily).toEqual([
      { day: "2026-06-24", startEquityUsdt: 100, endEquityUsdt: 100, pnlUsdt: 0, returnPct: 0, trades: 0 },
      { day: "2026-06-25", startEquityUsdt: 100, endEquityUsdt: 115, pnlUsdt: 15, returnPct: 15, trades: 1 }
    ]);
  });

  it("halts new entries after reaching the daily profit target", () => {
    const rows = [
      row(0, 100, 98, 101),
      row(1, 103, 102, 104),
      row(2, 100, 98, 101),
      row(3, 103, 102, 104)
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined, "buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0,
      dailyProfitTargetPct: 5
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.pnlUsdt).toBe(15);
    expect(result.endingEquityUsdt).toBe(115);
  });

  it("can force positions flat at the Asia Shanghai day boundary", () => {
    const rows = [
      { ...row(0, 100, 90, 101), openTime: Date.UTC(2026, 5, 24, 15, 58) },
      { ...row(1, 101, 100, 102), openTime: Date.UTC(2026, 5, 24, 15, 59) },
      { ...row(2, 102, 101, 103), openTime: Date.UTC(2026, 5, 24, 16, 0) }
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined, undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 10,
      maxLeverage: 25,
      feeRate: 0,
      stopMode: "percent",
      stopPct: 0.1,
      forceFlatAtDayEnd: true
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ exitReason: "day_end", exitPrice: 101 });
  });
});
