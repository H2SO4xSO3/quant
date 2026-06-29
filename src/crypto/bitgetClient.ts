import type { ParsedKline } from "./types";

interface BitgetCandlesResponse {
  code: string;
  msg: string;
  data?: string[][];
}

const BITGET_BASE_URL = "https://api.bitget.com";
const ONE_MINUTE_MS = 60_000;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBitgetCandle(row: string[]): ParsedKline {
  const openTime = toNumber(row[0]);
  const open = toNumber(row[1]);
  const high = toNumber(row[2]);
  const low = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]);
  const quoteVolume = toNumber(row[6]) || close * volume;
  return { openTime, closeTime: openTime + ONE_MINUTE_MS - 1, open, high, low, close, volume, quoteVolume };
}

export async function fetchBitgetHistoryCandles(options: {
  symbol: string;
  productType: string;
  granularity: string;
  startTime: number;
  endTime: number;
  limit?: number;
}): Promise<ParsedKline[]> {
  const limit = options.limit ?? 200;
  const rows: ParsedKline[] = [];
  let cursorEnd = options.endTime;

  while (cursorEnd >= options.startTime) {
    const url = new URL("/api/v2/mix/market/history-candles", BITGET_BASE_URL);
    url.searchParams.set("symbol", options.symbol);
    url.searchParams.set("productType", options.productType);
    url.searchParams.set("granularity", options.granularity);
    url.searchParams.set("startTime", String(options.startTime));
    url.searchParams.set("endTime", String(cursorEnd));
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Bitget candles HTTP ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as BitgetCandlesResponse;
    if (payload.code !== "00000") {
      throw new Error(`Bitget candles error ${payload.code}: ${payload.msg}`);
    }
    const chunk = (payload.data ?? []).map(parseBitgetCandle);
    if (chunk.length === 0) {
      break;
    }
    rows.push(...chunk);
    const firstOpenTime = Math.min(...chunk.map((row) => row.openTime));
    const nextCursorEnd = firstOpenTime - ONE_MINUTE_MS;
    if (nextCursorEnd >= cursorEnd) {
      break;
    }
    cursorEnd = nextCursorEnd;
  }

  const seen = new Set<number>();
  return rows
    .filter((row) => row.openTime >= options.startTime && row.openTime <= options.endTime)
    .sort((a, b) => a.openTime - b.openTime)
    .filter((row) => {
      if (seen.has(row.openTime)) {
        return false;
      }
      seen.add(row.openTime);
      return row.close > 0 && row.volume >= 0;
    });
}
