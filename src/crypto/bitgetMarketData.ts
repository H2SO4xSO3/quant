const BITGET_BASE_URL = "https://api.bitget.com";

export type BitgetMarketDataEndpoint =
  | "open-interest"
  | "history-fund-rate"
  | "taker-buy-sell"
  | "long-short"
  | "long-short-ratio"
  | "account-long-short"
  | "position-long-short";

export interface BitgetMarketDataUrlOptions {
  symbol: string;
  productType?: string;
  period?: string;
  pageSize?: number;
  pageNo?: number;
}

export interface BitgetMarketDataFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type BitgetMarketDataFetch = (url: URL) => Promise<BitgetMarketDataFetchResponse>;

export interface BitgetMarketDataFetchOptions extends BitgetMarketDataUrlOptions {
  fetchImpl?: BitgetMarketDataFetch;
}

export interface BitgetOpenInterestPoint {
  symbol: string;
  timestampMs: number;
  openInterest: number;
}

export interface BitgetFundingRatePoint {
  symbol: string;
  timestampMs: number;
  fundingRate: number;
}

export interface BitgetTakerBuySellPoint {
  timestampMs: number;
  buyVolume: number;
  sellVolume: number;
}

export interface BitgetLongShortPoint {
  timestampMs: number;
  longRatio: number;
  shortRatio: number;
  longShortRatio: number;
}

export interface BitgetAccountLongShortPoint {
  timestampMs: number;
  longAccountRatio: number;
  shortAccountRatio: number;
  longShortAccountRatio: number;
}

export interface BitgetPositionLongShortPoint {
  timestampMs: number;
  longPositionRatio: number;
  shortPositionRatio: number;
  longShortPositionRatio: number;
}

export interface BitgetMarketContext {
  symbol: string;
  productType: string;
  period: string;
  openInterest?: BitgetOpenInterestPoint;
  fundingRates: BitgetFundingRatePoint[];
  takerBuySell: BitgetTakerBuySellPoint[];
  longShort: BitgetLongShortPoint[];
  accountLongShort: BitgetAccountLongShortPoint[];
  positionLongShort: BitgetPositionLongShortPoint[];
  blockers: string[];
}

export interface CollectBitgetMarketContextOptions {
  symbol: string;
  productType: string;
  period: string;
  fetchImpl?: BitgetMarketDataFetch;
  throttleMs?: number;
}

const endpointPaths: Record<BitgetMarketDataEndpoint, string> = {
  "open-interest": "/api/v2/mix/market/open-interest",
  "history-fund-rate": "/api/v2/mix/market/history-fund-rate",
  "taker-buy-sell": "/api/v2/mix/market/taker-buy-sell",
  "long-short": "/api/v2/mix/market/long-short",
  "long-short-ratio": "/api/v2/mix/market/long-short-ratio",
  "account-long-short": "/api/v2/mix/market/account-long-short",
  "position-long-short": "/api/v2/mix/market/position-long-short"
};

const productTypeEndpoints = new Set<BitgetMarketDataEndpoint>(["open-interest", "history-fund-rate"]);

function readNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`blocked=data_missing field=${field}`);
  }
  return parsed;
}

function rowField(row: Record<string, unknown>, field: string): number {
  if (!(field in row)) {
    throw new Error(`blocked=data_missing field=${field}`);
  }
  return readNumber(row[field], field);
}

export function buildBitgetMarketDataUrl(endpoint: BitgetMarketDataEndpoint, options: BitgetMarketDataUrlOptions): URL {
  const url = new URL(endpointPaths[endpoint], BITGET_BASE_URL);
  url.searchParams.set("symbol", options.symbol);
  if (options.period) {
    url.searchParams.set("period", options.period);
  }
  if (options.productType && productTypeEndpoints.has(endpoint)) {
    url.searchParams.set("productType", options.productType);
  }
  if (options.pageSize !== undefined) {
    url.searchParams.set("pageSize", String(options.pageSize));
  }
  if (options.pageNo !== undefined) {
    url.searchParams.set("pageNo", String(options.pageNo));
  }
  return url;
}

