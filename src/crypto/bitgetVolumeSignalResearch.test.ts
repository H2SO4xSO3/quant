import { describe, expect, it } from "vitest";
import {
  buildNonOverlappingBaselineReturns,
  compareReturnSamples,
  extractThresholdCrossings,
  gradeVolumeSignalResearch,
  labelSignalEvents,
  summarizeLabeledEvents
} from "./bitgetVolumeSignalResearch";

describe("Bitget volume threshold events", () => {
  it("emits only the first crossing while a score remains above the threshold", () => {
    const events = extractThresholdCrossings(
      [
        { symbol: "BTCUSDT", timestampMs: 0, direction: "long_watch", rawScore: 59 },
        { symbol: "BTCUSDT", timestampMs: 300_000, direction: "long_watch", rawScore: 70 },
        { symbol: "BTCUSDT", timestampMs: 600_000, direction: "long_watch", rawScore: 74 }
      ],
      70,
      0
    );

    expect(events.map((event) => event.timestampMs)).toEqual([300_000]);
  });

  it("requires a fresh below-to-above crossing after cooldown", () => {
    const events = extractThresholdCrossings(
      [
        { symbol: "BTCUSDT", timestampMs: 0, direction: "short_watch", rawScore: 71 },
        { symbol: "BTCUSDT", timestampMs: 600_000, direction: "short_watch", rawScore: 68 },
        { symbol: "BTCUSDT", timestampMs: 1_800_000, direction: "short_watch", rawScore: 72 },
        { symbol: "BTCUSDT", timestampMs: 2_400_000, direction: "short_watch", rawScore: 68 },
        { symbol: "BTCUSDT", timestampMs: 3_660_000, direction: "short_watch", rawScore: 72 }
      ],
      70,
      60
    );

    expect(events.map((event) => event.timestampMs)).toEqual([0, 3_660_000]);
  });

  it("preserves the observation fields on the emitted event", () => {
    const observation = { symbol: "btcusdt", timestampMs: 300_000, direction: "long_watch" as const, rawScore: 70 };

    expect(extractThresholdCrossings([observation], 70, 0)).toEqual([{ ...observation, threshold: 70 }]);
  });

  it("enters strictly after the observation and subtracts round-trip cost", () => {
    const [label] = labelSignalEvents({
      events: [
        {
          symbol: "BTCUSDT",
          timestampMs: 0,
          direction: "long_watch",
          rawScore: 70,
          threshold: 70
        }
      ],
      bars: [
        { symbol: "BTCUSDT", openTimeMs: 0, open: 99, high: 100, low: 98, close: 99 },
        { symbol: "BTCUSDT", openTimeMs: 300_000, open: 100, high: 103, low: 98, close: 102 },
        { symbol: "BTCUSDT", openTimeMs: 3_900_000, open: 102, high: 104, low: 101, close: 103 }
      ],
      horizonMinutes: 60,
      roundTripCostPct: 0.2
    });

    expect(label).toMatchObject({
      status: "completed",
      entryTimeMs: 300_000,
      exitTimeMs: 3_900_000,
      grossDirectionalReturnPct: 2,
      netDirectionalReturnPct: 1.8
    });
  });

  it("excludes pending horizons from completed return statistics", () => {
    const events = [
      { symbol: "BTCUSDT", timestampMs: 0, direction: "long_watch" as const, rawScore: 70, threshold: 70 },
      { symbol: "XRPUSDT", timestampMs: 0, direction: "long_watch" as const, rawScore: 72, threshold: 70 },
      { symbol: "ETHUSDT", timestampMs: 0, direction: "long_watch" as const, rawScore: 74, threshold: 70 }
    ];
    const labels = labelSignalEvents({
      events,
      bars: [
        { symbol: "BTCUSDT", openTimeMs: 300_000, open: 100, high: 101, low: 99, close: 100 },
        { symbol: "BTCUSDT", openTimeMs: 3_900_000, open: 101, high: 102, low: 100, close: 101 },
        { symbol: "XRPUSDT", openTimeMs: 300_000, open: 100, high: 101, low: 98, close: 99 },
        { symbol: "XRPUSDT", openTimeMs: 3_900_000, open: 99, high: 100, low: 98, close: 99 },
        { symbol: "ETHUSDT", openTimeMs: 300_000, open: 100, high: 101, low: 99, close: 100 }
      ],
      horizonMinutes: 60,
      roundTripCostPct: 0.2
    });

    expect(summarizeLabeledEvents(labels)).toMatchObject({
      completed: 2,
      pending: 1,
      meanNetReturnPct: -0.2,
      medianNetReturnPct: -0.2,
      winRatePct: 50,
      profitFactor: 0.6667,
      meanCi95Pct: [-1.2, 0.8]
    });
  });

  it("blocks a high latest score when the primary event sample is small", () => {
    expect(
      gradeVolumeSignalResearch({
        latestRawScores: { BTCUSDT: 62.8, XRPUSDT: 75.7 },
        primaryCells: [
          {
            horizonMinutes: 60,
            completed: 12,
            signalMinusBaselineMeanPct: 0.4,
            excessMeanCi95Pct: [0.1, 0.7]
          }
        ]
      })
    ).toEqual({
      action: "hold",
      rawScore: 75.7,
      state: "no_trade",
      blocked: "sample_too_small",
      evidence: "primary_threshold=70 completed_max=12 required=30",
      nextCheck: "collect more independent threshold-70 events"
    });
  });

  it("builds horizon-spaced same-direction baseline returns", () => {
    const returns = buildNonOverlappingBaselineReturns({
      bars: [
        { symbol: "BTCUSDT", openTimeMs: 0, open: 100, high: 100, low: 100, close: 100 },
        { symbol: "BTCUSDT", openTimeMs: 3_600_000, open: 102, high: 102, low: 102, close: 102 },
        { symbol: "BTCUSDT", openTimeMs: 7_200_000, open: 101, high: 101, low: 101, close: 101 }
      ],
      symbol: "BTCUSDT",
      direction: "long_watch",
      horizonMinutes: 60,
      roundTripCostPct: 0.2,
      startTimeMs: 0,
      endTimeMs: 7_200_000
    });

    expect(returns).toEqual([1.8, -1.18039216]);
  });

  it("compares signal returns with the same-period baseline", () => {
    const comparison = compareReturnSamples([0.8, -1.2], [0.1, 0.3]);
    expect(comparison).toMatchObject({
      signalMeanPct: -0.2,
      baselineMeanPct: 0.2,
      signalMinusBaselineMeanPct: -0.4
    });
    expect(comparison.excessMeanCi95Pct?.[0]).toBeLessThanOrEqual(-0.4);
    expect(comparison.excessMeanCi95Pct?.[1]).toBeGreaterThanOrEqual(-0.4);
  });

  it("caps robust three-horizon evidence at observe_only", () => {
    expect(
      gradeVolumeSignalResearch({
        latestRawScores: { XRPUSDT: 78 },
        primaryCells: [
          { horizonMinutes: 60, completed: 35, signalMinusBaselineMeanPct: 0.3, excessMeanCi95Pct: [0.1, 0.5] },
          { horizonMinutes: 240, completed: 34, signalMinusBaselineMeanPct: 0.4, excessMeanCi95Pct: [0.15, 0.7] },
          { horizonMinutes: 720, completed: 32, signalMinusBaselineMeanPct: 0.5, excessMeanCi95Pct: [0.2, 0.8] },
          { horizonMinutes: 1_440, completed: 28, signalMinusBaselineMeanPct: 0.1, excessMeanCi95Pct: [-0.1, 0.3] }
        ]
      })
    ).toMatchObject({
      action: "hold",
      rawScore: 78,
      state: "observe_only",
      blocked: "paper_evidence_missing"
    });
  });
});
