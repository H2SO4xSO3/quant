import { buildQuery } from "./filters";

type QueryValue = string | number | boolean | undefined;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURES_HISTORY_DAYS = 29;
const DEFAULT_FUTURES_BASE_URL = "https://fapi.binance.com";
const DEFAULT_FEAR_GREED_BASE_URL = "https://api.alternative.me";

export type FuturesPeriod = "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d";
export type ExternalBias = "bullish_pressure" | "bearish_pressure" | "crowded_long" | "crowded_short" | "neutral";

export interface RequestWindow {
  startTime: number;
  endTime: number;
}

export interface FearGreedPoint {
  value: number;
  classification: string;
  timestamp: number;
  timeUntilUpdateSeconds?: number;
}

export interface FuturesOpenInterestPoint {
  symbol: string;
  timestamp: number;
  sumOpenInterest: number;
  sumOpenInterestValue: number;
}

export interface FuturesLongShortRatioPoint {
  symbol: string;
  timestamp: number;
  longShortRatio: number;
  longAccount?: number;
  shortAccount?: number;
  longPosition?: number;
  shortPosition?: number;
}

export interface FuturesTakerBuySellPoint {
  timestamp: number;
  buySellRatio: number;
  buyVol: number;
  sellVol: number;
}

export interface FuturesFundingRatePoint {
  symbol: string;
  fundingTime: number;
  fundingRate: number;
}

export interface FuturesSymbolExternalData {
  openInterest: FuturesOpenInterestPoint[];
  takerBuySell: FuturesTakerBuySellPoint[];
  globalLongShortAccountRatio: FuturesLongShortRatioPoint[];
  topLongShortAccountRatio: FuturesLongShortRatioPoint[];
  topLongShortPositionRatio: FuturesLongShortRatioPoint[];
  fundingRates: FuturesFundingRatePoint[];
}

export interface SymbolExternalSummary {
  symbol: string;
  openInterest?: number;
  openInterestValue?: number;
  openInterestChange1hPct?: number;
  openInterestChange4hPct?: number;
  takerBuySellRatio?: number;
  takerBuyVolume?: number;
  takerSellVolume?: number;
  globalLongShortRatio?: number;
  topTraderAccountLongShortRatio?: number;
  topTraderPositionLongShortRatio?: number;
  fundingRatePct?: number;
  bias: ExternalBias;
  warnings: string[];
}

interface ClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface AlternativeFearGreedPayload {
  name?: unknown;
  data?: Array<Record<string, unknown>>;
  metadata?: { error?: unknown };
}

interface BinanceOpenInterestPayload {
  symbol?: unknown;
  sumOpenInterest?: unknown;
  sumOpenInterestValue?: unknown;
  timestamp?: unknown;
}

interface BinanceRatioPayload {
  symbol?: unknown;
  longShortRatio?: unknown;
  longAccount?: unknown;
  shortAccount?: unknown;
  longPosition?: unknown;
  shortPosition?: unknown;
  timestamp?: unknown;
}

interface BinanceTakerPayload {
  buySellRatio?: unknown;
  buyVol?: unknown;
  sellVol?: unknown;
  timestamp?: unknown;
}

interface BinanceFundingPayload {
  symbol?: unknown;
  fundingTime?: unknown;
  fundingRate?: unknown;
}

export class AlternativeFearGreedClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_FEAR_GREED_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchFearGreed(limit = 0): Promise<FearGreedPoint[]> {
    const payload = await fetchJson<AlternativeFearGreedPayload>(this.fetchImpl, this.baseUrl, "/fng/", { limit, format: "json" });
    return normalizeFearGreedResponse(payload);
  }
}

export class BinanceFuturesExternalDataClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_FUTURES_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchSymbolData(symbol: string, options: { days: number; period?: FuturesPeriod } = { days: 30 }): Promise<FuturesSymbolExternalData> {
    const days = clampFuturesDays(options.days);
    const period = options.period ?? "5m";
    const [openInterest, takerBuySell, globalLongShortAccountRatio, topLongShortAccountRatio, topLongShortPositionRatio, fundingRates] =
      await Promise.all([
        this.fetchOpenInterest(symbol, days, period),
        this.fetchTakerBuySell(symbol, days, period),
        this.fetchRatio("/futures/data/globalLongShortAccountRatio", symbol, days, period),
        this.fetchRatio("/futures/data/topLongShortAccountRatio", symbol, days, period),
        this.fetchRatio("/futures/data/topLongShortPositionRatio", symbol, days, period),
        this.fetchFundingRates(symbol, days)
      ]);

