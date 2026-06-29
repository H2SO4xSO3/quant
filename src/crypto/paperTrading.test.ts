import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CryptoBroker } from "./engine";
import { TradeEventLog } from "./eventLog";
import { CryptoJournal } from "./journal";
import { runPaperCycle, summarizePaperAccount } from "./paperTrading";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import type { CryptoStrategy } from "./strategyTypes";
import type { BinanceKline, CryptoSignal } from "./types";

function kline(close: number): BinanceKline {
  return [Date.now(), String(close), String(close + 1), String(close - 1), String(close), "10", Date.now() + 1, String(close * 10)];
}

function chanKline(index: number, high: number, low: number): BinanceKline {
  const close = (high + low) / 2;
  return [index * 5 * 60 * 1000, String(close), String(high), String(low), String(close), "10", index * 5 * 60 * 1000 + 1, String(close * 10)];
}

function chanRows(): BinanceKline[] {
  return [
    chanKline(0, 100, 90),
    chanKline(1, 105, 94),
    chanKline(2, 101, 93),
    chanKline(3, 100, 88),
    chanKline(4, 102, 90),
    chanKline(5, 108, 96),
    chanKline(6, 103, 95),
    chanKline(7, 101, 87),
    chanKline(8, 103, 89),
    chanKline(9, 106, 94),
    chanKline(10, 102, 93),
    chanKline(11, 100, 86),
    chanKline(12, 102, 88)
  ];
}

function broker(price: number): CryptoBroker {
  return {
    fetchMarket: async () => ({
      klines: [kline(price - 1), kline(price)],
      higherKlines: [kline(price - 1), kline(price)],
      depth: { bids: [[String(price - 0.1), "10"]], asks: [[String(price + 0.1), "10"]] },
      trades: [{ p: String(price), q: "1", m: false, T: Date.now() }]
    }),
    fetchTickerPrice: async () => price,
    getRules: async () => ({ symbol: "BTCUSDT", tickSize: 0.01, stepSize: 0.000001, minQty: 0.000001, maxQty: 1000, minNotional: 5 }),
    testMarketOrder: async () => ({}),
    placeMarketOrder: async () => ({})
  };
}

function chanBroker(): CryptoBroker {
  return {
    ...broker(97.5),
    fetchMarket: async () => ({
      klines: chanRows(),
      higherKlines: chanRows(),
      depth: { bids: [["97.4", "10"]], asks: [["97.6", "10"]] },
      trades: [{ p: "97.5", q: "1", m: false, T: Date.now() }]
    })
  };
}

const buyStrategy: CryptoStrategy = {
  id: "paper-buy",
  label: "paper buy",
  generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => ({
    symbol: analysis.symbol,
    action: "buy",
    score: 100,
    entryPrice: analysis.price,
    stopLoss: analysis.price * 0.98,
    takeProfit: analysis.price * 1.04,
    orderQuoteQty,
    reasons: ["paper test buy"]
  })
};

const exitStrategy: CryptoStrategy = {
  id: "paper-exit",
  label: "paper exit",
  generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => ({
    symbol: analysis.symbol,
    action: "hold",
    score: 0,
    entryPrice: analysis.price,
    stopLoss: analysis.price * 0.98,
    takeProfit: analysis.price * 1.04,
    orderQuoteQty,
    reasons: ["paper test exit"]
  })
};

const invalidatedHighScoreStrategy: CryptoStrategy = {
  id: "paper-invalidated-high-score",
  label: "paper invalidated high score",
  generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => ({
    symbol: analysis.symbol,
    action: "hold",
    score: 96,
    entryPrice: analysis.price,
    stopLoss: analysis.price * 0.98,
    takeProfit: analysis.price * 1.04,
    orderQuoteQty,
    reasons: ["Exit invalidation: reclaim lost VWAP/POC support"]
  })
};

function tempHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), "paper-trading-"));
  return {
    directory,
    journal: new CryptoJournal(path.join(directory, "paper-journal.json")),
    eventLog: new TradeEventLog(path.join(directory, "paper-events.json"))
  };
}

