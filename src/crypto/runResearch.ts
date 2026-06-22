import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchHistoricalKlines } from "./backtest";
import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { parseKline } from "./indicators";
import { addOutcome, createResearchAccumulator, finishAccumulator, labelLongOutcome, type ResearchAccumulator, type ResearchOutcome } from "./research";
import {
  EXTERNAL_RESEARCH_FILTERS,
  findExternalFeatureAt,
  loadExternalResearchContext,
  type ExternalResearchContext,
  type ExternalResearchFilter
} from "./researchExternal";
import {
  DEFAULT_RESEARCH_VALIDATION_CRITERIA,
  buildResearchValidationReport,
  type ResearchScenarioSplitSummary
} from "./researchValidation";
import { roundTripCostPct } from "./tradeMath";
import type { ParsedKline } from "./types";

interface ExitProfile {
  name: string;
  horizonBars: number;
  takeProfitPct: number;
  stopLossPct: number;
}

interface FeatureSnapshot {
  symbol: string;
  openTime: number;
  close: number;
  priceVsVwapPct: number;
  emaFastAboveSlow: boolean;
  emaFastSlopePct: number;
  higherTrendGapPct: number;
  rsi: number;
  atrPct: number;
  volumeRatio: number;
  bollingerBandwidthPct: number;
  bollingerPercentB: number;
  return3Pct: number;
  return6Pct: number;
  return12Pct: number;
  relativeStrength12Pct: number;
  candleBodyPct: number;
  closePosition: number;
  lowerWickPct: number;
  upperWickPct: number;
}

interface Scenario {
  name: string;
  description: string;
  matches: (feature: FeatureSnapshot) => boolean;
}

interface SymbolSeries {
  symbol: string;
  rows5m: ParsedKline[];
  rows15m: ParsedKline[];
}

interface HigherTrendPoint {
  openTime: number;
  fast: number;
  slow: number;
}

interface ScenarioBucket {
  accumulator: ResearchAccumulator;
  inSample: ResearchAccumulator;
  outOfSample: ResearchAccumulator;
  bySymbol: Map<string, ResearchAccumulator>;
}

const LOOKBACK_BARS = 240;
const VOLUME_LOOKBACK_BARS = 40;
const REPORT_PATH = path.resolve(process.cwd(), "data/research-report.json");

const exitProfiles: ExitProfile[] = [
  { name: "scalp-30m", horizonBars: 6, takeProfitPct: 0.35, stopLossPct: 0.28 },
  { name: "balanced-60m", horizonBars: 12, takeProfitPct: 0.55, stopLossPct: 0.42 },
  { name: "runner-120m", horizonBars: 24, takeProfitPct: 0.85, stopLossPct: 0.55 },
  { name: "swing-240m", horizonBars: 48, takeProfitPct: 1.2, stopLossPct: 0.75 },
  { name: "swing-480m", horizonBars: 96, takeProfitPct: 1.8, stopLossPct: 1 }
];

