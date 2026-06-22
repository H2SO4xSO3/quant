import type { GammaEvent, OrderbookSnapshot, PolymarketTrade } from "./types";

export interface PolymarketClient {
  fetchCandidateEvents(symbols: string[], timeframes: string[], limit: number): Promise<GammaEvent[]>;
  fetchOrderbook(tokenId: string): Promise<OrderbookSnapshot>;
  fetchTrades(conditionId: string, limit: number): Promise<PolymarketTrade[]>;
}

export class PublicPolymarketClient implements PolymarketClient {
  constructor(
    private readonly options: {
      gammaBaseUrl: string;
      clobBaseUrl: string;
      dataApiBaseUrl: string;
      fetchImpl?: typeof fetch;
      now?: () => Date;
    }
  ) {}

  async fetchCandidateEvents(symbols: string[], timeframes: string[], limit: number): Promise<GammaEvent[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const events: GammaEvent[] = [];
    const seen = new Set<string>();
    const addEvent = (event: GammaEvent | undefined) => {
      if (!event) {
        return;
      }
      const key = event.id ?? event.slug;
      if (key && seen.has(key)) {
        return;
      }
      if (key) {
        seen.add(key);
      }
      events.push(event);
    };

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        let foundDirectSlug = false;
        for (const slug of rollingUpDownSlugs(symbol, timeframe, this.options.now?.() ?? new Date())) {
          const url = `${this.options.gammaBaseUrl}/events/slug/${slug}`;
          const response = await fetchImpl(url);
          if (response.status === 404) {
            continue;
          }
          if (!response.ok) {
            throw new Error(`Polymarket Gamma event lookup failed: ${response.status} ${response.statusText}`);
          }
          const event = (await response.json()) as GammaEvent;
          if (event.slug || event.id) {
            addEvent(event);
            foundDirectSlug = true;
          }
        }

        if (!foundDirectSlug) {
          for (const queryText of discoveryQueries(symbol, timeframe)) {
            const query = encodeURIComponent(queryText);
            const url = `${this.options.gammaBaseUrl}/public-search?q=${query}&limit=${limit}`;
            const response = await fetchImpl(url);
            if (!response.ok) {
              throw new Error(`Polymarket Gamma search failed: ${response.status} ${response.statusText}`);
            }
            const body = (await response.json()) as { events?: GammaEvent[] };
            for (const event of body.events ?? []) {
              addEvent(event);
            }
          }
        }
      }
    }

    return events;
  }

  async fetchOrderbook(tokenId: string): Promise<OrderbookSnapshot> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.options.clobBaseUrl}/book?token_id=${encodeURIComponent(tokenId)}`);
    if (!response.ok) {
      throw new Error(`Polymarket CLOB book failed for token ${tokenId}: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    return {
      tokenId,
      bids: normalizeLevels((body as { bids?: unknown[] }).bids),
      asks: normalizeLevels((body as { asks?: unknown[] }).asks),
      raw: body
    };
  }

  async fetchTrades(conditionId: string, limit: number): Promise<PolymarketTrade[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `${this.options.dataApiBaseUrl}/trades?market=${encodeURIComponent(conditionId)}&limit=${limit}`;
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Polymarket trades failed for market ${conditionId}: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    const rows = Array.isArray(body) ? body : (body as { trades?: unknown[] }).trades ?? [];
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        marketId: stringOrUndefined(record.market ?? record.market_id ?? record.conditionId),
        tokenId: stringOrUndefined(record.asset ?? record.asset_id ?? record.token_id),
        side: stringOrUndefined(record.side),
        price: stringOrNumber(record.price),
        size: stringOrNumber(record.size),
        timestamp: stringOrNumber(record.timestamp),
        raw: row
      };
    });
  }
}

function discoveryQueries(symbol: string, timeframe: string): string[] {
  const normalized = symbol.toUpperCase();
  const name = normalized === "BTC" ? "bitcoin" : normalized === "ETH" ? "ethereum" : normalized === "SOL" ? "solana" : normalized.toLowerCase();
  return [`${name} updown ${timeframe}`, `${name} up or down ${timeframe}`, `${normalized.toLowerCase()} updown ${timeframe}`];
}

function rollingUpDownSlugs(symbol: string, timeframe: string, now: Date): string[] {
  const prefix = slugSymbol(symbol);
  const seconds = timeframeSeconds(timeframe);
  if (!prefix || !seconds) {
    return [];
  }
  const current = Math.floor(Math.floor(now.getTime() / 1000) / seconds) * seconds;
  return [-1, 0, 1, 2].map((offset) => `${prefix}-updown-${timeframe.toLowerCase()}-${current + offset * seconds}`);
}

function slugSymbol(symbol: string): string | undefined {
  const normalized = symbol.toUpperCase();
  if (normalized === "BTC") {
    return "btc";
  }
  if (normalized === "ETH") {
    return "eth";
  }
  if (normalized === "SOL") {
    return "sol";
  }
  return undefined;
}

function timeframeSeconds(timeframe: string): number | undefined {
  if (timeframe.toLowerCase() === "5m") {
    return 5 * 60;
  }
  if (timeframe.toLowerCase() === "15m") {
    return 15 * 60;
  }
  if (timeframe.toLowerCase() === "1h") {
    return 60 * 60;
  }
  return undefined;
}

function normalizeLevels(value: unknown[] | undefined) {
  return (value ?? []).map((level) => {
    const row = level as Record<string, unknown>;
    return {
      price: String(row.price ?? ""),
      size: String(row.size ?? "")
    };
  });
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
