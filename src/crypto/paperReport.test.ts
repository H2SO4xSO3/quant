import { describe, expect, it } from "vitest";
import { buildPaperReport, formatPaperReport } from "./paperReport";
import type { CryptoJournalEntry } from "./types";

function buy(overrides: Partial<CryptoJournalEntry>): CryptoJournalEntry {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    price: 100,
    quantity: 0.2,
    quoteQty: 20,
    realizedPnlUsdt: 0,
    open: false,
    timestamp: "2026-06-07T00:00:00.000Z",
    mode: "paper",
    ...overrides
  };
}

function sell(overrides: Partial<CryptoJournalEntry>): CryptoJournalEntry {
  return {
    symbol: "BTCUSDT",
    side: "SELL",
    price: 101,
    quantity: 0.2,
    quoteQty: 20.2,
    realizedPnlUsdt: 0.1458,
    open: false,
    timestamp: "2026-06-07T00:30:00.000Z",
    mode: "paper",
    notes: ["Paper timeout exit", "Estimated paper costs 0.054200U"],
    ...overrides
  };
}

describe("paper report", () => {
  it("counts sell rows as closed trades and separates gross PnL from costs", () => {
    const report = buildPaperReport(
      [
        sell({ realizedPnlUsdt: 0.1458 }),
        buy({ realizedPnlUsdt: 0.1458 }),
        sell({
          symbol: "ETHUSDT",
          price: 99,
          quoteQty: 19.8,
          realizedPnlUsdt: -0.254,
          timestamp: "2026-06-07T01:30:00.000Z",
          notes: ["Paper stop_loss exit", "Estimated paper costs 0.054000U"]
        }),
        buy({ symbol: "ETHUSDT", timestamp: "2026-06-07T01:00:00.000Z", realizedPnlUsdt: -0.254 })
      ],
      { initialCapitalUsdt: 100, now: new Date("2026-06-07T02:00:00.000Z") }
    );

    expect(report.totals.closedTrades).toBe(2);
    expect(report.totals.netPnlUsdt).toBeCloseTo(-0.1082);
    expect(report.totals.estimatedCostsUsdt).toBeCloseTo(0.1082);
    expect(report.totals.grossPnlUsdt).toBeCloseTo(0);
    expect(report.byExitReason.timeout.netPnlUsdt).toBeCloseTo(0.1458);
    expect(report.byExitReason.stop_loss.netPnlUsdt).toBeCloseTo(-0.254);
  });

  it("formats an operator-readable report with recommendations", () => {
    const report = buildPaperReport([sell({ realizedPnlUsdt: -0.01 })], {
      initialCapitalUsdt: 100,
      now: new Date("2026-06-07T02:00:00.000Z")
    });

    const text = formatPaperReport(report);

    expect(text).toContain("Paper Trading Report");
    expect(text).toContain("Closed trades: 1");
    expect(text).toContain("Cost drag");
  });

  it("uses the time window for trade diagnostics but lifetime closed PnL for account state", () => {
    const report = buildPaperReport(
      [
        buy({ timestamp: "2026-06-05T00:00:00.000Z", realizedPnlUsdt: 0.5 }),
        sell({ timestamp: "2026-06-05T00:30:00.000Z", realizedPnlUsdt: 0.5 }),
        buy({ symbol: "ETHUSDT", open: true, timestamp: "2026-06-07T01:00:00.000Z", realizedPnlUsdt: 0 }),
        sell({ symbol: "SOLUSDT", timestamp: "2026-06-07T01:30:00.000Z", realizedPnlUsdt: -0.2 })
      ],
      { initialCapitalUsdt: 100, now: new Date("2026-06-07T02:00:00.000Z"), windowHours: 24 }
    );

    expect(report.totals.closedTrades).toBe(1);
    expect(report.totals.netPnlUsdt).toBeCloseTo(-0.2);
    expect(report.totals.cashUsdt).toBeCloseTo(80.3);
    expect(report.totals.equityAtCostUsdt).toBeCloseTo(100.3);
  });
});
