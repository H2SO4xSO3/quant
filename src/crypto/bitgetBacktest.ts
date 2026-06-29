import { fetchBitgetHistoryCandles } from "./bitgetClient";
import type { BinanceKline, ParsedKline } from "./types";

type BacktestInterval = "5m" | "15m" | "1h";

type FetchBitgetCandles = typeof fetchBitgetHistoryCandles;

const INTERVAL_MS: Record<BacktestInterval, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000
};
const DEFAULT_MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function bitgetGranularityForInterval(interval: BacktestInterval): string {
  return interval === "1h" ? "1H" : interval;
}

export function parsedKlineToBinanceKline(row: ParsedKline, interval: BacktestInterval): BinanceKline {
  return [
    row.openTime,
    String(row.open),
    String(row.high),
    String(row.low),
    String(row.close),
    String(row.volume),
    row.openTime + INTERVAL_MS[interval] - 1,
    String(row.quoteVolume)
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && /HTTP 429|Too Many Requests/i.test(error.message);
}

async function fetchWithRetry(
  fetchCandles: FetchBitgetCandles,
  options: Parameters<FetchBitgetCandles>[0],
  retries: number,
  retryDelayMs: number
): Promise<ParsedKline[]> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchCandles(options);
    } catch (error) {
      if (!isRateLimitError(error) || attempt === retries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }
  return [];
}

export async function fetchBitgetKlinesForInterval(options: {
  symbol: string;
  productType: string;
  interval: BacktestInterval;
  startTime: number;
  endTime: number;
  fetchCandles?: FetchBitgetCandles;
  retries?: number;
  retryDelayMs?: number;
  maxWindowMs?: number;
}): Promise<BinanceKline[]> {
  const fetchCandles = options.fetchCandles ?? fetchBitgetHistoryCandles;
  const retries = options.retries ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const maxWindowMs = options.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS;
  const rows: ParsedKline[] = [];

  for (let windowStart = options.startTime; windowStart < options.endTime; windowStart += maxWindowMs) {
    const windowEnd = Math.min(options.endTime, windowStart + maxWindowMs);
    rows.push(
      ...(await fetchWithRetry(
        fetchCandles,
        {
          symbol: options.symbol,
          productType: options.productType,
          granularity: bitgetGranularityForInterval(options.interval),
          startTime: windowStart,
          endTime: windowEnd
        },
        retries,
        retryDelayMs
      ))
    );
  }

  if (options.startTime === options.endTime) {
    rows.push(
      ...(await fetchWithRetry(
        fetchCandles,
        {
        symbol: options.symbol,
        productType: options.productType,
        granularity: bitgetGranularityForInterval(options.interval),
        startTime: options.startTime,
        endTime: options.endTime
        },
        retries,
        retryDelayMs
      ))
    );
  }

  const seen = new Set<number>();
  return rows
    .sort((a, b) => a.openTime - b.openTime)
    .filter((row) => {
      if (seen.has(row.openTime)) {
        return false;
      }
      seen.add(row.openTime);
      return true;
    })
    .map((row) => parsedKlineToBinanceKline(row, options.interval));
}
