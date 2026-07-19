import { describe, expect, it } from "vitest";
import type { BitgetMarketContext } from "./bitgetMarketData";
import { buildBitgetVolumeObservationReportForRows, buildBitgetVolumeObservationReports } from "./bitgetVolumeObservation";

function context(overrides: Partial<BitgetMarketContext> & { timestampReceived: string; symbol: string }) {
  return {
    timestampReceived: overrides.timestampReceived,
    symbol: overrides.symbol,
    productType: "USDT-FUTURES",
    period: "5m",
    openInterest: overrides.openInterest,
    fundingRates: overrides.fundingRates ?? [{ symbol: overrides.symbol, timestampMs: 1_000, fundingRate: 0.000027 }],
    takerBuySell:
      overrides.takerBuySell ??
      Array.from({ length: 30 }, (_, index) => ({
        timestampMs: 1_000 + index,
        buyVolume: 95.62,
        sellVolume: 104.38
      })),
    longShort: overrides.longShort ?? [{ timestampMs: 1_000, longRatio: 0.65, shortRatio: 0.35, longShortRatio: 1.851 }],
    accountLongShort:
      overrides.accountLongShort ?? [{ timestampMs: 1_000, longAccountRatio: 0.66, shortAccountRatio: 0.34, longShortAccountRatio: 1.976 }],
    positionLongShort:
      overrides.positionLongShort ?? [{ timestampMs: 1_000, longPositionRatio: 0.493, shortPositionRatio: 0.507, longShortPositionRatio: 0.974 }],
    blockers: overrides.blockers ?? []
  };
}

describe("Bitget volume observation scoring", () => {
  it("scores a bounded prefix without copying or regrouping later rows", () => {
    const rows = [
      context({
        symbol: "BTCUSDT",
        timestampReceived: "2026-07-01T00:00:00.000Z",
        openInterest: { symbol: "BTCUSDT", timestampMs: 1_000, openInterest: 100 }
      }),
      context({
        symbol: "BTCUSDT",
        timestampReceived: "2026-07-01T01:00:00.000Z",
        openInterest: { symbol: "BTCUSDT", timestampMs: 2_000, openInterest: 102 }
      }),
      context({
        symbol: "BTCUSDT",
        timestampReceived: "2026-07-01T02:00:00.000Z",
        openInterest: { symbol: "BTCUSDT", timestampMs: 3_000, openInterest: 50 }
      })
    ];

    const bounded = buildBitgetVolumeObservationReportForRows(rows, { endIndex: 1, minHours: 1, minRawScore: 0 });
    const copiedPrefix = buildBitgetVolumeObservationReports({ contexts: rows.slice(0, 2), minHours: 1, minRawScore: 0 })[0];

    expect(bounded).toEqual(copiedPrefix);
    expect(bounded?.evidence.last).toBe("2026-07-01T01:00:00.000Z");
    expect(bounded?.evidence.openInterest24hPct).toBe(2);
  });

  it("keeps a weak short-leaning score as observe_only with explicit blockers", () => {
    const reports = buildBitgetVolumeObservationReports({
      minHours: 168,
      contexts: [
        context({
          symbol: "BTCUSDT",
          timestampReceived: "2026-06-29T15:21:43.867Z",
          openInterest: { symbol: "BTCUSDT", timestampMs: 1_000, openInterest: 35_337.32 }
        }),
        context({
          symbol: "BTCUSDT",
          timestampReceived: "2026-07-01T16:07:04.109Z",
          openInterest: { symbol: "BTCUSDT", timestampMs: 2_000, openInterest: 35_015.76 }
        })
      ]
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      symbol: "BTCUSDT",
      action: "hold",
      direction: "short_watch",
      rawScore: 56.2,
      state: "observe_only"
    });
    expect(reports[0].blocked).toContain("insufficient_volume_history 48.8h<168h");
    expect(reports[0].blocked).toContain("weak_edge rawScore=56.2<70");
    expect(reports[0].blocked).toContain("observe_only no execution gate connected");
  });

  it("does not allow a strong raw score to become executable before coverage matures", () => {
    const reports = buildBitgetVolumeObservationReports({
      minHours: 168,
      contexts: [
        context({
          symbol: "XRPUSDT",
          timestampReceived: "2026-06-29T15:00:00.000Z",
          openInterest: { symbol: "XRPUSDT", timestampMs: 1_000, openInterest: 100 },
          fundingRates: [{ symbol: "XRPUSDT", timestampMs: 1_000, fundingRate: -0.00003 }],
          longShort: [{ timestampMs: 1_000, longRatio: 0.45, shortRatio: 0.55, longShortRatio: 0.82 }],
          accountLongShort: [{ timestampMs: 1_000, longAccountRatio: 0.45, shortAccountRatio: 0.55, longShortAccountRatio: 0.82 }],
          positionLongShort: [{ timestampMs: 1_000, longPositionRatio: 0.45, shortPositionRatio: 0.55, longShortPositionRatio: 0.82 }]
        }),
        context({
          symbol: "XRPUSDT",
          timestampReceived: "2026-07-01T15:00:00.000Z",
          openInterest: { symbol: "XRPUSDT", timestampMs: 2_000, openInterest: 110 },
          takerBuySell: Array.from({ length: 30 }, (_, index) => ({ timestampMs: 2_000 + index, buyVolume: 75, sellVolume: 25 })),
          fundingRates: [{ symbol: "XRPUSDT", timestampMs: 2_000, fundingRate: -0.00003 }],
          longShort: [{ timestampMs: 2_000, longRatio: 0.45, shortRatio: 0.55, longShortRatio: 0.82 }],
          accountLongShort: [{ timestampMs: 2_000, longAccountRatio: 0.45, shortAccountRatio: 0.55, longShortAccountRatio: 0.82 }],
          positionLongShort: [{ timestampMs: 2_000, longPositionRatio: 0.45, shortPositionRatio: 0.55, longShortPositionRatio: 0.82 }]
        })
      ]
    });

    expect(reports[0].rawScore).toBeGreaterThanOrEqual(70);
    expect(reports[0]).toMatchObject({
      action: "hold",
      state: "observe_only"
    });
    expect(reports[0].blocked).toContain("insufficient_volume_history 48h<168h");
    expect(reports[0].blocked).toContain("observe_only no execution gate connected");
  });

  it("switches to forward-return validation once coverage matures", () => {
    const reports = buildBitgetVolumeObservationReports({
      minHours: 168,
      contexts: [
        context({
          symbol: "BTCUSDT",
          timestampReceived: "2026-06-24T15:00:00.000Z",
          openInterest: { symbol: "BTCUSDT", timestampMs: 1_000, openInterest: 100 }
        }),
        context({
          symbol: "BTCUSDT",
          timestampReceived: "2026-07-01T15:00:00.000Z",
          openInterest: { symbol: "BTCUSDT", timestampMs: 2_000, openInterest: 100 }
        })
      ]
    });

    expect(reports[0].evidence.hours).toBe(168);
    expect(reports[0].nextCheck).toBe(
      "validate score against forward returns; keep score as blocker/feature, not execution trigger"
    );
    expect(reports[0].nextCheck).not.toContain("rerun after 7d coverage");
  });
});
