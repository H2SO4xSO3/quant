import { describe, expect, it } from "vitest";
import { selectPolymarketUpDownMarkets } from "./marketDiscovery";

describe("polymarket market discovery", () => {
  it("selects only configured crypto 15m Up/Down markets and preserves outcome token IDs", () => {
    const selected = selectPolymarketUpDownMarkets(
      [
        {
          id: "event-1",
          slug: "btc-updown-15m-1771868700",
          title: "Bitcoin Up or Down - February 23, 12:45PM-1:00PM ET",
          description: "BTC 15m market",
          resolutionSource: "https://data.chain.link/streams/btc-usd",
          startDate: "2026-02-23T17:45:00Z",
          endDate: "2026-02-23T18:00:00Z",
          active: true,
          closed: false,
          volume: "100",
          liquidity: "25",
          markets: [
            {
              id: "market-1",
              conditionId: "0xabc",
              slug: "btc-updown-15m-1771868700",
              question: "Bitcoin Up or Down - February 23, 12:45PM-1:00PM ET",
              description: "BTC 15m market",
              outcomes: "[\"Up\", \"Down\"]",
              clobTokenIds: "[\"up-token\", \"down-token\"]",
              outcomePrices: "[\"0.47\", \"0.53\"]",
              enableOrderBook: true,
              active: true,
              closed: false,
              volume: "100",
              liquidity: "25"
            }
          ]
        },
        {
          id: "event-2",
          slug: "btc-updown-5m-1771868700",
          title: "Bitcoin Up or Down - five minute",
          markets: [
            {
              id: "market-2",
              conditionId: "0xdef",
              slug: "btc-updown-5m-1771868700",
              question: "Bitcoin Up or Down - five minute",
              outcomes: "[\"Up\", \"Down\"]",
              clobTokenIds: "[\"up-token-5m\", \"down-token-5m\"]",
              enableOrderBook: true,
              active: true,
              closed: false
            }
          ]
        }
      ],
      { symbols: ["BTC", "ETH", "SOL"], timeframes: ["15m"] }
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      symbol: "BTC",
      timeframe: "15m",
      marketId: "market-1",
      conditionId: "0xabc",
      slug: "btc-updown-15m-1771868700",
      outcomes: ["Up", "Down"],
      outcomeTokenIds: { Up: "up-token", Down: "down-token" }
    });
  });
});
