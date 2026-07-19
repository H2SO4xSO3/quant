import { describe, expect, it } from "vitest";
import type { FuturesSignalObservation } from "./futuresBacktest";
import {
  buildCandidateLedger,
  buildVariantSummaries,
  extractRouterCandidates,
  gradeCompositeVolumeAblation,
  labelCandidateOutcomes,
  type VolumeContextSnapshot
} from "./bitgetCompositeVolumeAblation";

function observation(openTime: number, action: "buy" | "sell" | "hold", reasons: string[]): FuturesSignalObservation {
  return {
    symbol: "BTCUSDT",
    openTime,
    signal: {
      symbol: "BTCUSDT",
      action,
      score: 80,
      entryPrice: 100,
      stopLoss: 99,
      takeProfit: 102,
      orderQuoteQty: 20,
      reasons
    }
  };
}

function volume(overrides: Partial<VolumeContextSnapshot> = {}): VolumeContextSnapshot {
  return {
    symbol: "BTCUSDT",
    timestampMs: 1_000,
    rawScore: 75,
    direction: "long_watch",
    openInterest24hPct: 2,
    openInterest12hPct: 1,
    takerWindowImbalancePct: 12,
    longShortRatio: 1.1,
    accountLongShortRatio: 1.1,
    positionLongShortRatio: 1.1,
    latestFundingRatePct: 0.001,
    ...overrides
  };
}

describe("Bitget composite volume ablation", () => {
  it("keeps independent router entries, records the selected branch, and excludes exit-only sells", () => {
    const candidates = extractRouterCandidates(
      [
        observation(1_000, "buy", ["Bitget composite selected trend branch"]),
        observation(2_000, "buy", ["Bitget composite selected trend branch"]),
        observation(90_000_000, "buy", ["Bitget composite selected reversion branch"]),
        observation(180_000_000, "sell", ["Exit invalidation: Bitget composite overextension high-sell exit"])
      ],
      1_440
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.branch)).toEqual(["trend", "reversion"]);
    expect(candidates[0]).toMatchObject({ direction: "long_watch", strategyRawScore: 80 });
  });

  it("joins only latest prior volume context and blocks stale context", () => {
    const candidates = extractRouterCandidates([observation(600_000, "buy", ["Bitget composite selected trend branch"])], 0);
    const ledger = buildCandidateLedger({
      candidates,
      volumeSnapshots: [volume({ timestampMs: 500_000 }), volume({ timestampMs: 700_000, rawScore: 90 })],
      maxContextAgeMinutes: 15
    });

    expect(ledger[0].volume?.timestampMs).toBe(500_000);
    expect(ledger[0].decisions.volume_score_filter).toEqual({ accepted: true, blocked: null });

    const stale = buildCandidateLedger({
      candidates: extractRouterCandidates([observation(2_000_000, "buy", ["Bitget composite selected trend branch"])], 0),
      volumeSnapshots: [volume({ timestampMs: 500_000 })],
      maxContextAgeMinutes: 15
    });
    expect(stale[0].decisions.router_baseline.accepted).toBe(true);
    expect(stale[0].decisions.volume_score_filter.blocked).toBe("volume_context_stale");
    expect(stale[0].decisions.crowding_flow_veto.blocked).toBe("volume_context_stale");
  });

  it("applies score alignment separately from fixed crowding and adverse-flow vetoes", () => {
    const candidates = extractRouterCandidates(
      [
        observation(600_000, "buy", ["Bitget composite selected trend branch"]),
        { ...observation(90_000_000, "sell", ["Bitget composite selected trend branch"]), symbol: "XRPUSDT", signal: { ...observation(0, "sell", []).signal, symbol: "XRPUSDT" } }
      ],
      0
    );
    const ledger = buildCandidateLedger({
      candidates,
      volumeSnapshots: [
        volume({ timestampMs: 500_000, takerWindowImbalancePct: -12 }),
        volume({
          symbol: "XRPUSDT",
          timestampMs: 89_999_000,
          rawScore: 76,
          direction: "long_watch",
          takerWindowImbalancePct: 0
        })
      ]
    });

    expect(ledger[0].decisions.volume_score_filter.accepted).toBe(true);
    expect(ledger[0].decisions.crowding_flow_veto.blocked).toBe("adverse_taker_flow");
    expect(ledger[1].decisions.volume_score_filter.blocked).toBe("volume_direction_conflict");
    expect(ledger[1].decisions.crowding_flow_veto.accepted).toBe(true);
  });

  it("labels fixed horizons and computes candidate-wise paired filter deltas", () => {
    const candidates = extractRouterCandidates(
      [
        observation(0, "buy", ["Bitget composite selected trend branch"]),
        observation(90_000_000, "buy", ["Bitget composite selected trend branch"])
      ],
      0
    );
    const ledger = buildCandidateLedger({
      candidates,
      volumeSnapshots: [volume({ timestampMs: 0 }), volume({ timestampMs: 89_999_000, rawScore: 60 })]
    });
    const bars = [
      { symbol: "BTCUSDT", openTimeMs: 300_000, open: 100, high: 103, low: 99, close: 102 },
      { symbol: "BTCUSDT", openTimeMs: 3_900_000, open: 102, high: 103, low: 101, close: 102 },
      { symbol: "BTCUSDT", openTimeMs: 90_300_000, open: 100, high: 101, low: 96, close: 97 },
      { symbol: "BTCUSDT", openTimeMs: 93_900_000, open: 97, high: 98, low: 96, close: 97 }
    ];
    const outcomes = labelCandidateOutcomes({ ledger, bars, horizonsMinutes: [60], roundTripCostsPct: [0.2] });
    const summaries = buildVariantSummaries({ ledger, outcomes, horizonsMinutes: [60], roundTripCostsPct: [0.2] });

    expect(outcomes.map((outcome) => outcome.netDirectionalReturnPct)).toEqual([1.8, -3.2]);
    expect(summaries.find((summary) => summary.variant === "router_baseline")?.summary.completed).toBe(2);
    expect(summaries.find((summary) => summary.variant === "volume_score_filter")).toMatchObject({
      acceptedCandidates: 1,
      paired: { completed: 2, meanDeltaPct: 1.6 }
    });
  });

  it("keeps a small paired sample in no_trade", () => {
    expect(
      gradeCompositeVolumeAblation({
        latestRawScore: 76,
        summaries: [
          {
            variant: "crowding_flow_veto",
            horizonMinutes: 60,
            roundTripCostPct: 0.3,
            totalCandidates: 20,
            acceptedCandidates: 12,
            blockedCandidates: 8,
            summary: {
              completed: 12,
              pending: 0,
              meanNetReturnPct: 0.4,
              medianNetReturnPct: 0.3,
              winRatePct: 60,
              profitFactor: 1.4,
              meanCi95Pct: [0.1, 0.7],
              meanMfePct: 1,
              meanMaePct: -0.5
            },
            paired: { completed: 20, meanDeltaPct: 0.2, meanDeltaCi95Pct: [0.05, 0.4] }
          }
        ]
      })
    ).toMatchObject({ action: "hold", rawScore: 76, state: "no_trade", blocked: "sample_too_small" });
  });
});