    return { openInterest, takerBuySell, globalLongShortAccountRatio, topLongShortAccountRatio, topLongShortPositionRatio, fundingRates };
  }

  async fetchOpenInterest(symbol: string, days: number, period: FuturesPeriod): Promise<FuturesOpenInterestPoint[]> {
    const rows = await this.fetchPaginated<BinanceOpenInterestPayload>("/futures/data/openInterestHist", symbol, days, period);
    return uniqueByTime(
      rows
        .map((row) => ({
          symbol: stringValue(row.symbol) || symbol,
          timestamp: numberValue(row.timestamp),
          sumOpenInterest: numberValue(row.sumOpenInterest),
          sumOpenInterestValue: numberValue(row.sumOpenInterestValue)
        }))
        .filter((row) => row.timestamp > 0)
    );
  }

  async fetchTakerBuySell(symbol: string, days: number, period: FuturesPeriod): Promise<FuturesTakerBuySellPoint[]> {
    const rows = await this.fetchPaginated<BinanceTakerPayload>("/futures/data/takerlongshortRatio", symbol, days, period);
    return uniqueByTime(
      rows
        .map((row) => ({
          timestamp: numberValue(row.timestamp),
          buySellRatio: numberValue(row.buySellRatio),
          buyVol: numberValue(row.buyVol),
          sellVol: numberValue(row.sellVol)
        }))
        .filter((row) => row.timestamp > 0)
    );
  }

  async fetchRatio(pathName: string, symbol: string, days: number, period: FuturesPeriod): Promise<FuturesLongShortRatioPoint[]> {
    const rows = await this.fetchPaginated<BinanceRatioPayload>(pathName, symbol, days, period);
    return uniqueByTime(
      rows
        .map((row) => ({
          symbol: stringValue(row.symbol) || symbol,
          timestamp: numberValue(row.timestamp),
          longShortRatio: numberValue(row.longShortRatio),
          longAccount: optionalNumber(row.longAccount),
          shortAccount: optionalNumber(row.shortAccount),
          longPosition: optionalNumber(row.longPosition),
          shortPosition: optionalNumber(row.shortPosition)
        }))
        .filter((row) => row.timestamp > 0)
    );
  }

  async fetchFundingRates(symbol: string, days: number): Promise<FuturesFundingRatePoint[]> {
    const endTime = Date.now();
    const startTime = endTime - clampFuturesDays(days) * DAY_MS;
    const rows = await fetchJson<BinanceFundingPayload[]>(this.fetchImpl, this.baseUrl, "/fapi/v1/fundingRate", {
      symbol,
      startTime,
      endTime,
      limit: 1000
    });
    return uniqueByFundingTime(
      rows
        .map((row) => ({ symbol: stringValue(row.symbol) || symbol, fundingTime: numberValue(row.fundingTime), fundingRate: numberValue(row.fundingRate) }))
        .filter((row) => row.fundingTime > 0)
    );
  }

  private async fetchPaginated<T>(pathName: string, symbol: string, days: number, period: FuturesPeriod): Promise<T[]> {
    const endTime = Date.now();
    const windows = buildRequestWindows({ endTime, days: clampFuturesDays(days), intervalMs: periodToMs(period), limit: 500 });
    const result: T[] = [];
    for (const window of windows) {
      const rows = await fetchJson<T[]>(this.fetchImpl, this.baseUrl, pathName, {
        symbol,
        period,
        startTime: window.startTime,
        endTime: window.endTime,
        limit: 500
      });
      result.push(...rows);
    }
    return result;
  }
}