describe("paper trading", () => {
  it("opens a virtual position without calling real order endpoints", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      const result = await runPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      expect(result.opened).toHaveLength(1);
      expect(journal.read().entries.filter((entry) => entry.open)).toHaveLength(1);
      expect(journal.read().entries[0].mode).toBe("paper");
      expect(summarizePaperAccount(journal, 100).cashUsdt).toBeCloseTo(80);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("records the online Chan snapshot on paper entries", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      const result = await runPaperCycle({
        broker: chanBroker(),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      expect(result.opened[0].notes?.find((note) => note.startsWith("Chan "))).toContain("setup=buy_divergence");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes a virtual position when the signal exit threshold is crossed", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      await runPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      const result = await runPaperCycle({
        broker: broker(103),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 },
        signalStrategy: exitStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].realizedPnlUsdt).toBeGreaterThan(0);
      expect(journal.read().entries.filter((entry) => entry.open)).toHaveLength(0);
      expect(summarizePaperAccount(journal, 100).realizedPnlUsdt).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes a virtual position when the strategy emits an explicit exit invalidation reason", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      await runPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      const result = await runPaperCycle({
        broker: broker(100.2),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 },
        signalStrategy: invalidatedHighScoreStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].notes?.[0]).toBe("Paper signal_exit exit");
      expect(result.closed[0].notes?.join(" ")).toContain("Exit invalidation");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("deducts estimated fees and slippage from paper realized PnL", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      const costAwareConfig = {
        ...DEFAULT_STRATEGY_CONFIG,
        minBuyScore: 80,
        signalExitScore: 20,
        feeRate: 0.001,
        estimatedSlippagePct: 0.03,
        priceImpactPct: 0.04
      };

      await runPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: costAwareConfig,
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      const result = await runPaperCycle({
        broker: broker(101),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: costAwareConfig,
        signalStrategy: exitStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      const grossPnl = (101 - 100) * (20 / 100);
      const expectedCost = 20 * 0.001 + 101 * (20 / 100) * 0.001 + 20 * 0.0007;
      expect(result.closed[0].realizedPnlUsdt).toBeCloseTo(grossPnl - expectedCost);
      expect(summarizePaperAccount(journal, 100).realizedPnlUsdt).toBeCloseTo(grossPnl - expectedCost);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not timeout-close a small gross winner that is still net-negative after costs", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-07T02:10:00.000Z"));
      journal.append({
        id: "open-small-winner",
        symbol: "BTCUSDT",
        side: "BUY",
        price: 100,
        quantity: 0.2,
        quoteQty: 20,
        stopLoss: 98,
        takeProfit: 104,
        realizedPnlUsdt: 0,
        open: true,
        timestamp: "2026-06-07T01:00:00.000Z",
        mode: "paper",
        notes: ["paper test buy"]
      });

      const result = await runPaperCycle({
        broker: broker(100.1),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, maxHoldingMinutes: 60, signalExitScore: 0 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(0);
      expect(journal.read().entries.find((entry) => entry.id === "open-small-winner")?.open).toBe(true);
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("timeout-closes a small net-negative winner after the timeout grace period is exhausted", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-07T03:10:00.000Z"));
      journal.append({
        id: "stale-small-winner",
        symbol: "BTCUSDT",
        side: "BUY",
        price: 100,
        quantity: 0.2,
        quoteQty: 20,
        stopLoss: 98,
        takeProfit: 104,
        realizedPnlUsdt: 0,
        open: true,
        timestamp: "2026-06-07T01:00:00.000Z",
        mode: "paper",
        notes: ["paper test buy"]
      });

      const result = await runPaperCycle({
        broker: broker(100.1),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, maxHoldingMinutes: 60, signalExitScore: 0 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].notes?.[0]).toBe("Paper timeout exit");
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("records structured diagnostics on paper entry and exit rows", async () => {
    const { directory, journal, eventLog } = tempHarness();
    try {
      await runPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: buyStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      const entry = journal.read().entries[0];
      expect(entry.strategyId).toBe("paper-buy");
      expect(entry.entryTime).toBe(entry.timestamp);
      expect(entry.entryReason).toContain("paper test buy");
      expect(entry.rsiAtEntry).toBeTypeOf("number");
      expect(entry.priceVsVwapPctAtEntry).toBeTypeOf("number");
      expect(entry.emaFastSlopeAtEntry).toBeTypeOf("number");
      expect(entry.higherTrendGapPctAtEntry).toBeTypeOf("number");
      expect(entry.spreadPctAtEntry).toBeTypeOf("number");
      expect(entry.estimatedSlippagePct).toBe(DEFAULT_STRATEGY_CONFIG.estimatedSlippagePct);
      expect(entry.btcTrendAtEntry).toBe("unavailable");

      const result = await runPaperCycle({
        broker: broker(101),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 },
        signalStrategy: exitStrategy,
        initialCapitalUsdt: 100,
        orderQuoteQty: 20,
        maxOpenPositions: 5
      });

      const exit = result.closed[0];
      expect(exit.strategyId).toBe("paper-buy");
      expect(exit.entryTime).toBe(entry.timestamp);
      expect(exit.exitTime).toBe(exit.timestamp);
      expect(exit.exitReason).toBe("signal_exit");
      expect(exit.exitType).toBe("signal_exit");
      expect(exit.pnlPct).toBeTypeOf("number");
      expect(exit.holdingMinutes).toBeGreaterThanOrEqual(0);
      expect(exit.maxFavorableExcursionPct).toBeGreaterThan(0);
      expect(exit.maxAdverseExcursionPct).toBeLessThanOrEqual(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

