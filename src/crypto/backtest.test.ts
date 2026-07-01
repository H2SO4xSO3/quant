import { describe, expect, it } from "vitest";
import { backtestSymbol } from "./backtest";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import type { BinanceClient } from "./binanceClient";
import type { BinanceKline, CryptoSignal } from "./types";
import type { CryptoStrategy } from "./strategyTypes";

function kline(openTime: number, close: number): BinanceKline {
  return [openTime, String(close), String(close + 1), String(close - 1), String(close), "10", openTime + 1, String(close * 10)];
}

function rows(count: number): BinanceKline[] {
  return Array.from({ length: count }, (_, index) => kline(index * 5 * 60 * 1000, 100 + index * 0.01));
}

describe("backtest symbol exits", () => {
  it("uses a signal-level maximum holding time when a strategy branch provides one", async () => {
    let calls = 0;
    const strategy: CryptoStrategy = {
      id: "test-signal-timeout",
      label: "test signal timeout",
      generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => {
        calls += 1;
        return {
          symbol: analysis.symbol,
          action: calls === 1 ? "buy" : "hold",
          score: calls === 1 ? 100 : 50,
          entryPrice: analysis.price,
          stopLoss: analysis.price * 0.5,
          takeProfit: analysis.price * 10,
          orderQuoteQty,
          maxHoldingMinutes: 10,
          reasons: ["test"]
        };
      }
    };
    const client = {
      fetchKlines: async () => rows(245)
    } as unknown as BinanceClient;

    const result = await backtestSymbol({
      client,
      symbol: "BTCUSDT",
      days: 1,
      orderQuoteQty: 20,
      strategy: { ...DEFAULT_STRATEGY_CONFIG, maxHoldingMinutes: 0, signalExitScore: -1 },
      signalStrategy: strategy
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].reason).toBe("timeout");
  });
  it("records structured trade diagnostics for attribution", async () => {
    let calls = 0;
    const strategy: CryptoStrategy = {
      id: "test-diagnostics",
      label: "test diagnostics",
      generateSignal: ({ analysis, orderQuoteQty }): CryptoSignal => {
        calls += 1;
        return {
          symbol: analysis.symbol,
          action: calls === 1 ? "buy" : "hold",
          score: calls === 1 ? 100 : 50,
          entryPrice: analysis.price,
          stopLoss: analysis.price * 0.5,
          takeProfit: analysis.price * 10,
          orderQuoteQty,
          maxHoldingMinutes: 10,
          reasons: ["diagnostic entry"]
        };
      }
    };
    const client = {
      fetchKlines: async () => rows(245)
    } as unknown as BinanceClient;

    const result = await backtestSymbol({
      client,
      symbol: "BTCUSDT",
      days: 1,
      orderQuoteQty: 20,
      strategy: { ...DEFAULT_STRATEGY_CONFIG, maxHoldingMinutes: 0, signalExitScore: -1 },
      signalStrategy: strategy
    });

    const trade = result.trades[0];
    expect(trade.strategyId).toBe("test-diagnostics");
    expect(trade.entryReason).toContain("diagnostic entry");
    expect(trade.exitReason).toBe("timeout");
    expect(trade.exitType).toBe("timeout");
    expect(trade.pnlPct).toBeTypeOf("number");
    expect(trade.holdingMinutes).toBe(10);
    expect(trade.rsiAtEntry).toBeTypeOf("number");
    expect(trade.priceVsVwapPctAtEntry).toBeTypeOf("number");
    expect(trade.emaFastSlopeAtEntry).toBeTypeOf("number");
    expect(trade.higherTrendGapPctAtEntry).toBeTypeOf("number");
    expect(trade.spreadPctAtEntry).toBeTypeOf("number");
    expect(trade.estimatedSlippagePct).toBe(DEFAULT_STRATEGY_CONFIG.estimatedSlippagePct);
    expect(trade.btcTrendAtEntry).toBe("bullish");
    expect(trade.maxFavorableExcursionPct).toBeGreaterThanOrEqual(0);
    expect(trade.maxAdverseExcursionPct).toBeLessThanOrEqual(0);
  });
});

