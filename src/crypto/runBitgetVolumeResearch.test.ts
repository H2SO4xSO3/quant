import { describe, expect, it } from "vitest";
import { buildBitgetVolumeResearchRunReport, parseBitgetVolumeResearchArgs } from "./runBitgetVolumeResearch";

describe("Bitget volume research runner args", () => {
  it("parses days, symbols, and output path", () => {
    expect(parseBitgetVolumeResearchArgs(["--days", "90", "--symbols", "BTCUSDT,XRPUSDT", "--period", "15m", "--output", "data/report.json"])).toEqual({
      days: 90,
      symbols: ["BTCUSDT", "XRPUSDT"],
      period: "15m",
      output: "data/report.json"
    });
  });

  it("uses a 365d BTC/XRP no-trade research report by default", () => {
    expect(parseBitgetVolumeResearchArgs([])).toEqual({
      days: 365,
      symbols: ["BTCUSDT", "XRPUSDT"],
      period: "5m",
      output: "data/bitget-volume-research-365d.json"
    });
  });

  it("builds a data-only run report from collected Bitget market contexts", () => {
    const report = buildBitgetVolumeResearchRunReport({
      days: 365,
      symbols: ["BTCUSDT"],
      period: "5m",
      contexts: [completeMarketContext("BTCUSDT")]
    });

    expect(report.state).toBe("no_trade");
    expect(report.blocked).toBe("blocked=data_missing featureCoveragePct=0");
    expect(report.metrics.featureCoveragePct).toBe(0);
    expect(report.marketContexts).toHaveLength(1);
    expect(report.marketContexts[0].symbol).toBe("BTCUSDT");
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
