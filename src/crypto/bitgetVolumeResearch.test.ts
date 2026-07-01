import { describe, expect, it } from "vitest";
import {
  buildDataOnlyBitgetVolumeMetrics,
  buildBitgetVolumeResearchReport,
  calculateBitgetFeatureCoverage,
  calculateBitgetFeatureTimeCoverage,
  gradeBitgetVolumeResearch
} from "./bitgetVolumeResearch";

describe("Bitget volume research gate", () => {
  it("returns no_trade when one-year evidence is negative", () => {
    const result = gradeBitgetVolumeResearch({
      trades: 54,
      returnPct: -232.4085,
      maxDrawdownPct: 258.7426,
      profitFactor: 0.5253,
      featureCoveragePct: 100,
      walkForwardPasses: 0,
      walkForwardWindows: 4
    });

    expect(result).toEqual({
      action: "hold",
      rawScore: 0,
      state: "no_trade",
      blocked: "blocked=negative_expectancy returnPct=-232.4085 profitFactor=0.5253",
      evidence: "trades=54 maxDrawdownPct=258.7426 walkForward=0/4 featureCoveragePct=100",
      nextCheck: "replace hypothesis; do not tune leverage"
    });
  });

  it("returns no_trade when true Bitget feature coverage is insufficient", () => {
    const result = gradeBitgetVolumeResearch({
      trades: 180,
      returnPct: 18,
      maxDrawdownPct: 12,
      profitFactor: 1.35,
      featureCoveragePct: 62,
      walkForwardPasses: 3,
      walkForwardWindows: 4
    });

    expect(result.state).toBe("no_trade");
    expect(result.blocked).toBe("blocked=data_missing featureCoveragePct=62");
  });

  it("returns no_trade when data is collected but no strategy trades exist yet", () => {
    const result = gradeBitgetVolumeResearch({
      trades: 0,
      returnPct: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
      featureCoveragePct: 100,
      walkForwardPasses: 0,
      walkForwardWindows: 0
    });

    expect(result.state).toBe("no_trade");
    expect(result.blocked).toBe("blocked=research_only_no_strategy_trades");
    expect(result.nextCheck).toBe("build walk-forward feature study before any entry rule");
  });

  it("allows observe_only but not sim_ready before paper evidence", () => {
    const result = gradeBitgetVolumeResearch({
      trades: 180,
      returnPct: 18,
      maxDrawdownPct: 12,
      profitFactor: 1.35,
      featureCoveragePct: 95,
      walkForwardPasses: 3,
      walkForwardWindows: 4
    });

    expect(result.action).toBe("hold");
    expect(result.state).toBe("observe_only");
    expect(result.blocked).toBe("blocked=paper_evidence_missing");
    expect(result.nextCheck).toBe("run 2-4 weeks paper before sim_ready");
  });

  it("builds a report that preserves hard state and blockers", () => {
    const report = buildBitgetVolumeResearchReport({
      days: 365,
      symbols: ["BTCUSDT", "XRPUSDT"],
      metrics: {
        trades: 0,
        returnPct: 0,
        maxDrawdownPct: 0,
        profitFactor: 0,
        featureCoveragePct: 0,
        walkForwardPasses: 0,
        walkForwardWindows: 0
      }
    });

    expect(report.exchange).toBe("bitget");
    expect(report.productType).toBe("USDT-FUTURES");
    expect(report.state).toBe("no_trade");
    expect(report.blocked).toBe("blocked=data_missing featureCoveragePct=0");
    expect(report.symbols).toEqual(["BTCUSDT", "XRPUSDT"]);
  });

  it("calculates true Bitget feature coverage from collected market contexts", () => {
    expect(calculateBitgetFeatureCoverage([completeMarketContext("BTCUSDT")])).toBe(100);
    expect(
      calculateBitgetFeatureCoverage([
        {
          ...completeMarketContext("BTCUSDT"),
          openInterest: undefined
        }
      ])
    ).toBe(83.33);
  });

  it("builds data-only metrics from collected market context without inventing trades", () => {
    expect(buildDataOnlyBitgetVolumeMetrics([completeMarketContext("BTCUSDT")])).toEqual({
      trades: 0,
      returnPct: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
      featureCoveragePct: 100,
      walkForwardPasses: 0,
      walkForwardWindows: 0
    });
  });

  it("downgrades coverage when collected rows do not span the requested research window", () => {
    const context = {
      ...completeMarketContext("BTCUSDT"),
      fundingRates: [
        { symbol: "BTCUSDT", timestampMs: 0, fundingRate: 0.0001 },
        { symbol: "BTCUSDT", timestampMs: 24 * 60 * 60 * 1000, fundingRate: 0.0001 }
      ],
      takerBuySell: [
        { timestampMs: 0, buyVolume: 2, sellVolume: 1 },
        { timestampMs: 5 * 60 * 1000, buyVolume: 2, sellVolume: 1 }
      ],
      longShort: [
        { timestampMs: 0, longRatio: 0.51, shortRatio: 0.49, longShortRatio: 1.04 },
        { timestampMs: 5 * 60 * 1000, longRatio: 0.52, shortRatio: 0.48, longShortRatio: 1.08 }
      ],
      accountLongShort: [
        { timestampMs: 0, longAccountRatio: 0.52, shortAccountRatio: 0.48, longShortAccountRatio: 1.08 },
        { timestampMs: 5 * 60 * 1000, longAccountRatio: 0.53, shortAccountRatio: 0.47, longShortAccountRatio: 1.13 }
      ],
      positionLongShort: [
        { timestampMs: 0, longPositionRatio: 0.53, shortPositionRatio: 0.47, longShortPositionRatio: 1.13 },
        { timestampMs: 5 * 60 * 1000, longPositionRatio: 0.54, shortPositionRatio: 0.46, longShortPositionRatio: 1.17 }
      ]
    };

    expect(calculateBitgetFeatureTimeCoverage([context], 365)).toBeLessThan(1);
    expect(buildDataOnlyBitgetVolumeMetrics([context], { days: 365 }).featureCoveragePct).toBeLessThan(1);
  });
});

function completeMarketContext(symbol: string) {
  return {
    symbol,
    productType: "USDT-FUTURES",
    period: "5m",
    openInterest: { symbol, timestampMs: 1, openInterest: 10 },
    fundingRates: [{ symbol, timestampMs: 1, fundingRate: 0.0001 }],
    takerBuySell: [{ timestampMs: 1, buyVolume: 2, sellVolume: 1 }],
    longShort: [{ timestampMs: 1, longRatio: 0.51, shortRatio: 0.49, longShortRatio: 1.04 }],
    accountLongShort: [{ timestampMs: 1, longAccountRatio: 0.52, shortAccountRatio: 0.48, longShortAccountRatio: 1.08 }],
    positionLongShort: [{ timestampMs: 1, longPositionRatio: 0.53, shortPositionRatio: 0.47, longShortPositionRatio: 1.13 }],
    blockers: []
  };
}
