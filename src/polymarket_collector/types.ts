export interface GammaEvent {
  id?: string;
  slug?: string;
  ticker?: string;
  title?: string;
  description?: string;
  resolutionSource?: string;
  startDate?: string;
  creationDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: string | number;
  liquidity?: string | number;
  markets?: GammaMarket[];
}

export interface GammaMarket {
  id?: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  outcomes?: string[] | string;
  clobTokenIds?: string[] | string;
  outcomePrices?: string[] | string;
  enableOrderBook?: boolean;
  active?: boolean;
  closed?: boolean;
  volume?: string | number;
  liquidity?: string | number;
  endDate?: string;
  startDate?: string;
  resolutionSource?: string;
}

export interface PolymarketUpDownMarket {
  symbol: string;
  timeframe: string;
  eventId?: string;
  marketId: string;
  conditionId: string;
  slug: string;
  question: string;
  description?: string;
  marketStartTime?: string;
  marketEndTime?: string;
  outcomes: string[];
  outcomeTokenIds: {
    Up?: string;
    Down?: string;
  };
  resolutionSource?: string;
  status: "open" | "closed" | "inactive";
  volume?: string | number;
  liquidity?: string | number;
  rawEvent: GammaEvent;
  rawMarket: GammaMarket;
}

export interface OrderbookLevel {
  price: string;
  size: string;
}

export interface OrderbookSnapshot {
  tokenId: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  raw: unknown;
}

export interface PolymarketTrade {
  marketId?: string;
  tokenId?: string;
  side?: string;
  price?: string | number;
  size?: string | number;
  timestamp?: string | number;
  raw: unknown;
}
