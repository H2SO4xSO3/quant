import { describe, expect, it } from "vitest";
import {
  buildBitgetMarketDataUrl,
  collectBitgetMarketContext,
  fetchBitgetMarketDataPayload,
  parseBitgetAccountLongShortRows,
  parseBitgetFundingRateRows,
  parseBitgetLongShortRows,
  parseBitgetOpenInterestPayload,
  parseBitgetPositionLongShortRows,
  parseBitgetTakerBuySellRows
} from "./bitgetMarketData";

describe("Bitget market data adapter", () => {
  it("builds official Bitget market-data URLs without inventing endpoints", () => {
    const url = buildBitgetMarketDataUrl("taker-buy-sell", {
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      period: "5m"
    });

    expect(url.pathname).toBe("/api/v2/mix/market/taker-buy-sell");
    expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(url.searchParams.get("period")).toBe("5m");
    expect(url.searchParams.has("productType")).toBe(false);
  });

  it("adds product type and pagination only for futures contract-market endpoints", () => {
    const url = buildBitgetMarketDataUrl("history-fund-rate", {
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      pageSize: 100,
      pageNo: 2
    });

    expect(url.pathname).toBe("/api/v2/mix/market/history-fund-rate");
    expect(url.searchParams.get("productType")).toBe("USDT-FUTURES");
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(url.searchParams.get("pageNo")).toBe("2");
  });

  it("parses current open interest with the Bitget response timestamp", () => {
    const point = parseBitgetOpenInterestPayload(
      {
        ts: "1695796781616",
        openInterestList: [{ symbol: "BTCUSDT", size: "34278.06" }]
      },
      "BTCUSDT"
    );

    expect(point).toEqual({
      symbol: "BTCUSDT",
      timestampMs: 1695796781616,
      openInterest: 34278.06
    });
  });

  it("parses funding, taker volume, and positioning rows into timestamped numbers", () => {
    expect(parseBitgetFundingRateRows([{ symbol: "BTCUSDT", fundingRate: "0.0005", fundingTime: "1695776400000" }])).toEqual([
      { symbol: "BTCUSDT", timestampMs: 1695776400000, fundingRate: 0.0005 }
    ]);
    expect(parseBitgetTakerBuySellRows([{ buyVolume: "0.01", sellVolume: "0.12", ts: "1714020600000" }])).toEqual([
      { timestampMs: 1714020600000, buyVolume: 0.01, sellVolume: 0.12 }
    ]);
    expect(parseBitgetLongShortRows([{ longRatio: "0.51", shortRatio: "0.49", longShortRatio: "1.04", ts: "1714020600000" }])).toEqual([
      { timestampMs: 1714020600000, longRatio: 0.51, shortRatio: 0.49, longShortRatio: 1.04 }
    ]);
    expect(
      parseBitgetAccountLongShortRows([
        { longAccountRatio: "0.52", shortAccountRatio: "0.48", longShortAccountRatio: "1.08", ts: "1714020600000" }
      ])
    ).toEqual([{ timestampMs: 1714020600000, longAccountRatio: 0.52, shortAccountRatio: 0.48, longShortAccountRatio: 1.08 }]);
    expect(
      parseBitgetPositionLongShortRows([
        { longPositionRatio: "0.53", shortPositionRatio: "0.47", longShortPositionRatio: "1.13", ts: "1714020600000" }
      ])
    ).toEqual([{ timestampMs: 1714020600000, longPositionRatio: 0.53, shortPositionRatio: 0.47, longShortPositionRatio: 1.13 }]);
  });

  it("throws explicit data-missing blockers for absent real market fields", () => {
    expect(() => parseBitgetOpenInterestPayload({ ts: "1695796781616", openInterestList: [] }, "BTCUSDT")).toThrow(
      /blocked=data_missing field=openInterest/
    );
    expect(() => parseBitgetTakerBuySellRows([{ buyVolume: "0.01", ts: "1714020600000" }])).toThrow(
      /blocked=data_missing field=sellVolume/
    );
  });

  it("fetches Bitget payload data and throws explicit upstream errors", async () => {
    const seen: string[] = [];
    const data = await fetchBitgetMarketDataPayload<Record<string, unknown>[]>("taker-buy-sell", {
      symbol: "BTCUSDT",
      period: "5m",
      fetchImpl: async (url) => {
        seen.push(url.toString());
        return jsonResponse({ code: "00000", msg: "success", data: [{ buyVolume: "1", sellVolume: "2", ts: "1714020600000" }] });
      }
    });

    expect(data).toEqual([{ buyVolume: "1", sellVolume: "2", ts: "1714020600000" }]);
    expect(seen[0]).toContain("/api/v2/mix/market/taker-buy-sell?symbol=BTCUSDT&period=5m");

    await expect(
      fetchBitgetMarketDataPayload("taker-buy-sell", {
        symbol: "BTCUSDT",
        fetchImpl: async () => jsonResponse({ code: "40017", msg: "Parameter verification failed" })
      })
    ).rejects.toThrow(/Bitget taker-buy-sell error 40017: Parameter verification failed/);
  });

  it("collects one symbol market context without fabricating missing endpoints", async () => {
    const context = await collectBitgetMarketContext({
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      period: "5m",
      throttleMs: 0,
      fetchImpl: async (url) => {
        switch (url.pathname) {
          case "/api/v2/mix/market/open-interest":
            return jsonResponse({
              code: "00000",
              msg: "success",
              data: { ts: "1695796781616", openInterestList: [{ symbol: "BTCUSDT", size: "34278.06" }] }
            });
          case "/api/v2/mix/market/history-fund-rate":
            return jsonResponse({
              code: "00000",
              msg: "success",
              data: [{ symbol: "BTCUSDT", fundingRate: "0.0005", fundingTime: "1695776400000" }]
            });
          case "/api/v2/mix/market/taker-buy-sell":
            return jsonResponse({ code: "00000", msg: "success", data: [{ buyVolume: "0.01", sellVolume: "0.12", ts: "1714020600000" }] });
          case "/api/v2/mix/market/long-short":
            return jsonResponse({
              code: "00000",
              msg: "success",
              data: [{ longRatio: "0.51", shortRatio: "0.49", longShortRatio: "1.04", ts: "1714020600000" }]
            });
          case "/api/v2/mix/market/account-long-short":
            return jsonResponse({
              code: "00000",
              msg: "success",
              data: [{ longAccountRatio: "0.52", shortAccountRatio: "0.48", longShortAccountRatio: "1.08", ts: "1714020600000" }]
            });
          case "/api/v2/mix/market/position-long-short":
            return jsonResponse({
              code: "00000",
              msg: "success",
              data: [{ longPositionRatio: "0.53", shortPositionRatio: "0.47", longShortPositionRatio: "1.13", ts: "1714020600000" }]
            });
          default:
            throw new Error(`unexpected path ${url.pathname}`);
        }
      }
    });

    expect(context.blockers).toEqual([]);
    expect(context.openInterest?.openInterest).toBe(34278.06);
    expect(context.fundingRates).toHaveLength(1);
    expect(context.takerBuySell).toHaveLength(1);
    expect(context.longShort).toHaveLength(1);
    expect(context.accountLongShort).toHaveLength(1);
    expect(context.positionLongShort).toHaveLength(1);
  });
});

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}
