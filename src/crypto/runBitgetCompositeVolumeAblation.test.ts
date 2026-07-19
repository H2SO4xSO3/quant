import { describe, expect, it } from "vitest";
import type { StoredBitgetMarketContext } from "./bitgetVolumeObservation";
import {
  cachedCandlesCoverRange,
  parseCompositeVolumeAblationArgs,
  reconstructVolumeContextSnapshots,
  renderChineseCompositeVolumeAblationReport,
  type BitgetCompositeVolumeAblationReport
} from "./runBitgetCompositeVolumeAblation";

function context(timestampReceived: string, openInterest: number): StoredBitgetMarketContext {
  return {
    timestampReceived,
    symbol: "BTCUSDT",
    productType: "USDT-FUTURES",
    period: "5m",
    openInterest: { symbol: "BTCUSDT", timestampMs: Date.parse(timestampReceived), openInterest },
    fundingRates: [{ symbol: "BTCUSDT", timestampMs: Date.parse(timestampReceived), fundingRate: 0.00002 }],
    takerBuySell: [{ timestampMs: Date.parse(timestampReceived), buyVolume: 60, sellVolume: 40 }],
    longShort: [{ timestampMs: Date.parse(timestampReceived), longRatio: 0.52, shortRatio: 0.48, longShortRatio: 1.083 }],
    accountLongShort: [
      { timestampMs: Date.parse(timestampReceived), longAccountRatio: 0.52, shortAccountRatio: 0.48, longShortAccountRatio: 1.083 }
    ],
    positionLongShort: [
      { timestampMs: Date.parse(timestampReceived), longPositionRatio: 0.52, shortPositionRatio: 0.48, longShortPositionRatio: 1.083 }
    ],
    blockers: []
  };
}

describe("Bitget composite volume ablation runner", () => {
  it("refreshes a candle cache when its tail no longer covers the requested range", () => {
    const rows = [
      [300_000, "100", "101", "99", "100", "1", 599_999, "100"],
      [600_000, "100", "101", "99", "100", "1", 899_999, "100"]
    ] as never;

    expect(cachedCandlesCoverRange(rows, 0, 900_000, "5m")).toBe(true);
    expect(cachedCandlesCoverRange(rows, 0, 1_500_000, "5m")).toBe(false);
  });

  it("parses input and cache paths without changing defaults", () => {
    expect(
      parseCompositeVolumeAblationArgs(["--input", "frozen.jsonl", "--output-dir", "out", "--candle-cache-dir", "cache"])
    ).toEqual({ input: "frozen.jsonl", outputDir: "out", candleCacheDir: "cache" });
    expect(parseCompositeVolumeAblationArgs([])).toEqual({
      input: "data/bitget-composite-volume-ablation/market-contexts.jsonl",
      outputDir: "data/bitget-composite-volume-ablation",
      candleCacheDir: "data/bitget-composite-volume-ablation"
    });
  });

  it("reconstructs full causal volume snapshots after the history gate", () => {
    const snapshots = reconstructVolumeContextSnapshots(
      [context("2026-07-01T00:00:00.000Z", 100), context("2026-07-01T01:00:00.000Z", 102)],
      1
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      symbol: "BTCUSDT",
      timestampMs: Date.parse("2026-07-01T01:00:00.000Z"),
      direction: "long_watch",
      openInterest24hPct: 2,
      takerWindowImbalancePct: 20
    });
  });

  it("renders hard state, blockers, and paired variant results", () => {
    const report = {
      generatedAt: "2026-07-19T00:00:00.000Z",
      source: { input: "frozen.jsonl", sha256: "abc", totalRows: 10, validRows: 10, invalidRows: 0, firstTimestamp: "a", lastTimestamp: "b" },
      assumptions: { minHistoryHours: 168, candidateCooldownMinutes: 1440, maxContextAgeMinutes: 15, horizonsMinutes: [60], roundTripCostsPct: [0.2, 0.3] },
      volumeSnapshots: 2,
      routerObservations: 5,
      candidates: 2,
      blockerCounts: { volume_score_filter: { weak_volume_score: 1 }, crowding_flow_veto: {} },
      candleCoverage: [],
      summaries: [],
      grade: { action: "hold", rawScore: 76, state: "no_trade", blocked: "sample_too_small", evidence: "paired_completed_max=2 required=30", nextCheck: "collect" }
    } as BitgetCompositeVolumeAblationReport;

    const markdown = renderChineseCompositeVolumeAblationReport(report);
    expect(markdown).toContain("state=no_trade");
    expect(markdown).toContain("blocked=sample_too_small");
    expect(markdown).toContain("volume_score_filter");
    expect(markdown).toContain("配对");
  });
});
