import { describe, expect, it } from "vitest";
import { buildDailyStrategyReview, formatDailyStrategyReview } from "./dailyReview";
import type { CryptoJournalEntry } from "./types";

function spotBuy(overrides: Partial<CryptoJournalEntry> = {}): CryptoJournalEntry {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    price: 100,
    quantity: 0.2,
    quoteQty: 20,
    realizedPnlUsdt: 0,
    open: false,
    timestamp: "2026-06-16T00:00:00.000Z",
    mode: "paper",
    ...overrides
  };
}

function spotSell(overrides: Partial<CryptoJournalEntry> = {}): CryptoJournalEntry {
  return {
    symbol: "BTCUSDT",
    side: "SELL",
    price: 100.2,
    quantity: 0.2,
    quoteQty: 20.04,
    realizedPnlUsdt: -0.0142,
    open: false,
    timestamp: "2026-06-16T00:30:00.000Z",
    mode: "paper",
    notes: ["Paper timeout exit", "Estimated paper costs 0.054200U"],
    ...overrides
  };
}

function futuresOpen(overrides: Partial<CryptoJournalEntry> = {}): CryptoJournalEntry {
  return {
    id: "futures_open",
    symbol: "ETHUSDT",
    side: "BUY",
    direction: "long",
    leverage: 30,
    price: 100,
    quantity: 6,
    quoteQty: 20,
    marginUsdt: 20,
    notionalUsdt: 600,
    liquidationPrice: 96.8,
    realizedPnlUsdt: 0,
    open: false,
    timestamp: "2026-06-16T01:00:00.000Z",
    mode: "futures_paper",
    notes: ["Futures long 30x"],
    ...overrides
  };
}

function futuresClose(overrides: Partial<CryptoJournalEntry> = {}): CryptoJournalEntry {
  return {
    symbol: "ETHUSDT",
    side: "SELL",
    direction: "long",
    leverage: 30,
    price: 96.7,
    quantity: 6,
    quoteQty: 580.2,
    marginUsdt: 20,
    notionalUsdt: 580.2,
    liquidationPrice: 96.8,
    realizedPnlUsdt: -20,
    open: false,
    timestamp: "2026-06-16T01:20:00.000Z",
    mode: "futures_paper",
    notes: [
      "Futures paper liquidation exit",
      "Futures long 30x",
      "Estimated futures costs 0.712080U",
      "Gross futures PnL -19.800000U"
    ],
    ...overrides
  };
}

