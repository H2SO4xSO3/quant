import { describe, expect, it, vi } from "vitest";
import { PublicPolymarketClient } from "./client";

describe("polymarket public client", () => {
  it("discovers rolling 15m Up/Down markets by deterministic slugs before falling back to search", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/events/slug/btc-updown-15m-1779901200")) {
        return jsonResponse({
          id: "event-current",
          slug: "btc-updown-15m-1779901200",
          title: "Bitcoin Up or Down - May 27, 1:00PM-1:15PM ET",
          markets: [{ id: "market-current", conditionId: "0xabc", slug: "btc-updown-15m-1779901200" }]
        });
      }
      if (url.includes("/public-search?")) {
        return jsonResponse({ events: [] });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const client = new PublicPolymarketClient({
      gammaBaseUrl: "https://gamma-api.polymarket.com",
      clobBaseUrl: "https://clob.polymarket.com",
      dataApiBaseUrl: "https://data-api.polymarket.com",
      fetchImpl,
      now: () => new Date("2026-05-27T17:03:00.000Z")
    });

    const events = await client.fetchCandidateEvents(["BTC"], ["15m"], 10);

    expect(events.map((event) => event.slug)).toContain("btc-updown-15m-1779901200");
    expect(fetchImpl).toHaveBeenCalledWith("https://gamma-api.polymarket.com/events/slug/btc-updown-15m-1779901200");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