function defaultFetch(url: URL): Promise<BitgetMarketDataFetchResponse> {
  return fetch(url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchBitgetMarketDataPayload<T>(
  endpoint: BitgetMarketDataEndpoint,
  options: BitgetMarketDataFetchOptions
): Promise<T> {
  const url = buildBitgetMarketDataUrl(endpoint, options);
  const response = await (options.fetchImpl ?? defaultFetch)(url);
  if (!response.ok) {
    throw new Error(`Bitget ${endpoint} HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { code?: string; msg?: string; data?: unknown };
  if (payload.code !== "00000") {
    throw new Error(`Bitget ${endpoint} error ${payload.code ?? "unknown"}: ${payload.msg ?? "unknown"}`);
  }
  return payload.data as T;
}

export function parseBitgetOpenInterestPayload(payload: Record<string, unknown>, symbol: string): BitgetOpenInterestPoint {
  const rows = payload.openInterestList;
  if (!Array.isArray(rows)) {
    throw new Error("blocked=data_missing field=openInterest");
  }
  const row = rows.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return String((item as Record<string, unknown>).symbol).toUpperCase() === symbol.toUpperCase();
  }) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("blocked=data_missing field=openInterest");
  }
  return {
    symbol,
    timestampMs: readNumber(payload.ts, "ts"),
    openInterest: rowField(row, "size")
  };
}

export function parseBitgetFundingRateRows(rows: Array<Record<string, unknown>>): BitgetFundingRatePoint[] {
  return rows.map((row) => ({
    symbol: String(row.symbol ?? ""),
    timestampMs: rowField(row, "fundingTime"),
    fundingRate: rowField(row, "fundingRate")
  }));
}

export function parseBitgetTakerBuySellRows(rows: Array<Record<string, unknown>>): BitgetTakerBuySellPoint[] {
  return rows.map((row) => ({
    timestampMs: rowField(row, "ts"),
    buyVolume: rowField(row, "buyVolume"),
    sellVolume: rowField(row, "sellVolume")
  }));
}

export function parseBitgetLongShortRows(rows: Array<Record<string, unknown>>): BitgetLongShortPoint[] {
  return rows.map((row) => ({
    timestampMs: rowField(row, "ts"),
    longRatio: rowField(row, "longRatio"),
    shortRatio: rowField(row, "shortRatio"),
    longShortRatio: rowField(row, "longShortRatio")
  }));
}

export function parseBitgetAccountLongShortRows(rows: Array<Record<string, unknown>>): BitgetAccountLongShortPoint[] {
  return rows.map((row) => ({
    timestampMs: rowField(row, "ts"),
    longAccountRatio: rowField(row, "longAccountRatio"),
    shortAccountRatio: rowField(row, "shortAccountRatio"),
    longShortAccountRatio: rowField(row, "longShortAccountRatio")
  }));
}

export function parseBitgetPositionLongShortRows(rows: Array<Record<string, unknown>>): BitgetPositionLongShortPoint[] {
  return rows.map((row) => ({
    timestampMs: rowField(row, "ts"),
    longPositionRatio: rowField(row, "longPositionRatio"),
    shortPositionRatio: rowField(row, "shortPositionRatio"),
    longShortPositionRatio: rowField(row, "longShortPositionRatio")
  }));
}

export async function collectBitgetMarketContext(options: CollectBitgetMarketContextOptions): Promise<BitgetMarketContext> {
  const blockers: string[] = [];
  const throttleMs = options.throttleMs ?? 1_100;
  const base = {
    symbol: options.symbol,
    productType: options.productType,
    fetchImpl: options.fetchImpl
  };

  async function capture<T>(name: string, load: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await load();
    } catch (error) {
      blockers.push(`${name}:${errorMessage(error)}`);
      return fallback;
    } finally {
      if (throttleMs > 0) {
        await sleep(throttleMs);
      }
    }
  }

  const openInterest = await capture(
    "open-interest",
    async () => parseBitgetOpenInterestPayload(await fetchBitgetMarketDataPayload("open-interest", base), options.symbol),
    undefined as BitgetOpenInterestPoint | undefined
  );
  const fundingRates = await capture(
    "history-fund-rate",
    async () =>
      parseBitgetFundingRateRows(
        await fetchBitgetMarketDataPayload<Array<Record<string, unknown>>>("history-fund-rate", { ...base, pageSize: 100, pageNo: 1 })
      ),
    [] as BitgetFundingRatePoint[]
  );
  const takerBuySell = await capture(
    "taker-buy-sell",
    async () =>
      parseBitgetTakerBuySellRows(
        await fetchBitgetMarketDataPayload<Array<Record<string, unknown>>>("taker-buy-sell", {
          symbol: options.symbol,
          period: options.period,
          fetchImpl: options.fetchImpl
        })
      ),
    [] as BitgetTakerBuySellPoint[]
  );
  const longShort = await capture(
    "long-short",
    async () =>
      parseBitgetLongShortRows(
        await fetchBitgetMarketDataPayload<Array<Record<string, unknown>>>("long-short", {
          symbol: options.symbol,
          period: options.period,
          fetchImpl: options.fetchImpl
        })
      ),
    [] as BitgetLongShortPoint[]
  );
  const accountLongShort = await capture(
    "account-long-short",
    async () =>
      parseBitgetAccountLongShortRows(
        await fetchBitgetMarketDataPayload<Array<Record<string, unknown>>>("account-long-short", {
          symbol: options.symbol,
          period: options.period,
          fetchImpl: options.fetchImpl
        })
      ),
    [] as BitgetAccountLongShortPoint[]
  );
  const positionLongShort = await capture(
    "position-long-short",
    async () =>
      parseBitgetPositionLongShortRows(
        await fetchBitgetMarketDataPayload<Array<Record<string, unknown>>>("position-long-short", {
          symbol: options.symbol,
          period: options.period,
          fetchImpl: options.fetchImpl
        })
      ),
    [] as BitgetPositionLongShortPoint[]
  );

  return {
    symbol: options.symbol,
    productType: options.productType,
    period: options.period,
    openInterest,
    fundingRates,
    takerBuySell,
    longShort,
    accountLongShort,
    positionLongShort,
    blockers
  };
}