export function normalizeFearGreedResponse(payload: AlternativeFearGreedPayload): FearGreedPoint[] {
  if (payload.metadata?.error) {
    throw new Error(`Fear and Greed API error: ${String(payload.metadata.error)}`);
  }

  return (payload.data ?? [])
    .map((row) => {
      const timestampSeconds = numberValue(row.timestamp);
      const timeUntilUpdateSeconds = optionalNumber(row.time_until_update);
      return {
        value: numberValue(row.value),
        classification: stringValue(row.value_classification),
        timestamp: timestampSeconds > 0 ? timestampSeconds * 1000 : 0,
        ...(timeUntilUpdateSeconds === undefined ? {} : { timeUntilUpdateSeconds })
      };
    })
    .filter((row) => row.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function buildRequestWindows(options: { endTime: number; days: number; intervalMs: number; limit: number }): RequestWindow[] {
  const startTime = options.endTime - Math.max(1, options.days) * DAY_MS;
  const windowMs = options.intervalMs * options.limit;
  const windows: RequestWindow[] = [];
  let cursor = startTime;

  while (cursor < options.endTime) {
    const endTime = Math.min(options.endTime, cursor + windowMs);
    windows.push({ startTime: cursor, endTime });
    cursor = endTime;
  }

  return windows;
}

export function summarizeSymbolExternalData(symbol: string, data: FuturesSymbolExternalData): SymbolExternalSummary {
  const latestOpenInterest = latest(data.openInterest);
  const latestTaker = latest(data.takerBuySell);
  const latestGlobalRatio = latest(data.globalLongShortAccountRatio);
  const latestTopAccountRatio = latest(data.topLongShortAccountRatio);
  const latestTopPositionRatio = latest(data.topLongShortPositionRatio);
  const latestFunding = latest(data.fundingRates);
  const warnings: string[] = [];

  if (!latestOpenInterest) warnings.push("missing_open_interest");
  if (!latestTaker) warnings.push("missing_taker_buy_sell");
  if (!latestGlobalRatio) warnings.push("missing_global_long_short_ratio");
  if (!latestTopPositionRatio) warnings.push("missing_top_position_ratio");
  if (!latestFunding) warnings.push("missing_funding_rate");

  const summary: SymbolExternalSummary = {
    symbol,
    openInterest: latestOpenInterest?.sumOpenInterest,
    openInterestValue: latestOpenInterest?.sumOpenInterestValue,
    openInterestChange1hPct: changePctFromLookback(data.openInterest, latestOpenInterest?.timestamp, 60 * 60 * 1000, (row) => row.sumOpenInterest),
    openInterestChange4hPct: changePctFromLookback(data.openInterest, latestOpenInterest?.timestamp, 4 * 60 * 60 * 1000, (row) => row.sumOpenInterest),
    takerBuySellRatio: latestTaker?.buySellRatio,
    takerBuyVolume: latestTaker?.buyVol,
    takerSellVolume: latestTaker?.sellVol,
    globalLongShortRatio: latestGlobalRatio?.longShortRatio,
    topTraderAccountLongShortRatio: latestTopAccountRatio?.longShortRatio,
    topTraderPositionLongShortRatio: latestTopPositionRatio?.longShortRatio,
    fundingRatePct: latestFunding ? latestFunding.fundingRate * 100 : undefined,
    bias: "neutral",
    warnings
  };

  summary.bias = classifyExternalBias(summary);
  return stripUndefined(summary);
}

export function clampFuturesDays(days: number): number {
  if (!Number.isFinite(days)) {
    return MAX_FUTURES_HISTORY_DAYS;
  }
  return Math.max(1, Math.min(MAX_FUTURES_HISTORY_DAYS, Math.floor(days)));
}

export function periodToMs(period: FuturesPeriod): number {
  const unit = period.at(-1);
  const amount = Number(period.slice(0, -1));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Unsupported futures period: ${period}`);
  }
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "d") return amount * DAY_MS;
  throw new Error(`Unsupported futures period: ${period}`);
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  pathName: string,
  params: Record<string, QueryValue> = {},
  maxAttempts = 3
): Promise<T> {
  const query = buildQuery(params);
  const url = `${baseUrl}${pathName}${query ? `?${query}` : ""}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        return (await response.json()) as T;
      }
      const body = await response.text();
      lastError = new Error(`External data request failed: ${response.status} ${body}`);
      if (!RETRYABLE_STATUS.has(response.status)) {
        break;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await sleep(350 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("External data request failed");
}

function classifyExternalBias(summary: SymbolExternalSummary): ExternalBias {
  const oiUp = Number(summary.openInterestChange1hPct ?? summary.openInterestChange4hPct ?? 0) > 2;
  const takerStrong = Number(summary.takerBuySellRatio ?? 1) >= 1.2;
  const takerWeak = Number(summary.takerBuySellRatio ?? 1) <= 0.82;
  const crowdedLong = Number(summary.topTraderPositionLongShortRatio ?? summary.globalLongShortRatio ?? 1) >= 2.2;
  const crowdedShort = Number(summary.topTraderPositionLongShortRatio ?? summary.globalLongShortRatio ?? 1) <= 0.55;
  const fundingPct = Number(summary.fundingRatePct ?? 0);

  if (crowdedLong && fundingPct > 0.02) return "crowded_long";
  if (crowdedShort && fundingPct < -0.02) return "crowded_short";
  if (oiUp && takerStrong) return "bullish_pressure";
  if (oiUp && takerWeak) return "bearish_pressure";
  return "neutral";
}

function changePctFromLookback<T extends { timestamp: number }>(
  rows: T[],
  latestTimestamp: number | undefined,
  lookbackMs: number,
  getValue: (row: T) => number
): number | undefined {
  if (!latestTimestamp || rows.length < 2) {
    return undefined;
  }

  const latestRow = latest(rows);
  const previous = [...rows]
    .filter((row) => row.timestamp <= latestTimestamp - lookbackMs)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const latestValue = latestRow ? getValue(latestRow) : 0;
  const previousValue = previous ? getValue(previous) : 0;
  return previousValue > 0 ? ((latestValue - previousValue) / previousValue) * 100 : undefined;
}

function uniqueByTime<T extends { timestamp: number }>(rows: T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.timestamp, row])).values()).sort((a, b) => a.timestamp - b.timestamp);
}

function uniqueByFundingTime<T extends { fundingTime: number }>(rows: T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.fundingTime, row])).values()).sort((a, b) => a.fundingTime - b.fundingTime);
}

function latest<T>(rows: T[]): T | undefined {
  return rows.at(-1);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
