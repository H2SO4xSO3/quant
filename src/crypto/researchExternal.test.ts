import { describe, expect, it } from "vitest";
import { buildExternalResearchContext, findExternalFeatureAt, EXTERNAL_RESEARCH_FILTERS } from "./researchExternal";

describe("research external context", () => {
  it("aligns futures context and daily fear-greed values to a 5m research candle", () => {
    const context = buildExternalResearchContext(
      {
        generatedAt: "2026-05-22T00:00:00.000Z",
        days: 29,
        period: "15m",
        fearGreed: [
          { value: 30, classification: "Fear", timestamp: 0 },
          { value: 45, classification: "Neutral", timestamp: 24 * 60 * 60 * 1000 }
        ],
        futures: {
          BTCUSDT: {
            openInterest: [
              { symbol: "BTCUSDT", timestamp: 0, sumOpenInterest: 100, sumOpenInterestValue: 1000 },
              { symbol: "BTCUSDT", timestamp: 60 * 60 * 1000, sumOpenInterest: 110, sumOpenInterestValue: 1200 },
              { symbol: "BTCUSDT", timestamp: 4 * 60 * 60 * 1000, sumOpenInterest: 121, sumOpenInterestValue: 1500 }
            ],
            takerBuySell: [{ timestamp: 4 * 60 * 60 * 1000, buySellRatio: 1.35, buyVol: 135, sellVol: 100 }],
            globalLongShortAccountRatio: [{ symbol: "BTCUSDT", timestamp: 4 * 60 * 60 * 1000, longShortRatio: 1.4 }],
            topLongShortAccountRatio: [{ symbol: "BTCUSDT", timestamp: 4 * 60 * 60 * 1000, longShortRatio: 1.3 }],
            topLongShortPositionRatio: [{ symbol: "BTCUSDT", timestamp: 4 * 60 * 60 * 1000, longShortRatio: 1.1 }],
            fundingRates: [{ symbol: "BTCUSDT", fundingTime: 3 * 60 * 60 * 1000, fundingRate: 0.00008 }]
          }
        }
      },
      { maxStalenessMs: 20 * 60 * 1000 }
    );

    const feature = findExternalFeatureAt(context, "BTCUSDT", 4 * 60 * 60 * 1000 + 5 * 60 * 1000);

    expect(feature?.openInterestChange1hPct).toBeCloseTo(10);
    expect(feature?.openInterestChange4hPct).toBeCloseTo(21);
    expect(feature?.takerBuySellRatio).toBeCloseTo(1.35);
    expect(feature?.fundingRatePct).toBeCloseTo(0.008);
    expect(feature?.fearGreedValue).toBe(30);
    expect(feature?.crowdedLong).toBe(false);
  });

  it("does not reuse stale external points for later candles", () => {
    const context = buildExternalResearchContext(
      {
        generatedAt: "2026-05-22T00:00:00.000Z",
        days: 29,
        period: "15m",
        fearGreed: [],
        futures: {
          BTCUSDT: {
            openInterest: [{ symbol: "BTCUSDT", timestamp: 0, sumOpenInterest: 100, sumOpenInterestValue: 1000 }],
            takerBuySell: [],
            globalLongShortAccountRatio: [],
            topLongShortAccountRatio: [],
            topLongShortPositionRatio: [],
            fundingRates: []
          }
        }
      },
      { maxStalenessMs: 15 * 60 * 1000 }
    );

    expect(findExternalFeatureAt(context, "BTCUSDT", 16 * 60 * 1000)).toBeUndefined();
  });

  it("classifies a clean bullish external backdrop without accepting crowded longs", () => {
    const clean = {
      timestamp: 0,
      openInterestChange1hPct: 0.6,
      openInterestChange4hPct: 1.5,
      takerBuySellRatio: 1.25,
      topTraderPositionLongShortRatio: 1.4,
      fundingRatePct: 0.006,
      fearGreedValue: 45,
      fearGreedClassification: "Fear",
      crowdedLong: false,
      crowdedShort: false
    };
    const crowded = { ...clean, topTraderPositionLongShortRatio: 2.6, fundingRatePct: 0.04, crowdedLong: true };

    const bullishFilter = EXTERNAL_RESEARCH_FILTERS.find((filter) => filter.name === "external-bullish-pressure");

    expect(bullishFilter?.matches(clean)).toBe(true);
    expect(bullishFilter?.matches(crowded)).toBe(false);
  });
});
