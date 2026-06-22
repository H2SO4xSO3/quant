import { describe, expect, it, vi } from "vitest";
import { PolymarketCollector } from "./collector";
import type { PolymarketUpDownMarket } from "./types";

describe("polymarket collector", () => {
  it("keeps ended markets as metadata but skips live orderbook and trade polling", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const fetchOrderbook = vi.fn();
    const fetchTrades = vi.fn();
    const market = buildMarket({ marketEndTime: "2026-05-27T23:45:00.000Z" });
    const collector = new PolymarketCollector({
      config: {
        enabled: true,
        symbols: ["BTC"],
        timeframes: ["15m"],
        pollIntervalSeconds: 5,
        saveOrderbook: true,
        saveTrades: true,
        dataDir: "unused",
        gammaBaseUrl: "https://gamma-api.polymarket.com",
        clobBaseUrl: "https://clob.polymarket.com",
        dataApiBaseUrl: "https://data-api.polymarket.com",
        discoveryLimit: 10
      },
      client: {
        fetchCandidateEvents: async () => [market.rawEvent],
        fetchOrderbook,
        fetchTrades
      },
      store: {
        append: (kind, record) => records.push({ kind, record })
      },
      now: () => "2026-05-28T00:00:00.000Z"
    });

    await expect(collector.collectOnce()).resolves.toMatchObject({ markets: 1, orderbooks: 0, trades: 0, errors: 0 });
    expect(records.map((record) => record.kind)).toEqual(["market-metadata"]);
    expect(fetchOrderbook).not.toHaveBeenCalled();
    expect(fetchTrades).not.toHaveBeenCalled();
  });

  it("appends each market metadata and resolution record only once per running collector", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const market = buildMarket({ closed: true, marketEndTime: "2026-05-27T23:45:00.000Z", outcomePrices: "[\"1\", \"0\"]" });
    const collector = new PolymarketCollector({
      config: {
        enabled: true,
        symbols: ["BTC"],
        timeframes: ["15m"],
        pollIntervalSeconds: 5,
        saveOrderbook: true,
        saveTrades: true,
        dataDir: "unused",
        gammaBaseUrl: "https://gamma-api.polymarket.com",
        clobBaseUrl: "https://clob.polymarket.com",
        dataApiBaseUrl: "https://data-api.polymarket.com",
        discoveryLimit: 10
      },
      client: {
        fetchCandidateEvents: async () => [market.rawEvent],
        fetchOrderbook: vi.fn(),
        fetchTrades: vi.fn()
      },
      store: {
        append: (kind, record) => records.push({ kind, record })
      },
      now: () => "2026-05-28T00:00:00.000Z"
    });

    await collector.collectOnce();
    await collector.collectOnce();

    expect(records.filter((record) => record.kind === "market-metadata")).toHaveLength(1);
    expect(records.filter((record) => record.kind === "resolutions")).toHaveLength(1);
  });

  it("appends each trade transaction only once per running collector", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const market = buildMarket();
    const collector = new PolymarketCollector({
      config: {
        enabled: true,
        symbols: ["BTC"],
        timeframes: ["15m"],
        pollIntervalSeconds: 5,
        saveOrderbook: false,
        saveTrades: true,
        dataDir: "unused",
        gammaBaseUrl: "https://gamma-api.polymarket.com",
        clobBaseUrl: "https://clob.polymarket.com",
        dataApiBaseUrl: "https://data-api.polymarket.com",
        discoveryLimit: 10
      },
      client: {
        fetchCandidateEvents: async () => [market.rawEvent],
        fetchOrderbook: vi.fn(),
        fetchTrades: async () => [
          {
            marketId: "0xabc",
            tokenId: "up-token",
            side: "BUY",
            price: 0.51,
            size: 12,
            timestamp: 1779901201,
            raw: { transactionHash: "0xtrade" }
          }
        ]
      },
      store: {
        append: (kind, record) => records.push({ kind, record })
      },
      now: () => "2026-05-28T00:00:00.000Z"
    });

    await expect(collector.collectOnce()).resolves.toMatchObject({ trades: 1 });
    await expect(collector.collectOnce()).resolves.toMatchObject({ trades: 0 });
    expect(records.filter((record) => record.kind === "trades")).toHaveLength(1);
  });

  it("keeps failures local to the collector and records an error", async () => {
    const records: Array<{ kind: string; record: unknown }> = [];
    const market = buildMarket();
    const collector = new PolymarketCollector({
      config: {
        enabled: true,
        symbols: ["BTC"],
        timeframes: ["15m"],
        pollIntervalSeconds: 5,
        saveOrderbook: true,
        saveTrades: true,
        dataDir: "unused",
        gammaBaseUrl: "https://gamma-api.polymarket.com",
        clobBaseUrl: "https://clob.polymarket.com",
        dataApiBaseUrl: "https://data-api.polymarket.com",
        discoveryLimit: 10
      },
      client: {
        fetchCandidateEvents: async () => [market.rawEvent],
        fetchOrderbook: async () => {
          throw new Error("orderbook unavailable");
        },
        fetchTrades: async () => []
      },
      store: {
        append: (kind, record) => records.push({ kind, record })
      },
      now: () => "2026-05-28T00:00:00.000Z"
    });

    await expect(collector.collectOnce()).resolves.toMatchObject({ markets: 1, errors: 2 });
    expect(records.some((record) => record.kind === "market-metadata")).toBe(true);
    expect(records.some((record) => record.kind === "price-snapshots")).toBe(true);
    expect(records.filter((record) => record.kind === "collector-errors")).toHaveLength(2);
  });
});

function buildMarket(overrides: { closed?: boolean; marketEndTime?: string; outcomePrices?: string } = {}): PolymarketUpDownMarket {
  const marketEndTime = overrides.marketEndTime;
  const closed = overrides.closed ?? false;
  const outcomePrices = overrides.outcomePrices ?? "[\"0.49\", \"0.51\"]";
  const rawEvent = {
    id: "event-1",
    slug: "btc-updown-15m-1771868700",
    title: "Bitcoin Up or Down - February 23, 12:45PM-1:00PM ET",
    endDate: marketEndTime,
    active: true,
    closed,
    markets: [
      {
        id: "market-1",
        conditionId: "0xabc",
        slug: "btc-updown-15m-1771868700",
        question: "Bitcoin Up or Down - February 23, 12:45PM-1:00PM ET",
        outcomes: "[\"Up\", \"Down\"]",
        clobTokenIds: "[\"up-token\", \"down-token\"]",
        outcomePrices,
        endDate: marketEndTime,
        active: true,
        closed
      }
    ]
  };
  return {
    symbol: "BTC",
    timeframe: "15m",
    eventId: "event-1",
    marketId: "market-1",
    conditionId: "0xabc",
    slug: "btc-updown-15m-1771868700",
    question: "Bitcoin Up or Down - February 23, 12:45PM-1:00PM ET",
    marketEndTime,
    outcomes: ["Up", "Down"],
    outcomeTokenIds: { Up: "up-token", Down: "down-token" },
    status: closed ? "closed" : "open",
    rawEvent,
    rawMarket: rawEvent.markets[0]
  };
}
