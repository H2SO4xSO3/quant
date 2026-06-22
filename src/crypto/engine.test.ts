import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCryptoCycle } from "./engine";
import { CryptoJournal } from "./journal";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import type { CryptoBroker } from "./engine";
import type { CryptoStrategy } from "./strategyTypes";
import type { SymbolRules } from "./types";

function rulesFor(symbol: string): SymbolRules {
  return {
    symbol,
    tickSize: 0.01,
    stepSize: 0.00001,
    minQty: 0.00001,
    maxQty: 9000,
    minNotional: 5
  };
}

const rules: SymbolRules = rulesFor("BTCUSDT");

const ethRules: SymbolRules = {
  ...rulesFor("ETHUSDT"),
  tickSize: 0.01,
};

const market = {
  klines: [
    [1, "103.1", "103.3", "103.0", "103.2", "10", 2, "1032"],
    [2, "103.2", "103.5", "103.1", "103.4", "20", 3, "2068"],
    [3, "103.4", "103.8", "103.3", "103.7", "30", 4, "3111"],
    [4, "103.7", "104.2", "103.6", "104", "40", 5, "4160"]
  ],
  depth: {
    bids: [
      ["103.9", "5"],
      ["103.5", "10"],
      ["102.8", "20"]
    ],
    asks: [
      ["104.1", "4"],
      ["104.5", "8"],
      ["105.2", "10"]
    ]
  },
  trades: [
    { p: "103.9", q: "1", m: false, T: 1 },
    { p: "104.0", q: "2", m: false, T: 2 },
    { p: "103.8", q: "1", m: true, T: 3 },
    { p: "104.2", q: "6", m: false, T: 4 }
  ]
};

function journalInTemp() {
  const directory = mkdtempSync(path.join(tmpdir(), "crypto-engine-"));
  return { directory, journal: new CryptoJournal(path.join(directory, "journal.json")) };
}

