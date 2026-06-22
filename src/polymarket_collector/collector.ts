import type { PolymarketCollectorConfig } from "./config";
import type { PolymarketClient } from "./client";
import { selectPolymarketUpDownMarkets, parseStringArray } from "./marketDiscovery";
import type { OrderbookSnapshot, PolymarketTrade, PolymarketUpDownMarket } from "./types";
import type { JsonlPolymarketStore, PolymarketRecordKind } from "./storage";

export interface PolymarketCollectionSummary {
  timestampReceived: string;
  markets: number;
  orderbooks: number;
  trades: number;
  errors: number;
}

export interface PolymarketCollectorDependencies {
  config: PolymarketCollectorConfig;
  client: PolymarketClient;
  store: Pick<JsonlPolymarketStore, "append">;
  now?: () => string;
}

export class PolymarketCollector {
  private readonly now: () => string;
  private readonly seenMarketMetadataKeys = new Set<string>();
  private readonly seenResolutionKeys = new Set<string>();
  private readonly seenTradeKeys = new Set<string>();

  constructor(private readonly deps: PolymarketCollectorDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async collectOnce(): Promise<PolymarketCollectionSummary> {
    const timestampReceived = this.now();
    const summary: PolymarketCollectionSummary = { timestampReceived, markets: 0, orderbooks: 0, trades: 0, errors: 0 };

    try {
      const events = await this.deps.client.fetchCandidateEvents(this.deps.config.symbols, this.deps.config.timeframes, this.deps.config.discoveryLimit);
      const markets = selectPolymarketUpDownMarkets(events, { symbols: this.deps.config.symbols, timeframes: this.deps.config.timeframes }).filter((market) =>
        isNearCurrentWindow(market, timestampReceived)
      );
      summary.markets = markets.length;

      for (const market of markets) {
        const metadataKey = market.marketId || market.conditionId || market.slug;
        if (!this.seenMarketMetadataKeys.has(metadataKey)) {
          this.seenMarketMetadataKeys.add(metadataKey);
          this.append("market-metadata", { timestampReceived, ...withoutRawMarket(market), rawEvent: market.rawEvent, rawMarket: market.rawMarket });
        }
        this.appendResolutionIfClosed(timestampReceived, market);
        if (market.status !== "open" || hasEnded(market, timestampReceived)) {
          continue;
        }
        await this.collectMarketDetails(timestampReceived, market, summary);
      }
    } catch (error) {
      summary.errors += 1;
      this.appendError(timestampReceived, "discovery", error);
    }

    return summary;
  }

  private async collectMarketDetails(timestampReceived: string, market: PolymarketUpDownMarket, summary: PolymarketCollectionSummary): Promise<void> {
    const orderbooks = new Map<string, OrderbookSnapshot>();

    if (this.deps.config.saveOrderbook) {
      for (const [outcome, tokenId] of Object.entries(market.outcomeTokenIds)) {
        if (!tokenId) {
          continue;
        }
        try {
          const orderbook = await this.deps.client.fetchOrderbook(tokenId);
          orderbooks.set(outcome, orderbook);
          summary.orderbooks += 1;
          this.append("orderbooks", { timestampReceived, marketId: market.marketId, conditionId: market.conditionId, outcome, ...orderbook });
        } catch (error) {
          summary.errors += 1;
          this.appendError(timestampReceived, `orderbook:${market.slug}:${outcome}`, error);
        }
      }
    }

    this.append("price-snapshots", buildPriceSnapshot(timestampReceived, market, orderbooks));

    if (this.deps.config.saveTrades) {
      try {
        const trades = await this.deps.client.fetchTrades(market.conditionId, 100);
        for (const trade of trades) {
          const key = tradeKey(market, trade);
          if (this.seenTradeKeys.has(key)) {
            continue;
          }
          this.seenTradeKeys.add(key);
          summary.trades += 1;
          this.append("trades", { timestampReceived, marketId: market.marketId, conditionId: market.conditionId, ...trade });
        }
      } catch (error) {
        summary.errors += 1;
        this.appendError(timestampReceived, `trades:${market.slug}`, error);
      }
    }
  }

  private appendResolutionIfClosed(timestampReceived: string, market: PolymarketUpDownMarket): void {
    if (market.status !== "closed") {
      return;
    }
    const resolutionKey = market.marketId || market.conditionId || market.slug;
    if (this.seenResolutionKeys.has(resolutionKey)) {
      return;
    }
    this.seenResolutionKeys.add(resolutionKey);
    const prices = parseStringArray(market.rawMarket.outcomePrices);
    const winningIndex = prices.findIndex((price) => Number(price) >= 0.99);
    this.append("resolutions", {
      timestampReceived,
      marketId: market.marketId,
      conditionId: market.conditionId,
      slug: market.slug,
      finalOutcome: winningIndex >= 0 ? market.outcomes[winningIndex] : undefined,
      resolvedTime: market.marketEndTime,
      payoutResult: prices,
      finalReferencePrice: undefined,
      rawMarket: market.rawMarket
    });
  }

  private append(kind: PolymarketRecordKind, record: unknown): void {
    this.deps.store.append(kind, record);
  }

  private appendError(timestampReceived: string, scope: string, error: unknown): void {
    this.append("collector-errors", {
      timestampReceived,
      scope,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildPriceSnapshot(timestampReceived: string, market: PolymarketUpDownMarket, orderbooks: Map<string, OrderbookSnapshot>) {
  const upBook = orderbooks.get("Up");
  const downBook = orderbooks.get("Down");
  const upBestBid = bestBid(upBook);
  const upBestAsk = bestAsk(upBook);
  const downBestBid = bestBid(downBook);
  const downBestAsk = bestAsk(downBook);
  const outcomePrices = parseStringArray(market.rawMarket.outcomePrices);
  return {
    timestampReceived,
    marketId: market.marketId,
    conditionId: market.conditionId,
    slug: market.slug,
    symbol: market.symbol,
    timeframe: market.timeframe,
    status: market.status,
    upTokenId: market.outcomeTokenIds.Up,
    downTokenId: market.outcomeTokenIds.Down,
    upBestBid,
    upBestAsk,
    downBestBid,
    downBestAsk,
    midPrice: midpoint(upBestBid, upBestAsk),
    lastTradePrice: outcomePrices[0] ? Number(outcomePrices[0]) : undefined,
    rawOutcomePrices: outcomePrices
  };
}

function bestBid(book: OrderbookSnapshot | undefined): number | undefined {
  const prices = (book?.bids ?? []).map((level) => Number(level.price)).filter(Number.isFinite);
  return prices.length ? Math.max(...prices) : undefined;
}

function bestAsk(book: OrderbookSnapshot | undefined): number | undefined {
  const prices = (book?.asks ?? []).map((level) => Number(level.price)).filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : undefined;
}

function midpoint(bid: number | undefined, ask: number | undefined): number | undefined {
  return bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined;
}

function withoutRawMarket(market: PolymarketUpDownMarket) {
  const { rawEvent, rawMarket, ...metadata } = market;
  return metadata;
}

function isNearCurrentWindow(market: PolymarketUpDownMarket, timestampReceived: string): boolean {
  if (!market.marketEndTime) {
    return true;
  }
  const endMs = Date.parse(market.marketEndTime);
  const nowMs = Date.parse(timestampReceived);
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const oneDayMs = 24 * 60 * 60 * 1000;
  return endMs >= nowMs - twoHoursMs && endMs <= nowMs + oneDayMs;
}

function hasEnded(market: PolymarketUpDownMarket, timestampReceived: string): boolean {
  if (!market.marketEndTime) {
    return false;
  }
  const endMs = Date.parse(market.marketEndTime);
  const nowMs = Date.parse(timestampReceived);
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) {
    return false;
  }
  return endMs <= nowMs;
}

function tradeKey(market: PolymarketUpDownMarket, trade: PolymarketTrade): string {
  const raw = trade.raw as Record<string, unknown>;
  if (typeof raw.transactionHash === "string" && raw.transactionHash) {
    return `tx:${raw.transactionHash}:${trade.tokenId ?? raw.asset ?? ""}`;
  }
  return [
    market.conditionId,
    trade.tokenId ?? "",
    trade.side ?? "",
    trade.price ?? "",
    trade.size ?? "",
    trade.timestamp ?? ""
  ].join(":");
}
