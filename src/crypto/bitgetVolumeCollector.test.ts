import { describe, expect, it, vi } from "vitest";
import { BitgetVolumeCollector } from "./bitgetVolumeCollector";
import type { BitgetMarketContext } from "./bitgetMarketData";

describe("Bitget volume collector", () => {
  it("appends one market-context per symbol and a summary", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const collector = new BitgetVolumeCollector({
      symbols: ["BTCUSDT", "XRPUSDT"],
      period: "5m",
      productType: "USDT-FUTURES",
      store: { append: (kind, record) => records.push({ kind, record }) },
      collect: async ({ symbol, period, productType }) => completeContext(symbol, period, productType),
      now: () => "2026-06-29T14:00:00.000Z"
    });

    await expect(collector.collectOnce()).resolves.toEqual({
      timestampReceived: "2026-06-29T14:00:00.000Z",
      symbols: 2,
      contexts: 2,
      blockers: 0,
      errors: 0
    });

    expect(records.map((record) => record.kind)).toEqual(["market-contexts", "market-contexts", "collector-summaries"]);
    expect(records[0].record).toMatchObject({ timestampReceived: "2026-06-29T14:00:00.000Z", symbol: "BTCUSDT" });
    expect(records[1].record).toMatchObject({ timestampReceived: "2026-06-29T14:00:00.000Z", symbol: "XRPUSDT" });
  });

  it("counts endpoint blockers but still persists the market context", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const collector = new BitgetVolumeCollector({
      symbols: ["BTCUSDT"],
      period: "5m",
      productType: "USDT-FUTURES",
      store: { append: (kind, record) => records.push({ kind, record }) },
      collect: async () => ({ ...completeContext("BTCUSDT", "5m", "USDT-FUTURES"), blockers: ["open-interest:blocked=data_missing field=openInterest"] }),
      now: () => "2026-06-29T14:00:00.000Z"
    });

    await expect(collector.collectOnce()).resolves.toMatchObject({ contexts: 1, blockers: 1, errors: 0 });
    expect(records[0].record).toMatchObject({ blockers: ["open-interest:blocked=data_missing field=openInterest"] });
  });

  it("keeps collection failures local and records an error", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const collector = new BitgetVolumeCollector({
      symbols: ["BTCUSDT"],
      period: "5m",
      productType: "USDT-FUTURES",
      store: { append: (kind, record) => records.push({ kind, record }) },
      collect: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      now: () => "2026-06-29T14:00:00.000Z"
    });

    await expect(collector.collectOnce()).resolves.toMatchObject({ contexts: 0, blockers: 0, errors: 1 });
    expect(records.map((record) => record.kind)).toEqual(["collector-errors", "collector-summaries"]);
    expect(records[0].record).toMatchObject({ symbol: "BTCUSDT", message: "network unavailable" });
  });
});

function completeContext(symbol: string, period: string, productType: string): BitgetMarketContext {
  return {
    symbol,
    productType,
    period,
    openInterest: { symbol, timestampMs: 1, openInterest: 10 },
    fundingRates: [{ symbol, timestampMs: 1, fundingRate: 0.0001 }],
    takerBuySell: [{ timestampMs: 1, buyVolume: 2, sellVolume: 1 }],
    longShort: [{ timestampMs: 1, longRatio: 0.51, shortRatio: 0.49, longShortRatio: 1.04 }],
    accountLongShort: [{ timestampMs: 1, longAccountRatio: 0.52, shortAccountRatio: 0.48, longShortAccountRatio: 1.08 }],
    positionLongShort: [{ timestampMs: 1, longPositionRatio: 0.53, shortPositionRatio: 0.47, longShortPositionRatio: 1.13 }],
    blockers: []
  };
}
