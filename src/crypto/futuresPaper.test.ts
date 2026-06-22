import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CryptoBroker } from "./engine";
import { TradeEventLog } from "./eventLog";
import {
  estimateFuturesLiquidationPrice,
  runFuturesPaperCycle,
  summarizeFuturesPaperAccount,
  type FuturesPaperConfig
} from "./futuresPaper";
import { CryptoJournal } from "./journal";
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

const longStrategy: CryptoStrategy = {
  id: "long",
  label: "long",
  generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => ({
    symbol: analysis.symbol,
    action: "buy",
    score: 100,
    entryPrice: analysis.price,
    stopLoss: analysis.price * 0.99,
    takeProfit: analysis.price * 1.02,
    orderQuoteQty,
    reasons: ["test futures long"]
  })
};

const shortStrategy: CryptoStrategy = {
  id: "short",
  label: "short",
  generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => ({
    symbol: analysis.symbol,
    action: "sell",
    score: 100,
    entryPrice: analysis.price,
    stopLoss: analysis.price * 1.01,
    takeProfit: analysis.price * 0.98,
    orderQuoteQty,
    reasons: ["test futures short"]
  })
};

const holdStrategy: CryptoStrategy = {
  id: "hold",
  label: "hold",
  generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => ({
    symbol: analysis.symbol,
    action: "hold",
    score: 0,
    entryPrice: analysis.price,
    stopLoss: analysis.price * 0.99,
    takeProfit: analysis.price * 1.02,
    orderQuoteQty,
    reasons: ["test futures exit"]
  })
};

function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), "futures-paper-"));
  return {
    directory,
    journal: new CryptoJournal(path.join(directory, "futures-paper-journal.json")),
    eventLog: new TradeEventLog(path.join(directory, "futures-paper-events.json"))
  };
}

function config(overrides: Partial<FuturesPaperConfig> = {}): FuturesPaperConfig {
  return {
    leverage: 20,
    feeRate: 0.0004,
    estimatedSlippagePct: 0.03,
    priceImpactPct: 0.04,
    maintenanceMarginRate: 0.005,
    ...overrides
  };
}

describe("futures paper trading", () => {
  it("opens a 20x long using order quote as isolated margin", async () => {
    const { directory, journal, eventLog } = harness();
    try {
      const result = await runFuturesPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: longStrategy,
        futuresConfig: config({ leverage: 20 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      expect(result.opened).toHaveLength(1);
      expect(result.opened[0].direction).toBe("long");
      expect(result.opened[0].notionalUsdt).toBeCloseTo(400);
      expect(result.opened[0].quantity).toBeCloseTo(4);
      expect(result.opened[0].liquidationPrice).toBeCloseTo(95.5);
      expect(summarizeFuturesPaperAccount(journal, 100).cashUsdt).toBeCloseTo(80);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("records the online Chan snapshot on futures paper entries", async () => {
    const { directory, journal, eventLog } = harness();
    try {
      const result = await runFuturesPaperCycle({
        broker: chanBroker(),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: longStrategy,
        futuresConfig: config({ leverage: 20 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      expect(result.opened[0].notes?.find((note) => note.startsWith("Chan "))).toContain("setup=buy_divergence");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes a 20x long with leveraged PnL and notional-based costs", async () => {
    const { directory, journal, eventLog } = harness();
    try {
      await runFuturesPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: longStrategy,
        futuresConfig: config({ leverage: 20 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      const result = await runFuturesPaperCycle({
        broker: broker(102),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 },
        signalStrategy: holdStrategy,
        futuresConfig: config({ leverage: 20 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].realizedPnlUsdt).toBeCloseTo(7.3968);
      expect(summarizeFuturesPaperAccount(journal, 100).realizedPnlUsdt).toBeCloseTo(7.3968);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("opens and profits from a short when price falls", async () => {
    const { directory, journal, eventLog } = harness();
    try {
      await runFuturesPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: shortStrategy,
        futuresConfig: config({ leverage: 20 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      const result = await runFuturesPaperCycle({
        broker: broker(98),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 },
        signalStrategy: holdStrategy,
        futuresConfig: config({ leverage: 20 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].direction).toBe("short");
      expect(result.closed[0].realizedPnlUsdt).toBeGreaterThan(7);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("liquidates a 30x long near the isolated margin boundary", async () => {
    expect(estimateFuturesLiquidationPrice("long", 100, 30, 0.005)).toBeCloseTo(97.1666667);
    const { directory, journal, eventLog } = harness();
    try {
      await runFuturesPaperCycle({
        broker: broker(100),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80 },
        signalStrategy: longStrategy,
        futuresConfig: config({ leverage: 30 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      const result = await runFuturesPaperCycle({
        broker: broker(97),
        journal,
        eventLog,
        symbols: ["BTCUSDT"],
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, minBuyScore: 80, signalExitScore: 20 },
        signalStrategy: longStrategy,
        futuresConfig: config({ leverage: 30 }),
        initialCapitalUsdt: 100,
        marginUsdt: 20,
        maxOpenPositions: 5
      });

      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].realizedPnlUsdt).toBeCloseTo(-20);
      expect(result.closed[0].notes?.[0]).toBe("Futures paper liquidation exit");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