const scenarios: Scenario[] = [
  {
    name: "trend-pullback-vwap",
    description: "Higher-timeframe uptrend, 5m EMA structure positive, price pulls back to VWAP instead of chasing extension.",
    matches: (f) =>
      f.emaFastAboveSlow &&
      f.emaFastSlopePct >= 0.025 &&
      f.higherTrendGapPct >= 0.02 &&
      f.priceVsVwapPct >= -0.18 &&
      f.priceVsVwapPct <= 0.28 &&
      f.rsi >= 44 &&
      f.rsi <= 62 &&
      f.volumeRatio >= 0.65
  },
  {
    name: "volume-breakout-continuation",
    description: "Price is above VWAP with expanding volume and a strong candle, looking for short continuation rather than mean reversion.",
    matches: (f) =>
      f.emaFastAboveSlow &&
      f.emaFastSlopePct >= 0.06 &&
      f.higherTrendGapPct >= 0 &&
      f.priceVsVwapPct >= 0.2 &&
      f.priceVsVwapPct <= 1.15 &&
      f.volumeRatio >= 1.35 &&
      f.return3Pct >= 0.22 &&
      f.closePosition >= 0.68 &&
      f.upperWickPct <= f.candleBodyPct * 0.9 &&
      f.rsi >= 52 &&
      f.rsi <= 72
  },
  {
    name: "volatility-compression-breakout",
    description: "Low Bollinger bandwidth followed by an upper-band push with volume confirmation.",
    matches: (f) =>
      f.bollingerBandwidthPct > 0 &&
      f.bollingerBandwidthPct <= 1.05 &&
      f.bollingerPercentB >= 0.82 &&
      f.volumeRatio >= 1.25 &&
      f.emaFastSlopePct >= 0.02 &&
      f.priceVsVwapPct >= 0 &&
      f.rsi >= 50 &&
      f.rsi <= 72
  },
  {
    name: "bollinger-dip-rebound",
    description: "Lower-band dip with RSI washout and a lower wick, testing whether the first rebound is tradeable after costs.",
    matches: (f) =>
      f.bollingerPercentB <= 0.18 &&
      f.rsi >= 24 &&
      f.rsi <= 42 &&
      f.lowerWickPct >= 0.08 &&
      f.closePosition >= 0.45 &&
      f.priceVsVwapPct >= -1.8
  },
  {
    name: "capitulation-reclaim",
    description: "Fast selloff, high relative volume, and a candle close away from the low.",
    matches: (f) =>
      f.return6Pct <= -0.55 &&
      f.rsi <= 36 &&
      f.volumeRatio >= 1.15 &&
      f.lowerWickPct >= 0.12 &&
      f.closePosition >= 0.55 &&
      f.atrPct >= 0.18
  },
  {
    name: "relative-strength-breakout",
    description: "Altcoin outperforms BTC over the last hour while staying above VWAP with volume support.",
    matches: (f) =>
      f.symbol !== "BTCUSDT" &&
      f.relativeStrength12Pct >= 0.3 &&
      f.priceVsVwapPct >= 0.1 &&
      f.priceVsVwapPct <= 1.25 &&
      f.emaFastSlopePct >= 0.035 &&
      f.volumeRatio >= 1.05 &&
      f.rsi >= 50 &&
      f.rsi <= 74
  },
  {
    name: "controlled-mean-reversion",
    description: "Price is below VWAP but not in free fall, checking whether small rebounds can overcome spot costs.",
    matches: (f) =>
      f.priceVsVwapPct <= -0.35 &&
      f.priceVsVwapPct >= -1.25 &&
      f.rsi >= 30 &&
      f.rsi <= 47 &&
      f.return12Pct > -1.4 &&
      f.closePosition >= 0.5 &&
      f.volumeRatio >= 0.7
  }
];

async function main(): Promise<void> {
  const days = Number(process.argv[2] ?? 365);
  const config = loadCryptoBotConfig();
  const client = new BinanceClient({ apiKey: config.apiKey, apiSecret: config.apiSecret, baseUrl: config.baseUrl });
  const costPct = roundTripCostPct(config.strategy);
  const series = await loadSeries(client, config.symbols, days);
  const externalContext = loadExternalResearchContext();
  const externalFilters = externalContext ? EXTERNAL_RESEARCH_FILTERS : [];
  const btcReturn12ByTime = buildReturnByTime(series.find((item) => item.symbol === "BTCUSDT")?.rows5m ?? [], 12);
  const splitTime = computeValidationSplitTime(series);
  const buckets = createBuckets(externalFilters);
  let screenedBars = 0;
  let matchedSignals = 0;

  for (const item of series) {
    const result = researchSymbol(item, btcReturn12ByTime, costPct, buckets, splitTime, externalContext, externalFilters);
    screenedBars += result.screenedBars;
    matchedSignals += result.matchedSignals;
  }

  const scenarioResults = Array.from(buckets.entries())
    .map(([, bucket]) => ({
      ...finishAccumulator(bucket.accumulator),
      inSample: finishAccumulator(bucket.inSample),
      outOfSample: finishAccumulator(bucket.outOfSample),
      symbols: Array.from(bucket.bySymbol.values())
        .map(finishAccumulator)
        .filter((summary) => summary.trades > 0)
        .sort((a, b) => b.score - a.score)
    }))
    .sort((a, b) => b.score - a.score);

  const report = {
    generatedAt: new Date().toISOString(),
    days,
    symbols: series.map((item) => item.symbol),
    screenedBars,
    matchedSignals,
    assumptions: {
      timeframe: "5m",
      lookbackBars: LOOKBACK_BARS,
      volumeLookbackBars: VOLUME_LOOKBACK_BARS,
      costPct,
      source: "Binance public klines with local data/backtest-cache reuse",
      externalContext: externalContext
        ? {
            enabled: true,
            generatedAt: externalContext.generatedAt,
            days: externalContext.days,
            period: externalContext.period,
            symbols: externalContext.symbols,
            filters: externalFilters.map((filter) => ({ name: filter.name, description: filter.description })),
            note:
              "External filters are research-only combinations from data/external/free-market-context.json. Binance futures external history is limited to recent data, so combined samples are usually much smaller than the base K-line scan."
          }
        : { enabled: false, note: "No data/external/free-market-context.json file was available, so external filters were skipped." },
      exitProfiles,
      note:
        "This is an edge-discovery scan. It labels every matching candle independently and does not model cooldowns, concurrent-position limits, account equity, or symbol filters."
    },
    scenarios: scenarioResults,
    validation: buildResearchValidationReport({
      splitTime,
      splitTimeIso: new Date(splitTime).toISOString(),
      criteria: DEFAULT_RESEARCH_VALIDATION_CRITERIA,
      scenarios: scenarioResults as ResearchScenarioSplitSummary[]
    }),
    topPositive: scenarioResults.filter((item) => item.trades >= 30 && item.netPnlPct > 0 && item.profitFactor >= 1).slice(0, 10)
  };

  writeReport(report);
  printSummary(report);
}

