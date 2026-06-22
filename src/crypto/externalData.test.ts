import { describe, expect, it } from "vitest";
import {
  buildRequestWindows,
  clampFuturesDays,
  normalizeFearGreedResponse,
  summarizeSymbolExternalData,
  type FuturesOpenInterestPoint,
  type FuturesTakerBuySellPoint
} from "./externalData";

describe("free external market data", () => {
  it("normalizes the Alternative.me fear and greed response into numeric daily points", () => {
    const points = normalizeFearGreedResponse({
      name: "Fear and Greed Index",
      data: [
        { value: "27", value_classification: "Fear", timestamp: "1779235200" },
        { value: "29", value_classification: "Fear", timestamp: "1779321600", time_until_update: "28866" }
      ],
      metadata: { error: null }
    });

    expect(points).toEqual([
      { value: 27, classification: "Fear", timestamp: 1779235200000 },
      { value: 29, classification: "Fear", timestamp: 1779321600000, timeUntilUpdateSeconds: 28866 }
    ]);
  });

  it("builds paginated windows that cover the requested range without exceeding the endpoint limit", () => {
    const windows = buildRequestWindows({
      endTime: 1_000_000_000,
      days: 1,
      intervalMs: 5 * 60 * 1000,
      limit: 100
    });

    expect(windows.length).toBe(3);
    expect(windows[0].startTime).toBe(913_600_000);
    expect(windows[0].endTime - windows[0].startTime).toBe(30_000_000);
    expect(windows.at(-1)?.endTime).toBe(1_000_000_000);
  });

  it("keeps Binance futures history requests inside the practical retention boundary", () => {
    expect(clampFuturesDays(30)).toBe(29);
    expect(clampFuturesDays(365)).toBe(29);
    expect(clampFuturesDays(0)).toBe(1);
  });

  it("summarizes futures context without treating missing optional data as bullish", () => {
    const openInterest: FuturesOpenInterestPoint[] = [
      { symbol: "BTCUSDT", timestamp: 0, sumOpenInterest: 100, sumOpenInterestValue: 1000 },
      { symbol: "BTCUSDT", timestamp: 60 * 60 * 1000, sumOpenInterest: 110, sumOpenInterestValue: 1200 },
      { symbol: "BTCUSDT", timestamp: 4 * 60 * 60 * 1000, sumOpenInterest: 121, sumOpenInterestValue: 1500 }
    ];
    const takerBuySell: FuturesTakerBuySellPoint[] = [
      { timestamp: 0, buySellRatio: 0.8, buyVol: 80, sellVol: 100 },
      { timestamp: 4 * 60 * 60 * 1000, buySellRatio: 1.4, buyVol: 140, sellVol: 100 }
    ];

    const summary = summarizeSymbolExternalData("BTCUSDT", {
      openInterest,
      takerBuySell,
      globalLongShortAccountRatio: [],
      topLongShortAccountRatio: [],
      topLongShortPositionRatio: [],
      fundingRates: []
    });

    expect(summary.symbol).toBe("BTCUSDT");
    expect(summary.openInterestChange1hPct).toBeCloseTo(10);
    expect(summary.openInterestChange4hPct).toBeCloseTo(21);
    expect(summary.takerBuySellRatio).toBeCloseTo(1.4);
    expect(summary.globalLongShortRatio).toBeUndefined();
    expect(summary.bias).toBe("bullish_pressure");
  });
});
