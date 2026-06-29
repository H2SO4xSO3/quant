import { describe, expect, it } from "vitest";
import { bitgetGranularityForInterval, fetchBitgetKlinesForInterval, parsedKlineToBinanceKline } from "./bitgetBacktest";
import type { ParsedKline } from "./types";

function parsed(openTime: number): ParsedKline {
  return {
    openTime,
    open: 100,
    high: 105,
    low: 95,
    close: 101,
    volume: 12,
    quoteVolume: 1212
  };
}

describe("Bitget backtest adapter", () => {
  it("maps Binance-style intervals to Bitget history-candle granularities", () => {
    expect(bitgetGranularityForInterval("5m")).toBe("5m");
    expect(bitgetGranularityForInterval("15m")).toBe("15m");
    expect(bitgetGranularityForInterval("1h")).toBe("1H");
  });

  it("converts parsed Bitget candles into Binance kline rows with interval close time", () => {
    const row = parsedKlineToBinanceKline(parsed(1_000), "15m");

    expect(row).toEqual([1_000, "100", "105", "95", "101", "12", 901_000 - 1, "1212"]);
  });

  it("fetches Bitget rows for the requested interval and converts them for the shared futures backtester", async () => {
    const calls: unknown[] = [];
    const rows = await fetchBitgetKlinesForInterval({
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      interval: "1h",
      startTime: 10,
      endTime: 20,
      fetchCandles: async (options) => {
        calls.push(options);
        return [parsed(10)];
      }
    });

    expect(calls).toEqual([
      {
        symbol: "BTCUSDT",
        productType: "USDT-FUTURES",
        granularity: "1H",
        startTime: 10,
        endTime: 20
      }
    ]);
    expect(rows[0][0]).toBe(10);
    expect(rows[0][6]).toBe(3_600_010 - 1);
  });

  it("retries transient Bitget rate limits before returning converted rows", async () => {
    let attempts = 0;
    const rows = await fetchBitgetKlinesForInterval({
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      interval: "5m",
      startTime: 10,
      endTime: 20,
      retryDelayMs: 0,
      fetchCandles: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Bitget candles HTTP 429: Too Many Requests");
        }
        return [parsed(10)];
      }
    });

    expect(attempts).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it("splits long Bitget history requests into smaller windows and de-duplicates rows", async () => {
    const calls: Array<{ startTime: number; endTime: number }> = [];
    const rows = await fetchBitgetKlinesForInterval({
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      interval: "5m",
      startTime: 0,
      endTime: 100,
      maxWindowMs: 40,
      fetchCandles: async (options) => {
        calls.push({ startTime: options.startTime, endTime: options.endTime });
        return [parsed(options.startTime), parsed(Math.min(options.endTime, options.startTime + 10))];
      }
    });

    expect(calls).toEqual([
      { startTime: 0, endTime: 40 },
      { startTime: 40, endTime: 80 },
      { startTime: 80, endTime: 100 }
    ]);
    expect(rows.map((row) => row[0])).toEqual([0, 10, 40, 50, 80, 90]);
  });
});
