import { describe, expect, it } from "vitest";
import {
  buildResearchMatrix,
  findFiveMinuteCandleGaps,
  floorFiveMinuteOpenTime,
  lastClosedFiveMinuteOpenTime,
  parseVolumeSignalResearchArgs,
  parseStoredContextJsonl,
  reconstructHistoricalScoreObservations,
  renderChineseVolumeSignalReport
} from "./runBitgetVolumeSignalResearch";

describe("Bitget volume signal research runner", () => {
  it("counts malformed JSONL rows instead of silently replacing them", () => {
    const validContext = {
      timestampReceived: "2026-07-01T00:00:00.000Z",
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      period: "5m",
      openInterest: { symbol: "BTCUSDT", timestampMs: 1, openInterest: 10 },
      fundingRates: [],
      takerBuySell: [],
      longShort: [],
      accountLongShort: [],
      positionLongShort: [],
      blockers: []
    };

    const parsed = parseStoredContextJsonl(`${JSON.stringify(validContext)}\nnot-json\n`);

    expect(parsed.contexts).toHaveLength(1);
    expect(parsed.invalidRows).toBe(1);
    expect(parsed.totalRows).toBe(2);
  });

  it("renders the hard state and latest raw scores in Chinese Markdown", () => {
    const markdown = renderChineseVolumeSignalReport({
      generatedAt: "2026-07-13T07:00:00.000Z",
      source: {
        input: "data/input.jsonl",
        sha256: "abc",
        totalRows: 100,
        validRows: 99,
        invalidRows: 1,
        firstTimestamp: "2026-06-29T00:00:00.000Z",
        lastTimestamp: "2026-07-13T00:00:00.000Z"
      },
      assumptions: {
        minHistoryHours: 168,
        thresholds: [60, 65, 70],
        horizonsMinutes: [60, 240, 720, 1_440],
        roundTripCostsPct: [0, 0.12, 0.2, 0.3],
        primaryCooldownMinutes: 1_440
      },
      scoreObservations: 20,
      latestScores: {
        BTCUSDT: { rawScore: 62.8, direction: "long_watch" },
        XRPUSDT: { rawScore: 75.7, direction: "long_watch" }
      },
      candleCoverage: [],
      crossingCounts: {},
      cells: [
        {
          sample: "primary",
          threshold: 65,
          direction: "all",
          horizonMinutes: 60,
          cooldownMinutes: 1_440,
          roundTripCostPct: 0.2,
          crossingEvents: 10,
          summary: {
            completed: 9,
            pending: 1,
            meanNetReturnPct: -0.2,
            medianNetReturnPct: -0.1,
            winRatePct: 33.33,
            profitFactor: 0.8,
            meanCi95Pct: [-0.5, 0.1],
            meanMfePct: 0.4,
            meanMaePct: -0.5
          },
          comparison: {
            signalCount: 9,
            baselineCount: 9,
            signalMeanPct: -0.2,
            signalMedianPct: -0.1,
            baselineMeanPct: -0.25,
            baselineMedianPct: -0.2,
            signalMinusBaselineMeanPct: 0.05,
            excessMeanCi95Pct: [-0.1, 0.2]
          }
        }
      ],
      grade: {
        action: "hold",
        rawScore: 75.7,
        state: "no_trade",
        blocked: "sample_too_small",
        evidence: "primary_threshold=70 completed_max=12 required=30",
        nextCheck: "collect more independent threshold-70 events"
      }
    });

    expect(markdown).toContain("XRPUSDT rawScore=75.7");
    expect(markdown).toContain("state=no_trade");
    expect(markdown).toContain("blocked=sample_too_small");
    expect(markdown).toContain("next_check=collect more independent threshold-70 events");
    expect(markdown).toContain("| 65 | 60 | 9 | 1 | -0.2000 |");
  });

  it("reconstructs scores only after 168 hours of prior context", () => {
    const base = {
      symbol: "XRPUSDT",
      productType: "USDT-FUTURES",
      period: "5m",
      fundingRates: [{ symbol: "XRPUSDT", timestampMs: 1, fundingRate: -0.00003 }],
      takerBuySell: Array.from({ length: 30 }, (_, index) => ({ timestampMs: index, buyVolume: 75, sellVolume: 25 })),
      longShort: [{ timestampMs: 1, longRatio: 0.45, shortRatio: 0.55, longShortRatio: 0.82 }],
      accountLongShort: [{ timestampMs: 1, longAccountRatio: 0.45, shortAccountRatio: 0.55, longShortAccountRatio: 0.82 }],
      positionLongShort: [{ timestampMs: 1, longPositionRatio: 0.45, shortPositionRatio: 0.55, longShortPositionRatio: 0.82 }],
      blockers: []
    };
    const observations = reconstructHistoricalScoreObservations(
      [
        {
          ...base,
          timestampReceived: "2026-07-01T00:00:00.000Z",
          openInterest: { symbol: "XRPUSDT", timestampMs: 1, openInterest: 100 }
        },
        {
          ...base,
          timestampReceived: "2026-07-08T00:00:00.000Z",
          openInterest: { symbol: "XRPUSDT", timestampMs: 2, openInterest: 110 }
        }
      ],
      168
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ symbol: "XRPUSDT", timestampMs: Date.parse("2026-07-08T00:00:00.000Z") });
    expect(observations[0].rawScore).toBeGreaterThanOrEqual(70);
  });

  it("builds conservative primary and horizon-specific diagnostic cells", () => {
    const cells = buildResearchMatrix({
      observations: [
        { symbol: "BTCUSDT", timestampMs: 0, direction: "long_watch", rawScore: 59 },
        { symbol: "BTCUSDT", timestampMs: 300_000, direction: "long_watch", rawScore: 71 },
        { symbol: "BTCUSDT", timestampMs: 600_000, direction: "long_watch", rawScore: 68 },
        { symbol: "BTCUSDT", timestampMs: 900_000, direction: "long_watch", rawScore: 72 }
      ],
      bars: [
        { symbol: "BTCUSDT", openTimeMs: 600_000, open: 100, high: 101, low: 99, close: 100 },
        { symbol: "BTCUSDT", openTimeMs: 4_200_000, open: 102, high: 103, low: 101, close: 102 },
        { symbol: "BTCUSDT", openTimeMs: 7_800_000, open: 101, high: 102, low: 100, close: 101 }
      ],
      thresholds: [70],
      horizonsMinutes: [60],
      roundTripCostsPct: [0.2],
      primaryCooldownMinutes: 1_440
    });
    const primary = cells.find((cell) => cell.sample === "primary" && cell.direction === "all");

    expect(primary).toMatchObject({ threshold: 70, horizonMinutes: 60, cooldownMinutes: 1_440, crossingEvents: 1 });
    expect(primary?.summary.completed).toBe(1);
    expect(cells.some((cell) => cell.sample === "diagnostic" && cell.cooldownMinutes === 60)).toBe(true);
  });

  it("parses one-time runner paths without requiring package scripts", () => {
    expect(parseVolumeSignalResearchArgs(["--input", "input.jsonl", "--output-dir", "out", "--candle-cache-dir", "cache"])).toEqual({
      input: "input.jsonl",
      outputDir: "out",
      candleCacheDir: "cache"
    });
  });

  it("matches baseline count to completed signals when recent events are pending", () => {
    const cells = buildResearchMatrix({
      observations: [
        { symbol: "BTCUSDT", timestampMs: 0, direction: "long_watch", rawScore: 59 },
        { symbol: "BTCUSDT", timestampMs: 300_000, direction: "long_watch", rawScore: 71 },
        { symbol: "BTCUSDT", timestampMs: 4_200_000, direction: "long_watch", rawScore: 68 },
        { symbol: "BTCUSDT", timestampMs: 7_500_000, direction: "long_watch", rawScore: 72 }
      ],
      bars: [
        { symbol: "BTCUSDT", openTimeMs: 600_000, open: 100, high: 101, low: 99, close: 100 },
        { symbol: "BTCUSDT", openTimeMs: 4_200_000, open: 102, high: 103, low: 101, close: 102 },
        { symbol: "BTCUSDT", openTimeMs: 7_800_000, open: 101, high: 102, low: 100, close: 101 }
      ],
      thresholds: [70],
      horizonsMinutes: [60],
      roundTripCostsPct: [0.2],
      primaryCooldownMinutes: 0
    });
    const primary = cells.find((cell) => cell.sample === "primary" && cell.direction === "all");

    expect(primary?.summary).toMatchObject({ completed: 1, pending: 1 });
    expect(primary?.comparison).toMatchObject({ signalCount: 1, baselineCount: 1 });
  });

  it("uses the last fully closed five-minute candle as the fetch boundary", () => {
    expect(lastClosedFiveMinuteOpenTime(Date.parse("2026-07-13T07:06:30.000Z"))).toBe(Date.parse("2026-07-13T07:00:00.000Z"));
  });

  it("aligns the research start to a five-minute candle boundary", () => {
    expect(floorFiveMinuteOpenTime(Date.parse("2026-07-06T15:16:43.867Z"))).toBe(
      Date.parse("2026-07-06T15:15:00.000Z")
    );
  });

  it("detects missing five-minute candles at pagination boundaries", () => {
    expect(
      findFiveMinuteCandleGaps([
        { symbol: "BTCUSDT", openTimeMs: 0, open: 100, high: 100, low: 100, close: 100 },
        { symbol: "BTCUSDT", openTimeMs: 600_000, open: 101, high: 101, low: 101, close: 101 }
      ])
    ).toEqual([{ symbol: "BTCUSDT", afterMs: 0, beforeMs: 600_000, missingBars: 1 }]);
  });
});