describe("crypto engine", () => {
  it("can swap the signal strategy without changing the execution engine", async () => {
    const { directory, journal } = journalInTemp();
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async () => ({}),
      placeMarketOrder: async () => ({})
    };
    const customStrategy: CryptoStrategy = {
      id: "test-strategy",
      label: "Test strategy",
      generateSignal: ({ analysis, orderQuoteQty }) => ({
        symbol: analysis.symbol,
        action: "hold",
        score: 1,
        entryPrice: analysis.price,
        stopLoss: analysis.price * 0.99,
        takeProfit: analysis.price * 1.02,
        orderQuoteQty,
        reasons: ["custom strategy was used"]
      })
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 },
        signalStrategy: customStrategy
      });

      expect(result.signal.action).toBe("hold");
      expect(result.signal.reasons).toContain("custom strategy was used");
      expect(journal.read().entries).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("dry-runs a buy signal without touching Binance order endpoints", async () => {
    const { directory, journal } = journalInTemp();
    const calls: string[] = [];
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async () => {
        calls.push("test");
        return {};
      },
      placeMarketOrder: async () => {
        calls.push("place");
        return {};
      }
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: false, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }
      });

      expect(result.signal.action).toBe("buy");
      expect(result.risk.mode).toBe("dry_run");
      expect(calls).toEqual([]);
      expect(journal.read().entries[0].mode).toBe("dry_run");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("validates with test order before placing a live spot order", async () => {
    const { directory, journal } = journalInTemp();
    const calls: string[] = [];
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async (order) => {
        calls.push(`test:${order.quoteOrderQty}`);
        return {};
      },
      placeMarketOrder: async (order) => {
        calls.push(`place:${order.quoteOrderQty}`);
        return { orderId: 123, status: "FILLED", executedQty: "0.05", cummulativeQuoteQty: order.quoteOrderQty };
      }
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }
      });

      expect(result.executed).toBe(true);
      expect(calls).toEqual(["test:5", "place:5"]);
      expect(journal.read().entries[0].open).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not write a live position when the exchange response has no confirmed fill", async () => {
    const { directory, journal } = journalInTemp();
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async () => ({}),
      placeMarketOrder: async () => ({ orderId: 123, status: "NEW" })
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }
      });

      expect(result.executed).toBe(false);
      expect(result.exchangeResponse).toEqual({ orderId: 123, status: "NEW" });
      expect(journal.read().entries).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("can open multiple different symbols in one live scan up to the position limit", async () => {
    const { directory, journal } = journalInTemp();
    const calls: string[] = [];
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async (symbol) => (symbol === "ETHUSDT" ? ethRules : rulesFor(symbol)),
      testMarketOrder: async (order) => {
        calls.push(`test:${order.symbol}:${order.quoteOrderQty}`);
        return {};
      },
      placeMarketOrder: async (order) => {
        calls.push(`place:${order.symbol}:${order.quoteOrderQty}`);
        return { executedQty: "0.05", cummulativeQuoteQty: order.quoteOrderQty };
      }
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT", "ETHUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 2 }
      });

      expect(result.executedCount).toBe(2);
      expect(result.decisions.filter((decision) => decision.executed)).toHaveLength(2);
      expect(calls).toEqual(["test:BTCUSDT:5", "place:BTCUSDT:5", "test:ETHUSDT:5", "place:ETHUSDT:5"]);
      expect(journal.read().entries.filter((entry) => entry.open)).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("holds a fresh buy when the symbol is still in entry cooldown", async () => {
    const { directory, journal } = journalInTemp();
    const calls: string[] = [];
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async () => {
        calls.push("test");
        return {};
      },
      placeMarketOrder: async () => {
        calls.push("place");
        return {};
      }
    };
    journal.append({
      symbol: "BTCUSDT",
      side: "SELL",
      price: 104,
      quantity: 0.05,
      realizedPnlUsdt: 0.1,
      open: false,
      timestamp: new Date().toISOString()
    });

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 },
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, entryCooldownMinutes: 180 }
      });

      expect(result.signal.action).toBe("hold");
      expect(result.executed).toBe(false);
      expect(calls).toEqual([]);
      expect(result.signal.reasons.some((reason) => reason.includes("entry cooldown"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lets the optional AI reviewer veto a deterministic buy", async () => {
    const { directory, journal } = journalInTemp();
    const calls: string[] = [];
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async () => {
        calls.push("test");
        return {};
      },
      placeMarketOrder: async () => {
        calls.push("place");
        return {};
      }
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 },
        aiReviewConfig: { enabled: true, apiKey: "test", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", timeoutMs: 1000 },
        aiReviewer: async () => ({ decision: "veto", confidence: 0.9, reason: "setup is too extended", riskTags: ["extended"] })
      });

      expect(result.signal.action).toBe("hold");
      expect(result.signal.aiReview?.decision).toBe("veto");
      expect(result.executed).toBe(false);
      expect(calls).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the raw score when the backtest guard blocks an otherwise strong buy", async () => {
    const { directory, journal } = journalInTemp();
    const broker: CryptoBroker = {
      fetchMarket: async () => market,
      fetchTickerPrice: async () => 104,
      getRules: async () => rules,
      testMarketOrder: async () => ({}),
      placeMarketOrder: async () => ({})
    };
    const customStrategy: CryptoStrategy = {
      id: "test-strategy",
      label: "Test strategy",
      generateSignal: ({ analysis, orderQuoteQty }) => ({
        symbol: analysis.symbol,
        action: "buy",
        score: 100,
        entryPrice: analysis.price,
        stopLoss: analysis.price * 0.99,
        takeProfit: analysis.price * 1.02,
        orderQuoteQty,
        reasons: ["strong setup"]
      })
    };

    try {
      const result = await runCryptoCycle({
        broker,
        journal,
        symbols: ["BTCUSDT"],
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 },
        signalStrategy: customStrategy,
        backtestGuardConfig: {
          enabled: true,
          reportPath: path.join(directory, "missing-backtest-report.json"),
          minNetPnlUsdt: 0,
          minProfitFactor: 1,
          minTrades: 5,
          maxAgeHours: 36,
          requireSymbolHealth: true,
          minSymbolNetPnlUsdt: 0,
          minSymbolProfitFactor: 1,
          minSymbolTrades: 3
        }
      });

      expect(result.signal.action).toBe("hold");
      expect(result.signal.score).toBe(100);
      expect(result.signal.reasons.some((reason) => reason.includes("Backtest guard blocked"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