describe("daily strategy review", () => {
  it("aggregates spot and futures paper journals into root-cause findings", () => {
    const review = buildDailyStrategyReview(
      [
        {
          id: "spot-baseline",
          label: "spot baseline",
          mode: "paper",
          initialCapitalUsdt: 100,
          entries: [
            spotSell(),
            spotBuy(),
            spotSell({
              symbol: "DOGEUSDT",
              timestamp: "2026-06-16T03:30:00.000Z",
              realizedPnlUsdt: -0.254,
              notes: ["Paper stop_loss exit", "Estimated paper costs 0.054000U"]
            }),
            spotBuy({ symbol: "DOGEUSDT", timestamp: "2026-06-16T03:00:00.000Z" })
          ]
        },
        {
          id: "futures-long-30x",
          label: "futures long 30x",
          mode: "futures_paper",
          initialCapitalUsdt: 100,
          entries: [futuresClose(), futuresOpen()]
        }
      ],
      { now: new Date("2026-06-17T00:00:00.000Z"), windowHours: 24 }
    );

    expect(review.totals.closedTrades).toBe(3);
    expect(review.totals.netPnlUsdt).toBeCloseTo(-20.2682);
    expect(review.totals.estimatedCostsUsdt).toBeCloseTo(0.82028);
    expect(review.totals.liquidations).toBe(1);
    expect(review.sources["spot-baseline"].rootCauses).toContain("entry_quality_stop_loss");
    expect(review.sources["spot-baseline"].rootCauses).toContain("cost_drag");
    expect(review.sources["futures-long-30x"].rootCauses).toContain("liquidation_risk");
    expect(review.findings[0]).toContain("futures-long-30x");
    expect(review.hypotheses.some((item) => item.includes("leverage"))).toBe(true);
  });

  it("formats an operator review with debate-style sections and concrete next tests", () => {
    const review = buildDailyStrategyReview(
      [
        {
          id: "spot-baseline",
          label: "spot baseline",
          mode: "paper",
          initialCapitalUsdt: 100,
          entries: [spotSell(), spotBuy()]
        }
      ],
      { now: new Date("2026-06-17T00:00:00.000Z"), windowHours: 24 }
    );

    const text = formatDailyStrategyReview(review);

    expect(text).toContain("# Daily Strategy Review 2026-06-17T00:00:00.000Z");
    expect(text).toContain("## Root Causes");
    expect(text).toContain("## Strategy Hypotheses");
    expect(text).toContain("## Risk Debate");
    expect(text).toContain("spot-baseline");
  });
  it("carries Chan entry labels into closed-trade review and root causes", () => {
    const review = buildDailyStrategyReview(
      [
        {
          id: "futures-short-20x",
          label: "futures short 20x",
          mode: "futures_paper",
          initialCapitalUsdt: 100,
          entries: [
            futuresClose({
              symbol: "BTCUSDT",
              direction: "short",
              side: "BUY",
              realizedPnlUsdt: -1.2,
              notes: ["Futures paper stop_loss exit", "Futures short 20x", "Estimated futures costs 0.7U", "Gross futures PnL -0.5U"]
            }),
            futuresOpen({
              symbol: "BTCUSDT",
              direction: "short",
              side: "SELL",
              notes: [
                "Futures short 20x",
                "Chan trend=up strokes=5 pivot=93.0000-106.0000 position=above_pivot divergence=bearish setup=sell_divergence"
              ]
            })
          ]
        }
      ],
      { now: new Date("2026-06-17T00:00:00.000Z"), windowHours: 24 }
    );

    expect(review.recentClosed[0].chan?.setup).toBe("sell_divergence");
    expect(review.sources["futures-short-20x"].rootCauses).toContain("chan_counter_trend");
    expect(formatDailyStrategyReview(review)).toContain("chan=trend=up/setup=sell_divergence/position=above_pivot");
  });

  it("marks timeout-dominated positive-gross negative-net futures results as observe-only exit-quality risk", () => {
    const review = buildDailyStrategyReview(
      [
        {
          id: "futures-opportunity-50x",
          label: "futures opportunity 50x",
          mode: "futures_paper",
          initialCapitalUsdt: 100,
          entries: [
            futuresClose({
              id: "timeout_close_1",
              timestamp: "2026-06-16T02:00:00.000Z",
              realizedPnlUsdt: -0.4,
              notes: ["Futures paper timeout exit", "Futures short 50x", "Estimated futures costs 1.5U", "Gross futures PnL 1.1U"]
            }),
            futuresOpen({
              id: "timeout_open_1",
              timestamp: "2026-06-16T01:00:00.000Z",
              side: "SELL",
              direction: "short",
              leverage: 50,
              notes: ["Futures short 50x"]
            }),
            futuresClose({
              id: "timeout_close_2",
              timestamp: "2026-06-16T04:00:00.000Z",
              realizedPnlUsdt: -0.2,
              notes: ["Futures paper timeout exit", "Futures short 50x", "Estimated futures costs 1.5U", "Gross futures PnL 1.3U"]
            }),
            futuresOpen({
              id: "timeout_open_2",
              timestamp: "2026-06-16T03:00:00.000Z",
              side: "SELL",
              direction: "short",
              leverage: 50,
              notes: ["Futures short 50x"]
            })
          ]
        }
      ],
      { now: new Date("2026-06-17T00:00:00.000Z"), windowHours: 24 }
    );

    expect(review.totals.grossPnlUsdt).toBeGreaterThan(0);
    expect(review.totals.netPnlUsdt).toBeLessThan(0);
    expect(review.findings.join(" ")).toContain("Timeout exits dominate");
    expect(review.riskDebate.operatorDecision).toContain("observe_only");
  });
});
