import { describe, expect, it } from "vitest";
import { labelLongOutcome, labelShortOutcome, summarizeOutcomes, type ResearchOutcome } from "./research";
import type { ParsedKline } from "./types";

function row(openTime: number, open: number, high: number, low: number, close: number): ParsedKline {
  return { openTime, open, high, low, close, volume: 1, quoteVolume: close };
}

describe("research outcome labelling", () => {
  it("uses a conservative stop-first assumption when TP and SL touch in the same future candle", () => {
    const rows = [
      row(0, 100, 100, 100, 100),
      row(300_000, 100, 100.8, 99.3, 100.2)
    ];

    const outcome = labelLongOutcome(rows, 0, {
      horizonBars: 1,
      takeProfitPct: 0.5,
      stopLossPct: 0.5,
      costPct: 0.27
    });

    expect(outcome.reason).toBe("stop_loss");
    expect(outcome.grossMovePct).toBeCloseTo(-0.5);
    expect(outcome.netPnlPct).toBeCloseTo(-0.77);
    expect(outcome.mfePct).toBeCloseTo(0.8);
    expect(outcome.maePct).toBeCloseTo(-0.7);
  });

  it("labels short outcomes with profit when price falls to take profit first", () => {
    const rows = [
      row(0, 100, 100, 100, 100),
      row(300_000, 100, 100.2, 99.2, 99.4)
    ];

    const outcome = labelShortOutcome(rows, 0, {
      horizonBars: 1,
      takeProfitPct: 0.5,
      stopLossPct: 0.5,
      costPct: 0.27
    });

    expect(outcome.reason).toBe("take_profit");
    expect(outcome.grossMovePct).toBeCloseTo(0.5);
    expect(outcome.netPnlPct).toBeCloseTo(0.23);
    expect(outcome.mfePct).toBeCloseTo(0.8);
    expect(outcome.maePct).toBeCloseTo(-0.2);
  });

  it("uses a conservative stop-first assumption for shorts too", () => {
    const rows = [
      row(0, 100, 100, 100, 100),
      row(300_000, 100, 100.8, 99.3, 99.8)
    ];

    const outcome = labelShortOutcome(rows, 0, {
      horizonBars: 1,
      takeProfitPct: 0.5,
      stopLossPct: 0.5,
      costPct: 0.27
    });

    expect(outcome.reason).toBe("stop_loss");
    expect(outcome.grossMovePct).toBeCloseTo(-0.5);
    expect(outcome.netPnlPct).toBeCloseTo(-0.77);
  });

  it("summarizes net edge, win rate, profit factor, and drawdown from labelled outcomes", () => {
    const outcomes: ResearchOutcome[] = [
      { reason: "take_profit", exitIndex: 1, exitPrice: 101, grossMovePct: 1, netPnlPct: 0.73, mfePct: 1, maePct: -0.1 },
      { reason: "stop_loss", exitIndex: 2, exitPrice: 99.5, grossMovePct: -0.5, netPnlPct: -0.77, mfePct: 0.2, maePct: -0.5 },
      { reason: "timeout", exitIndex: 3, exitPrice: 101.2, grossMovePct: 1.2, netPnlPct: 0.93, mfePct: 1.3, maePct: -0.2 }
    ];

    const summary = summarizeOutcomes("test-edge", outcomes);

    expect(summary.name).toBe("test-edge");
    expect(summary.trades).toBe(3);
    expect(summary.netPnlPct).toBeCloseTo(0.89);
    expect(summary.avgPnlPct).toBeCloseTo(0.296666, 5);
    expect(summary.winRate).toBeCloseTo(2 / 3);
    expect(summary.profitFactor).toBeCloseTo((0.73 + 0.93) / 0.77);
    expect(summary.maxDrawdownPct).toBeCloseTo(0.77);
  });
});