async function loadSeries(client: BinanceClient, symbols: string[], days: number): Promise<SymbolSeries[]> {
  const result: SymbolSeries[] = [];
  for (const symbol of symbols) {
    const [raw5m, raw15m] = await Promise.all([
      fetchHistoricalKlines(client, symbol, "5m", days),
      fetchHistoricalKlines(client, symbol, "15m", days)
    ]);
    result.push({
      symbol,
      rows5m: raw5m.map(parseKline).filter((row) => row.close > 0 && row.volume > 0),
      rows15m: raw15m.map(parseKline).filter((row) => row.close > 0 && row.volume > 0)
    });
  }
  return result;
}

function createBuckets(externalFilters: ExternalResearchFilter[] = []): Map<string, ScenarioBucket> {
  const buckets = new Map<string, ScenarioBucket>();
  for (const scenario of scenarios) {
    for (const profile of exitProfiles) {
      const name = `${scenario.name}:${profile.name}`;
      const description = `${scenario.description} Exit profile: TP ${profile.takeProfitPct}%, SL ${profile.stopLossPct}%, horizon ${profile.horizonBars * 5}m.`;
      buckets.set(name, createScenarioBucket(name, description));
      for (const externalFilter of externalFilters) {
        const externalName = combinedBucketName(scenario, profile, externalFilter);
        const externalDescription = `${scenario.description} External filter: ${externalFilter.description} Exit profile: TP ${profile.takeProfitPct}%, SL ${profile.stopLossPct}%, horizon ${profile.horizonBars * 5}m.`;
        buckets.set(externalName, createScenarioBucket(externalName, externalDescription));
      }
    }
  }
  return buckets;
}

function createScenarioBucket(name: string, description: string): ScenarioBucket {
  return {
    accumulator: createResearchAccumulator(name, description),
    inSample: createResearchAccumulator(name, description),
    outOfSample: createResearchAccumulator(name, description),
    bySymbol: new Map()
  };
}

