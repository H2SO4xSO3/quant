import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FearGreedPoint, FuturesPeriod, FuturesSymbolExternalData } from "./externalData";

const DEFAULT_EXTERNAL_REPORT_PATH = path.resolve(process.cwd(), "data/external/free-market-context.json");
const DEFAULT_MAX_STALENESS_MS = 25 * 60 * 1000;
const DEFAULT_FUNDING_STALENESS_MS = 12 * 60 * 60 * 1000;
const DEFAULT_FEAR_GREED_STALENESS_MS = 48 * 60 * 60 * 1000;

export interface FreeExternalMarketContextReport {
  generatedAt: string;
  days: number;
  period: FuturesPeriod;
  fearGreed: FearGreedPoint[];
  futures: Record<string, FuturesSymbolExternalData>;
  sources?: Record<string, string>;
  limitations?: string[];
}

export interface ExternalResearchContextOptions {
  maxStalenessMs?: number;
  maxFundingStalenessMs?: number;
  maxFearGreedStalenessMs?: number;
}

export interface ExternalResearchContext {
  generatedAt: string;
  days: number;
  period: FuturesPeriod;
  symbols: string[];
  maxStalenessMs: number;
  maxFundingStalenessMs: number;
  maxFearGreedStalenessMs: number;
  fearGreed: FearGreedPoint[];
  futures: Record<string, FuturesSymbolExternalData>;
}

export interface ExternalResearchFeature {
  timestamp: number;
  openInterestChange1hPct?: number;
  openInterestChange4hPct?: number;
  takerBuySellRatio?: number;
  globalLongShortRatio?: number;
  topTraderAccountLongShortRatio?: number;
  topTraderPositionLongShortRatio?: number;
  fundingRatePct?: number;
  fearGreedValue?: number;
  fearGreedClassification?: string;
  crowdedLong: boolean;
  crowdedShort: boolean;
}

export interface ExternalResearchFilter {
  name: string;
  description: string;
  matches: (feature: ExternalResearchFeature) => boolean;
}

export const EXTERNAL_RESEARCH_FILTERS: ExternalResearchFilter[] = [
  {
    name: "external-bullish-pressure",
    description: "OI is expanding, taker flow is net buy, and top-trader positioning is not crowded long.",
    matches: (feature) =>
      !feature.crowdedLong &&
      !feature.crowdedShort &&
      (Number(feature.openInterestChange1hPct ?? 0) >= 0.3 || Number(feature.openInterestChange4hPct ?? 0) >= 0.8) &&
      Number(feature.takerBuySellRatio ?? 1) >= 1.15 &&
      Number(feature.fundingRatePct ?? 0) <= 0.03
  },
  {
    name: "external-bearish-pressure",
    description: "OI is expanding while taker flow is net sell; useful as a veto candidate for long entries.",
    matches: (feature) =>
      !feature.crowdedShort &&
      (Number(feature.openInterestChange1hPct ?? 0) >= 0.3 || Number(feature.openInterestChange4hPct ?? 0) >= 0.8) &&
      Number(feature.takerBuySellRatio ?? 1) <= 0.85
  },
  {
    name: "external-fear-discount",
    description: "Market-wide Fear and Greed is below neutral, while futures positioning is not crowded long.",
    matches: (feature) => Number(feature.fearGreedValue ?? 100) <= 45 && !feature.crowdedLong
  },
  {
    name: "external-no-crowded-long",
    description: "Avoid long signals when top-trader positioning and funding look crowded.",
    matches: (feature) => !feature.crowdedLong
  }
];

export function loadExternalResearchContext(
  filePath = DEFAULT_EXTERNAL_REPORT_PATH,
  options: ExternalResearchContextOptions = {}
): ExternalResearchContext | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const report = JSON.parse(readFileSync(filePath, "utf8")) as FreeExternalMarketContextReport;
  return buildExternalResearchContext(report, options);
}

