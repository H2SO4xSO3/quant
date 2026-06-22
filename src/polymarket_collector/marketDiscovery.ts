import type { GammaEvent, GammaMarket, PolymarketUpDownMarket } from "./types";

interface SelectionOptions {
  symbols: string[];
  timeframes: string[];
}

const SYMBOL_ALIASES: Record<string, string[]> = {
  BTC: ["BTC", "BITCOIN"],
  ETH: ["ETH", "ETHEREUM"],
  SOL: ["SOL", "SOLANA"]
};

export function selectPolymarketUpDownMarkets(events: GammaEvent[], options: SelectionOptions): PolymarketUpDownMarket[] {
  const symbols = new Set(options.symbols.map((symbol) => symbol.toUpperCase()));
  const timeframes = new Set(options.timeframes.map((timeframe) => timeframe.toLowerCase()));
  const selected: PolymarketUpDownMarket[] = [];

  for (const event of events) {
    for (const market of event.markets ?? []) {
      const normalized = normalizeMarket(event, market);
      if (!normalized) {
        continue;
      }
      if (!symbols.has(normalized.symbol) || !timeframes.has(normalized.timeframe)) {
        continue;
      }
      selected.push(normalized);
    }
  }

  return selected.sort((a, b) => `${a.symbol}-${a.marketEndTime ?? ""}`.localeCompare(`${b.symbol}-${b.marketEndTime ?? ""}`));
}

function normalizeMarket(event: GammaEvent, market: GammaMarket): PolymarketUpDownMarket | undefined {
  const slug = market.slug ?? event.slug ?? "";
  const text = `${slug} ${market.question ?? ""} ${event.title ?? ""}`.toUpperCase();
  if (!text.includes("UP") || !text.includes("DOWN")) {
    return undefined;
  }

  const symbol = inferSymbol(slug, text);
  const timeframe = inferTimeframe(slug, text);
  if (!symbol || !timeframe) {
    return undefined;
  }

  const outcomes = parseStringArray(market.outcomes);
  const tokenIds = parseStringArray(market.clobTokenIds);
  const upIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "up");
  const downIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "down");
  const upTokenId = upIndex >= 0 ? tokenIds[upIndex] : undefined;
  const downTokenId = downIndex >= 0 ? tokenIds[downIndex] : undefined;

  if (!market.id || !market.conditionId || !slug || !upTokenId || !downTokenId) {
    return undefined;
  }

  return {
    symbol,
    timeframe,
    eventId: event.id,
    marketId: market.id,
    conditionId: market.conditionId,
    slug,
    question: market.question ?? event.title ?? slug,
    description: market.description ?? event.description,
    marketStartTime: market.startDate ?? event.startDate ?? event.creationDate,
    marketEndTime: market.endDate ?? event.endDate,
    outcomes,
    outcomeTokenIds: {
      Up: upTokenId,
      Down: downTokenId
    },
    resolutionSource: market.resolutionSource ?? event.resolutionSource,
    status: market.closed || event.closed ? "closed" : market.active === false || event.active === false ? "inactive" : "open",
    volume: market.volume ?? event.volume,
    liquidity: market.liquidity ?? event.liquidity,
    rawEvent: event,
    rawMarket: market
  };
}

function inferSymbol(slug: string, text: string): string | undefined {
  const slugSymbol = slug.match(/^([a-z]+)-updown-/i)?.[1]?.toUpperCase();
  if (slugSymbol && SYMBOL_ALIASES[slugSymbol]) {
    return slugSymbol;
  }

  return Object.entries(SYMBOL_ALIASES).find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0];
}

function inferTimeframe(slug: string, text: string): string | undefined {
  const slugTimeframe = slug.match(/updown-(5m|15m|1h)-/i)?.[1]?.toLowerCase();
  if (slugTimeframe) {
    return slugTimeframe;
  }
  if (text.includes("15-MINUTE") || text.includes("15 MINUTE") || text.includes("15M")) {
    return "15m";
  }
  if (text.includes("5-MINUTE") || text.includes("5 MINUTE") || text.includes("5M")) {
    return "5m";
  }
  if (text.includes("1-HOUR") || text.includes("1 HOUR") || text.includes("1H")) {
    return "1h";
  }
  return undefined;
}

export function parseStringArray(value: string[] | string | undefined): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(String);
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