function researchSymbol(
  series: SymbolSeries,
  btcReturn12ByTime: Map<number, number>,
  costPct: number,
  buckets: Map<string, ScenarioBucket>,
  splitTime: number,
  externalContext?: ExternalResearchContext,
  externalFilters: ExternalResearchFilter[] = []
): { screenedBars: number; matchedSignals: number } {
  const rows = series.rows5m;
  const maxHorizon = Math.max(...exitProfiles.map((profile) => profile.horizonBars));
  const features = buildFeatureSeries(series);
  let screenedBars = 0;
  let matchedSignals = 0;

  for (let index = LOOKBACK_BARS; index < rows.length - maxHorizon; index += 1) {
    const feature = featureAt(series.symbol, rows[index], index, features, btcReturn12ByTime);
    if (!feature) {
      continue;
    }
    screenedBars += 1;

    const matched = scenarios.filter((scenario) => scenario.matches(feature));
    if (matched.length === 0) {
      continue;
    }
    const externalFeature = externalContext ? findExternalFeatureAt(externalContext, series.symbol, rows[index].openTime) : undefined;
    const matchedExternalFilters = externalFeature ? externalFilters.filter((filter) => filter.matches(externalFeature)) : [];

    const outcomes = new Map<string, ResearchOutcome>();
    for (const profile of exitProfiles) {
      outcomes.set(
        profile.name,
        labelLongOutcome(rows, index, {
          horizonBars: profile.horizonBars,
          takeProfitPct: profile.takeProfitPct,
          stopLossPct: profile.stopLossPct,
          costPct
        })
      );
    }

    for (const scenario of matched) {
      for (const profile of exitProfiles) {
        const bucket = buckets.get(`${scenario.name}:${profile.name}`);
        const outcomeValue = outcomes.get(profile.name);
        if (!bucket || !outcomeValue) {
          continue;
        }
        recordOutcome(bucket, series.symbol, outcomeValue, rows[index].openTime, splitTime);
        const symbolAccumulator =
          bucket.bySymbol.get(series.symbol) ?? createResearchAccumulator(series.symbol, bucket.accumulator.description);
        addOutcome(symbolAccumulator, outcomeValue);
        bucket.bySymbol.set(series.symbol, symbolAccumulator);
        matchedSignals += 1;

        for (const externalFilter of matchedExternalFilters) {
          const externalBucket = buckets.get(combinedBucketName(scenario, profile, externalFilter));
          if (!externalBucket) {
            continue;
          }
          recordOutcome(externalBucket, series.symbol, outcomeValue, rows[index].openTime, splitTime);
          const externalSymbolAccumulator =
            externalBucket.bySymbol.get(series.symbol) ?? createResearchAccumulator(series.symbol, externalBucket.accumulator.description);
          addOutcome(externalSymbolAccumulator, outcomeValue);
          externalBucket.bySymbol.set(series.symbol, externalSymbolAccumulator);
          matchedSignals += 1;
        }
      }
    }
  }

  return { screenedBars, matchedSignals };
}

function combinedBucketName(scenario: Scenario, profile: ExitProfile, externalFilter: ExternalResearchFilter): string {
  return `${scenario.name}+${externalFilter.name}:${profile.name}`;
}

function recordOutcome(bucket: ScenarioBucket, symbol: string, outcomeValue: ResearchOutcome, openTime: number, splitTime: number): void {
  addOutcome(bucket.accumulator, outcomeValue);
  addOutcome(openTime < splitTime ? bucket.inSample : bucket.outOfSample, outcomeValue);
}

function computeValidationSplitTime(series: SymbolSeries[]): number {
  const times = series.flatMap((item) => item.rows5m.map((row) => row.openTime));
  const start = Math.min(...times);
  const end = Math.max(...times);
  return start + Math.floor((end - start) / 2);
}

function buildFeatureSeries(series: SymbolSeries) {
  const closes = series.rows5m.map((row) => row.close);
  const volumes = series.rows5m.map((row) => row.volume);
  return {
    closes,
    emaFast: emaSeries(closes, 9),
    emaSlow: emaSeries(closes, 21),
    rsi: rsiSeries(closes, 14),
    atrPct: atrPctSeries(series.rows5m, 14),
    vwap: rollingVwap(series.rows5m, LOOKBACK_BARS),
    avgVolume: rollingAverage(volumes, VOLUME_LOOKBACK_BARS),
    bollinger: bollingerSeries(closes, 20),
    return3: returnSeries(closes, 3),
    return6: returnSeries(closes, 6),
    return12: returnSeries(closes, 12),
    higherTrend: buildHigherTrend(series.rows15m)
  };
}

