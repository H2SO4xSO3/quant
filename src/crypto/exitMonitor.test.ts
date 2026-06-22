import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runExitMonitor } from "./exitMonitor";
import { CryptoJournal } from "./journal";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import type { CryptoBroker } from "./engine";
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

function tempJournal() {
  const directory = mkdtempSync(path.join(tmpdir(), "crypto-exit-"));
  const journal = new CryptoJournal(path.join(directory, "journal.json"));
  journal.append({
    symbol: "BTCUSDT",
    side: "BUY",
    price: 100,
    quantity: 0.06,
    quoteQty: 6,
    stopLoss: 98,
    takeProfit: 104,
    realizedPnlUsdt: 0,
    open: true,
    timestamp: "2026-05-19T00:00:00.000Z",
    mode: "live"
  });
  return { directory, journal };
}

function brokerAt(price: number, calls: string[]): CryptoBroker {
  return {
    fetchMarket: async () => ({ klines: [], depth: { bids: [], asks: [] }, trades: [] }),
    fetchTickerPrice: async () => price,
    getRules: async (symbol) => rulesFor(symbol),
    testMarketOrder: async (order) => {
      calls.push(`test:${order.side}:${order.quantity}`);
      return {};
    },
    placeMarketOrder: async (order) => {
      calls.push(`place:${order.side}:${order.quantity}`);
      return { orderId: 88 };
    }
  };
}

describe("crypto exit monitor", () => {
  it("detects a stop-loss trigger but does not sell when live trading is disabled", async () => {
    const { directory, journal } = tempJournal();
    const calls: string[] = [];

    try {
      const result = await runExitMonitor({
        broker: brokerAt(97.5, calls),
        journal,
        riskConfig: { liveTrading: false, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }
      });

      expect(result.action).toBe("triggered");
      expect(result.trigger).toBe("stop_loss");
      expect(result.executed).toBe(false);
      expect(calls).toEqual([]);
      expect(journal.read().entries.find((entry) => entry.open)?.symbol).toBe("BTCUSDT");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("validates and places a market sell when stop-loss is triggered in live mode", async () => {
    const { directory, journal } = tempJournal();
    const calls: string[] = [];

    try {
      const result = await runExitMonitor({
        broker: brokerAt(97.5, calls),
        journal,
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }
      });

      expect(result.executed).toBe(true);
      expect(result.order).toEqual({ symbol: "BTCUSDT", side: "SELL", type: "MARKET", quantity: "0.06" });
      expect(calls).toEqual(["test:SELL:0.06", "place:SELL:0.06"]);
      expect(journal.read().entries.some((entry) => entry.side === "SELL" && entry.mode === "live")).toBe(true);
      expect(journal.read().entries.filter((entry) => entry.open)).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("records an error instead of crashing when a triggered sell is below min notional", async () => {
    const { directory, journal } = tempJournal();
    journal.update(journal.read().entries[0].id!, (entry) => ({ ...entry, quantity: 0.01, quoteQty: 1 }));
    const calls: string[] = [];

    try {
      const result = await runExitMonitor({
        broker: brokerAt(97.5, calls),
        journal,
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 }
      });

      expect(result.action).toBe("triggered");
      expect(result.trigger).toBe("stop_loss");
      expect(result.executed).toBe(false);
      expect(result.reason).toContain("below Binance min notional");
      expect(calls).toEqual([]);
      expect(journal.read().entries.find((entry) => entry.open)?.symbol).toBe("BTCUSDT");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("checks and sells multiple open positions in one pass", async () => {
    const { directory, journal } = tempJournal();
    journal.append({
      symbol: "ETHUSDT",
      side: "BUY",
      price: 100,
      quantity: 0.06,
      quoteQty: 6,
      stopLoss: 98,
      takeProfit: 104,
      realizedPnlUsdt: 0,
      open: true,
      timestamp: "2026-05-19T00:05:00.000Z",
      mode: "live"
    });
    const calls: string[] = [];

    try {
      const result = await runExitMonitor({
        broker: brokerAt(97.5, calls),
        journal,
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 2 }
      });

      expect(result.results).toHaveLength(2);
      expect(result.executedCount).toBe(2);
      expect(calls).toEqual(["test:SELL:0.06", "place:SELL:0.06", "test:SELL:0.06", "place:SELL:0.06"]);
      expect(journal.read().entries.filter((entry) => entry.open)).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("detects a timeout trigger using the configured maximum holding time", async () => {
    const { directory, journal } = tempJournal();
    const calls: string[] = [];

    try {
      const result = await runExitMonitor({
        broker: brokerAt(100.5, calls),
        journal,
        riskConfig: { liveTrading: false, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 },
        strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, maxHoldingMinutes: 60 }
      });

      expect(result.action).toBe("triggered");
      expect(result.trigger).toBe("timeout");
      expect(result.executed).toBe(false);
      expect(calls).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("raises a protective stop before the take-profit is hit", async () => {
    const { directory, journal } = tempJournal();
    const calls: string[] = [];

    try {
      const result = await runExitMonitor({
        broker: brokerAt(100.8, calls),
        journal,
        riskConfig: { liveTrading: true, maxOrderUsdt: 5, dailyMaxLossUsdt: 2, maxOpenPositions: 1 },
        strategyConfig: {
          minBuyScore: 80,
          emaFastPeriod: 9,
          emaSlowPeriod: 21,
          emaTrendPeriod: 50,
          higherEmaFastPeriod: 20,
          higherEmaSlowPeriod: 50,
          rsiPeriod: 14,
          atrPeriod: 14,
          atrStopMultiplier: 1.8,
          takeProfitRiskMultiple: 1.8,
          minPriceVwapPct: 0.15,
          maxPriceVwapPct: 3,
          minEmaFastSlopePct: 0.04,
          minHigherTrendGapPct: 0.05,
          minTakeProfitPct: 0.55,
          minExpectedValuePct: 0.08,
          estimatedSlippagePct: 0.03,
          priceImpactPct: 0.04,
          maxSpreadPct: 0.18,
          entryCooldownMinutes: 180,
          breakevenTriggerPct: 0.45,
          trailingStopTriggerPct: 0.75,
          trailingStopGivebackPct: 0.35,
          signalExitScore: 42,
          maxHoldingMinutes: 0,
          maxPositionLossUsdt: 3,
          feeRate: 0.001
        }
      });

      expect(result.action).toBe("watching");
      expect(calls).toEqual([]);
      expect(journal.read().entries.find((entry) => entry.open)?.stopLoss).toBeGreaterThan(100);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
