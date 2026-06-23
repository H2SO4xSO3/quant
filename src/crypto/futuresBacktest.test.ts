import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import type { CryptoStrategy } from "./strategyTypes";
import type { BinanceKline, CryptoSignal } from "./types";
import { backtestFuturesSymbolFromRows } from "./futuresBacktest";

function row(index: number, overrides: { open?: number; high?: number; low?: number; close?: number; volume?: number } = {}): BinanceKline {
  const open = overrides.open ?? overrides.close ?? 100;
  const close = overrides.close ?? open;
  const high = overrides.high ?? Math.max(open, close);
  const low = overrides.low ?? Math.min(open, close);
  return [
    index * 5 * 60 * 1000,
    String(open),
    String(high),
    String(low),
    String(close),
    String(overrides.volume ?? 1000),
    index * 5 * 60 * 1000 + 5 * 60 * 1000 - 1,
    String(close * (overrides.volume ?? 1000))
  ];
}

function rowsWithExit(exit: { high?: number; low?: number; close?: number }): BinanceKline[] {
  return Array.from({ length: 245 }, (_, index) => (index === 241 ? row(index, exit) : row(index)));
}

function strategy(signal: Partial<CryptoSignal>): CryptoStrategy {
  return {
    id: "test-futures",
    label: "Test Futures",
    generateSignal: ({ analysis, orderQuoteQty }) => ({
      symbol: analysis.symbol,
      action: "hold",
      score: 100,
      entryPrice: analysis.price,
      stopLoss: analysis.price * 0.99,
      takeProfit: analysis.price * 1.01,
      orderQuoteQty,
      reasons: ["test signal"],
      ...signal
    })
  };
}

describe("futures backtest", () => {
  const futuresConfig = {
    leverage: 50,
    feeRate: 0.0004,
    estimatedSlippagePct: 0.03,
    priceImpactPct: 0.04,
    maintenanceMarginRate: 0.005
  };

  it("books a leveraged long take-profit trade net of futures costs", () => {
    const result = backtestFuturesSymbolFromRows({
      symbol: "BTCUSDT",
      raw5m: rowsWithExit({ high: 102, low: 99.8, close: 101 }),
      raw15m: rowsWithExit({ high: 102, low: 99.8, close: 101 }),
      marginUsdt: 20,
      strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, signalExitScore: -1 },
      futuresConfig,
      signalStrategy: strategy({ action: "buy", stopLoss: 99, takeProfit: 101 })
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      reason: "take_profit",
      entryPrice: 100,
      exitPrice: 101,
      marginUsdt: 20,
      notionalUsdt: 1000
    });
    expect(result.trades[0].grossPnlUsdt).toBeCloseTo(10, 6);
    expect(result.trades[0].costUsdt).toBeCloseTo(1.504, 6);
    expect(result.trades[0].pnlUsdt).toBeCloseTo(8.496, 6);
  });

  it("books a leveraged short take-profit trade net of futures costs", () => {
    const result = backtestFuturesSymbolFromRows({
      symbol: "ETHUSDT",
      raw5m: rowsWithExit({ high: 100.2, low: 98, close: 99 }),
      raw15m: rowsWithExit({ high: 100.2, low: 98, close: 99 }),
      marginUsdt: 20,
      strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, signalExitScore: -1 },
      futuresConfig,
      signalStrategy: strategy({ action: "sell", stopLoss: 101, takeProfit: 99 })
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "short",
      reason: "take_profit",
      entryPrice: 100,
      exitPrice: 99,
      marginUsdt: 20,
      notionalUsdt: 1000
    });
    expect(result.trades[0].grossPnlUsdt).toBeCloseTo(10, 6);
    expect(result.trades[0].costUsdt).toBeCloseTo(1.496, 6);
    expect(result.trades[0].pnlUsdt).toBeCloseTo(8.504, 6);
  });

  it("caps liquidation loss at the position margin", () => {
    const result = backtestFuturesSymbolFromRows({
      symbol: "SOLUSDT",
      raw5m: rowsWithExit({ high: 100.1, low: 98, close: 98.4 }),
      raw15m: rowsWithExit({ high: 100.1, low: 98, close: 98.4 }),
      marginUsdt: 20,
      strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, signalExitScore: -1 },
      futuresConfig,
      signalStrategy: strategy({ action: "buy", stopLoss: 97, takeProfit: 103 })
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      reason: "liquidation",
      exitPrice: 98.5
    });
    expect(result.trades[0].pnlUsdt).toBe(-20);
  });
});