function featureAt(
  symbol: string,
  row: ParsedKline,
  index: number,
  features: ReturnType<typeof buildFeatureSeries>,
  btcReturn12ByTime: Map<number, number>
): FeatureSnapshot | undefined {
  const vwap = features.vwap[index];
  const bollinger = features.bollinger[index];
  const avgVolume = features.avgVolume[index];
  const higher = latestHigherTrend(features.higherTrend, row.openTime);
  if (!vwap || !bollinger || !avgVolume || !higher) {
    return undefined;
  }

  const previousFast = features.emaFast[Math.max(0, index - 3)] || features.emaFast[index];
  const emaFastSlopePct = previousFast > 0 ? ((features.emaFast[index] - previousFast) / previousFast) * 100 : 0;
  const higherTrendGapPct = higher.slow > 0 ? ((higher.fast - higher.slow) / higher.slow) * 100 : 0;
  const range = Math.max(row.high - row.low, 0);
  const closePosition = range > 0 ? (row.close - row.low) / range : 0.5;
  const bodyPct = row.open > 0 ? (Math.abs(row.close - row.open) / row.open) * 100 : 0;
  const lowerWickPct = row.open > 0 ? ((Math.min(row.open, row.close) - row.low) / row.open) * 100 : 0;
  const upperWickPct = row.open > 0 ? ((row.high - Math.max(row.open, row.close)) / row.open) * 100 : 0;
  const return12Pct = features.return12[index];

  return {
    symbol,
    openTime: row.openTime,
    close: row.close,
    priceVsVwapPct: vwap > 0 ? ((row.close - vwap) / vwap) * 100 : 0,
    emaFastAboveSlow: features.emaFast[index] > features.emaSlow[index],
    emaFastSlopePct,
    higherTrendGapPct,
    rsi: features.rsi[index],
    atrPct: features.atrPct[index],
    volumeRatio: avgVolume > 0 ? row.volume / avgVolume : 1,
    bollingerBandwidthPct: bollinger.bandwidthPct,
    bollingerPercentB: bollinger.percentB,
    return3Pct: features.return3[index],
    return6Pct: features.return6[index],
    return12Pct,
    relativeStrength12Pct: return12Pct - (btcReturn12ByTime.get(row.openTime) ?? 0),
    candleBodyPct: bodyPct,
    closePosition,
    lowerWickPct,
    upperWickPct
  };
}

function emaSeries(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length === 0) {
    return result;
  }
  const alpha = 2 / (period + 1);
  let previous = values[0];
  for (const value of values) {
    previous = value * alpha + previous * (1 - alpha);
    result.push(previous);
  }
  return result;
}

function rollingAverage(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) {
      sum -= values[index - period];
    }
    result.push(index + 1 >= period ? sum / period : 0);
  }
  return result;
}

function rsiSeries(values: number[], period: number): number[] {
  const result = Array.from({ length: values.length }, () => 50);
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);

    if (index > period) {
      const oldChange = values[index - period] - values[index - period - 1];
      gains -= Math.max(oldChange, 0);
      losses -= Math.max(-oldChange, 0);
    }

    if (index >= period) {
      result[index] = losses === 0 ? (gains > 0 ? 100 : 50) : 100 - 100 / (1 + gains / losses);
    }
  }

  return result;
}

function atrPctSeries(rows: ParsedKline[], period: number): number[] {
  const result = Array.from({ length: rows.length }, () => 0);
  let sum = 0;
  const trueRanges: number[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const previousClose = rows[index - 1].close;
    const trueRange = Math.max(rows[index].high - rows[index].low, Math.abs(rows[index].high - previousClose), Math.abs(rows[index].low - previousClose));
    trueRanges.push(trueRange);
    sum += trueRange;
    if (trueRanges.length > period) {
      sum -= trueRanges.shift() ?? 0;
    }
    result[index] = rows[index].close > 0 ? (sum / Math.max(trueRanges.length, 1) / rows[index].close) * 100 : 0;
  }

  return result;
}

function rollingVwap(rows: ParsedKline[], period: number): number[] {
  const result: number[] = [];
  let quote = 0;
  let volume = 0;
  for (let index = 0; index < rows.length; index += 1) {
    quote += rows[index].quoteVolume;
    volume += rows[index].volume;
    if (index >= period) {
      quote -= rows[index - period].quoteVolume;
      volume -= rows[index - period].volume;
    }
    result.push(index + 1 >= period && volume > 0 ? quote / volume : 0);
  }
  return result;
}