export function buildExternalResearchContext(
  report: FreeExternalMarketContextReport,
  options: ExternalResearchContextOptions = {}
): ExternalResearchContext {
  return {
    generatedAt: report.generatedAt,
    days: report.days,
    period: report.period,
    symbols: Object.keys(report.futures ?? {}).sort(),
    maxStalenessMs: options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS,
    maxFundingStalenessMs: options.maxFundingStalenessMs ?? DEFAULT_FUNDING_STALENESS_MS,
    maxFearGreedStalenessMs: options.maxFearGreedStalenessMs ?? DEFAULT_FEAR_GREED_STALENESS_MS,
    fearGreed: [...(report.fearGreed ?? [])].sort((a, b) => a.timestamp - b.timestamp),
    futures: Object.fromEntries(
      Object.entries(report.futures ?? {}).map(([symbol, data]) => [
        symbol,
        {
          openInterest: [...data.openInterest].sort((a, b) => a.timestamp - b.timestamp),
          takerBuySell: [...data.takerBuySell].sort((a, b) => a.timestamp - b.timestamp),
          globalLongShortAccountRatio: [...data.globalLongShortAccountRatio].sort((a, b) => a.timestamp - b.timestamp),
          topLongShortAccountRatio: [...data.topLongShortAccountRatio].sort((a, b) => a.timestamp - b.timestamp),
          topLongShortPositionRatio: [...data.topLongShortPositionRatio].sort((a, b) => a.timestamp - b.timestamp),
          fundingRates: [...data.fundingRates].sort((a, b) => a.fundingTime - b.fundingTime)
        }
      ])
    )
  };
}

export function findExternalFeatureAt(context: ExternalResearchContext, symbol: string, openTime: number): ExternalResearchFeature | undefined {
  const data = context.futures[symbol];
  if (!data) {
    return undefined;
  }

  const openInterest = latestBefore(data.openInterest, openTime, (row) => row.timestamp);
  if (!openInterest || openTime - openInterest.timestamp > context.maxStalenessMs) {
    return undefined;
  }

  const taker = freshLatest(data.takerBuySell, openTime, context.maxStalenessMs, (row) => row.timestamp);
  const globalRatio = freshLatest(data.globalLongShortAccountRatio, openTime, context.maxStalenessMs, (row) => row.timestamp);
  const topAccountRatio = freshLatest(data.topLongShortAccountRatio, openTime, context.maxStalenessMs, (row) => row.timestamp);
  const topPositionRatio = freshLatest(data.topLongShortPositionRatio, openTime, context.maxStalenessMs, (row) => row.timestamp);
  const funding = freshLatest(data.fundingRates, openTime, context.maxFundingStalenessMs, (row) => row.fundingTime);
  const fearGreed = freshLatest(context.fearGreed, openTime, context.maxFearGreedStalenessMs, (row) => row.timestamp);
  const fundingRatePct = funding ? funding.fundingRate * 100 : undefined;
  const topTraderPositionLongShortRatio = topPositionRatio?.longShortRatio;

  return stripUndefined({
    timestamp: openInterest.timestamp,
    openInterestChange1hPct: changePctFromLookback(data.openInterest, openInterest.timestamp, 60 * 60 * 1000, (row) => row.sumOpenInterest),
    openInterestChange4hPct: changePctFromLookback(data.openInterest, openInterest.timestamp, 4 * 60 * 60 * 1000, (row) => row.sumOpenInterest),
    takerBuySellRatio: taker?.buySellRatio,
    globalLongShortRatio: globalRatio?.longShortRatio,
    topTraderAccountLongShortRatio: topAccountRatio?.longShortRatio,
    topTraderPositionLongShortRatio,
    fundingRatePct,
    fearGreedValue: fearGreed?.value,
    fearGreedClassification: fearGreed?.classification,
    crowdedLong: Number(topTraderPositionLongShortRatio ?? 1) >= 2.2 && Number(fundingRatePct ?? 0) > 0.02,
    crowdedShort: Number(topTraderPositionLongShortRatio ?? 1) <= 0.55 && Number(fundingRatePct ?? 0) < -0.02
  });
}

function freshLatest<T>(rows: T[], openTime: number, maxStalenessMs: number, getTimestamp: (row: T) => number): T | undefined {
  const row = latestBefore(rows, openTime, getTimestamp);
  if (!row) {
    return undefined;
  }
  return openTime - getTimestamp(row) <= maxStalenessMs ? row : undefined;
}

function latestBefore<T>(rows: T[], openTime: number, getTimestamp: (row: T) => number): T | undefined {
  let low = 0;
  let high = rows.length - 1;
  let result: T | undefined;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (getTimestamp(rows[mid]) <= openTime) {
      result = rows[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function changePctFromLookback<T>(
  rows: T[],
  latestTimestamp: number,
  lookbackMs: number,
  getValue: (row: T) => number,
  getTimestamp: (row: T) => number = (row) => (row as { timestamp: number }).timestamp
): number | undefined {
  const latest = latestBefore(rows, latestTimestamp, getTimestamp);
  const previous = latestBefore(rows, latestTimestamp - lookbackMs, getTimestamp);
  const latestValue = latest ? getValue(latest) : 0;
  const previousValue = previous ? getValue(previous) : 0;
  return previousValue > 0 ? ((latestValue - previousValue) / previousValue) * 100 : undefined;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
