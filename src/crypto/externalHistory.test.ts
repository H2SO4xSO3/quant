import { describe, expect, it } from "vitest";
import { mergeExternalMarketHistory, type FreeExternalMarketContextReport } from "./externalHistory";

describe("external market history", () => {
  it("merges fresh external data into existing history without duplicating time points", () => {
    const existing = buildReport({
      generatedAt: "2026-05-21T00:00:00.000Z",
      fearGreed: [
        { value: 30, classification: "Fear", timestamp: 1000 },
        { value: 40, classification: "Neutral", timestamp: 2000 }
      ],
      openInterest: [
        { symbol: "BTCUSDT", timestamp: 1000, sumOpenInterest: 100, sumOpenInterestValue: 1000 },
        { symbol: "BTCUSDT", timestamp: 2000, sumOpenInterest: 110, sumOpenInterestValue: 1100 }
      ],
      fundingRates: [{ symbol: "BTCUSDT", fundingTime: 1000, fundingRate: 0.0001 }]
    });
    const fresh = buildReport({
      generatedAt: "2026-05-22T00:00:00.000Z",
      fearGreed: [
        { value: 41, classification: "Neutral", timestamp: 2000 },
        { value: 50, classification: "Greed", timestamp: 3000 }
      ],
      openInterest: [
        { symbol: "BTCUSDT", timestamp: 2000, sumOpenInterest: 111, sumOpenInterestValue: 1110 },
        { symbol: "BTCUSDT", timestamp: 3000, sumOpenInterest: 120, sumOpenInterestValue: 1200 }
      ],
      fundingRates: [
        { symbol: "BTCUSDT", fundingTime: 1000, fundingRate: 0.0002 },
        { symbol: "BTCUSDT", fundingTime: 3000, fundingRate: 0.0003 }
      ]
    });

    const merged = mergeExternalMarketHistory(existing, fresh);

    expect(merged.generatedAt).toBe("2026-05-22T00:00:00.000Z");
    expect(merged.fearGreed.map((point) => [point.timestamp, point.value])).toEqual([
      [1000, 30],
      [2000, 41],
      [3000, 50]
    ]);
    expect(merged.futures.BTCUSDT.openInterest.map((point) => [point.timestamp, point.sumOpenInterest])).toEqual([
      [1000, 100],
      [2000, 111],
      [3000, 120]
    ]);
    expect(merged.futures.BTCUSDT.fundingRates.map((point) => [point.fundingTime, point.fundingRate])).toEqual([
      [1000, 0.0002],
      [3000, 0.0003]
    ]);
    expect(merged.summaries[0].symbol).toBe("BTCUSDT");
  });
});

function buildReport(options: {
  generatedAt: string;
  fearGreed: FreeExternalMarketContextReport["fearGreed"];
  openInterest: FreeExternalMarketContextReport["futures"][string]["openInterest"];
  fundingRates: FreeExternalMarketContextReport["futures"][string]["fundingRates"];
}): FreeExternalMarketContextReport {
  return {
    generatedAt: options.generatedAt,
    days: 29,
    period: "15m",
    sources: {
      binanceFutures: "https://fapi.binance.com",
      fearGreed: "https://api.alternative.me/fng/"
    },
    limitations: [],
    fearGreed: options.fearGreed,
    futures: {
      BTCUSDT: {
        openInterest: options.openInterest,
        takerBuySell: [],
        globalLongShortAccountRatio: [],
        topLongShortAccountRatio: [],
        topLongShortPositionRatio: [],
        fundingRates: options.fundingRates
      }
    },
    summaries: []
  };
}