function bollingerSeries(values: number[], period: number): Array<{ bandwidthPct: number; percentB: number } | undefined> {
  const result: Array<{ bandwidthPct: number; percentB: number } | undefined> = [];
  let sum = 0;
  let sumSquares = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    sum += value;
    sumSquares += value * value;
    if (index >= period) {
      const old = values[index - period];
      sum -= old;
      sumSquares -= old * old;
    }

    if (index + 1 < period) {
      result.push(undefined);
      continue;
    }

    const mean = sum / period;
    const variance = Math.max(sumSquares / period - mean * mean, 0);
    const deviation = Math.sqrt(variance);
    const upper = mean + deviation * 2;
    const lower = mean - deviation * 2;
    const width = upper - lower;
    result.push({
      bandwidthPct: mean > 0 ? (width / mean) * 100 : 0,
      percentB: width > 0 ? (value - lower) / width : 0.5
    });
  }

  return result;
}

function returnSeries(values: number[], lookback: number): number[] {
  return values.map((value, index) => {
    const previous = values[index - lookback];
    return previous > 0 ? ((value - previous) / previous) * 100 : 0;
  });
}

function buildReturnByTime(rows: ParsedKline[], lookback: number): Map<number, number> {
  const values = returnSeries(
    rows.map((row) => row.close),
    lookback
  );
  return new Map(rows.map((row, index) => [row.openTime, values[index]]));
}

function buildHigherTrend(rows15m: ParsedKline[]): HigherTrendPoint[] {
  const closes = rows15m.map((row) => row.close);
  const fast = emaSeries(closes, 20);
  const slow = emaSeries(closes, 50);
  return rows15m.map((row, index) => ({ openTime: row.openTime, fast: fast[index], slow: slow[index] }));
}

function latestHigherTrend(points: HigherTrendPoint[], openTime: number): HigherTrendPoint | undefined {
  let low = 0;
  let high = points.length - 1;
  let result: HigherTrendPoint | undefined;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].openTime <= openTime) {
      result = points[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function writeReport(report: unknown): void {
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report: {
  days: number;
  symbols: string[];
  screenedBars: number;
  matchedSignals: number;
  assumptions: { costPct: number };
  scenarios: Array<ReturnType<typeof finishAccumulator> & { symbols: ReturnType<typeof finishAccumulator>[] }>;
  topPositive: Array<ReturnType<typeof finishAccumulator> & { symbols: ReturnType<typeof finishAccumulator>[] }>;
  validation?: { splitTimeIso: string; selected: unknown[]; survivors: Array<{ name: string; outOfSample: ReturnType<typeof finishAccumulator> }> };
}): void {
  console.log(`Research ${report.days}d complete: symbols=${report.symbols.join(",")}, screenedBars=${report.screenedBars}, matchedSignals=${report.matchedSignals}`);
  console.log(`Cost assumption: ${report.assumptions.costPct.toFixed(3)}% per round trip. Report: ${REPORT_PATH}`);
  const top = report.scenarios.slice(0, 10).map((item) => ({
    scenario: item.name,
    trades: item.trades,
    netPct: Number(item.netPnlPct.toFixed(2)),
    avgPct: Number(item.avgPnlPct.toFixed(4)),
    winPct: Number((item.winRate * 100).toFixed(1)),
    pf: Number(item.profitFactor.toFixed(2)),
    ddPct: Number(item.maxDrawdownPct.toFixed(2)),
    tp: item.reasonCounts.take_profit,
    sl: item.reasonCounts.stop_loss,
    timeout: item.reasonCounts.timeout
  }));
  console.table(top);
  if (report.topPositive.length === 0) {
    console.log("No scenario reached positive net PnL with >=30 trades and PF >= 1 under this scan.");
  }
  if (report.validation) {
    console.log(
      `Validation split: ${report.validation.splitTimeIso}; selected=${report.validation.selected.length}; survivors=${report.validation.survivors.length}`
    );
    console.table(
      report.validation.survivors.slice(0, 10).map((item) => ({
        scenario: item.name,
        outTrades: item.outOfSample.trades,
        outNetPct: Number(item.outOfSample.netPnlPct.toFixed(2)),
        outWinPct: Number((item.outOfSample.winRate * 100).toFixed(1)),
        outPf: Number(item.outOfSample.profitFactor.toFixed(2)),
        outDdPct: Number(item.outOfSample.maxDrawdownPct.toFixed(2))
      }))
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
