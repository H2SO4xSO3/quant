import {
  summarizeSymbolExternalData,
  type FearGreedPoint,
  type FuturesFundingRatePoint,
  type FuturesLongShortRatioPoint,
  type FuturesOpenInterestPoint,
  type FuturesPeriod,
  type FuturesSymbolExternalData,
  type FuturesTakerBuySellPoint,
  type SymbolExternalSummary
} from "./externalData";

export interface FreeExternalMarketContextReport {
  generatedAt: string;
  days: number;
  period: FuturesPeriod;
  sources?: {
    binanceFutures?: string;
    fearGreed?: string;
  };
  limitations?: string[];
  fearGreed: FearGreedPoint[];
  futures: Record<string, FuturesSymbolExternalData>;
  summaries: SymbolExternalSummary[];
}

export function mergeExternalMarketHistory(
  existing: FreeExternalMarketContextReport | undefined,
  fresh: FreeExternalMarketContextReport
): FreeExternalMarketContextReport {
  if (!existing) {
    return withSummaries(fresh);
  }

  const symbols = Array.from(new Set([...Object.keys(existing.futures), ...Object.keys(fresh.futures)])).sort();
  const futures: Record<string, FuturesSymbolExternalData> = {};

  for (const symbol of symbols) {
    futures[symbol] = mergeSymbolExternalData(existing.futures[symbol], fresh.futures[symbol]);
  }

  return withSummaries({
    ...fresh,
    days: Math.max(existing.days, fresh.days),
    fearGreed: mergeByTimestamp(existing.fearGreed, fresh.fearGreed),
    futures
  });
}

function mergeSymbolExternalData(
  existing: FuturesSymbolExternalData | undefined,
  fresh: FuturesSymbolExternalData | undefined
): FuturesSymbolExternalData {
  return {
    openInterest: mergeByTimestamp<FuturesOpenInterestPoint>(existing?.openInterest ?? [], fresh?.openInterest ?? []),
    takerBuySell: mergeByTimestamp<FuturesTakerBuySellPoint>(existing?.takerBuySell ?? [], fresh?.takerBuySell ?? []),
    globalLongShortAccountRatio: mergeByTimestamp<FuturesLongShortRatioPoint>(
      existing?.globalLongShortAccountRatio ?? [],
      fresh?.globalLongShortAccountRatio ?? []
    ),
    topLongShortAccountRatio: mergeByTimestamp<FuturesLongShortRatioPoint>(
      existing?.topLongShortAccountRatio ?? [],
      fresh?.topLongShortAccountRatio ?? []
    ),
    topLongShortPositionRatio: mergeByTimestamp<FuturesLongShortRatioPoint>(
      existing?.topLongShortPositionRatio ?? [],
      fresh?.topLongShortPositionRatio ?? []
    ),
    fundingRates: mergeByFundingTime(existing?.fundingRates ?? [], fresh?.fundingRates ?? [])
  };
}

function withSummaries(report: FreeExternalMarketContextReport): FreeExternalMarketContextReport {
  const summaries = Object.entries(report.futures)
    .map(([symbol, data]) => summarizeSymbolExternalData(symbol, data))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { ...report, summaries };
}

function mergeByTimestamp<T extends { timestamp: number }>(existing: T[], fresh: T[]): T[] {
  return Array.from(new Map([...existing, ...fresh].map((row) => [row.timestamp, row])).values()).sort((a, b) => a.timestamp - b.timestamp);
}

function mergeByFundingTime<T extends FuturesFundingRatePoint>(existing: T[], fresh: T[]): T[] {
  return Array.from(new Map([...existing, ...fresh].map((row) => [row.fundingTime, row])).values()).sort((a, b) => a.fundingTime - b.fundingTime);
}
