import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBitgetHistoryCandles } from "./bitgetClient";

function rawCandle(openTime: number): string[] {
  return [String(openTime), "100", "101", "99", "100", "10", "1000"];
}

describe("Bitget candle client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("overlaps pagination boundaries so interval-close semantics cannot drop a candle", async () => {
    const intervalMs = 300_000;
    const source = [0, 300_000, 600_000, 900_000, 1_200_000];
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = new URL(String(input));
      const endTime = Number(url.searchParams.get("endTime"));
      const limit = Number(url.searchParams.get("limit"));
      const data = source
        .filter((openTime) => openTime + intervalMs <= endTime)
        .slice(-limit)
        .reverse()
        .map(rawCandle);
      return {
        ok: true,
        json: async () => ({ code: "00000", msg: "success", data })
      };
    });

    const rows = await fetchBitgetHistoryCandles({
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      granularity: "5m",
      startTime: 0,
      endTime: 1_500_000,
      limit: 2,
      pageDelayMs: 0
    });

    expect(rows.map((row) => row.openTime)).toEqual(source);
  });
});
