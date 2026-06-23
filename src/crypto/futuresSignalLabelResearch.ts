import { labelLongOutcome, labelShortOutcome, summarizeOutcomes, type ResearchScenarioSummary } from "./research";
import { computeAtr, computeRsi, computeVwap, ema, parseKline } from "./indicators";
import type { BinanceKline, ParsedKline } from "./types";

export interface FuturesSignalLabelInput {
  days: number;
  symbols: Array<{ symbol: string; rows: BinanceKline[] }>;
  horizonBars: number;
  takeProfitPct: number;
  stopLossPct: number;
  costPct: number;
  leverage: number;
  warmupBars?: number;
}

export interface FuturesSignalLabelBucket extends ResearchScenarioSummary {
  direction: "long" | "short" | "both";
  marginNetPnlPct: number;
  avgMarginPnlPct: number;
}

export interface FuturesSignalLabelReport {
  generatedAt: string;
  days: number;
  symbols: string[];
  assumptions: {
    horizonMinutes: number;
    takeProfitPct: number;
    stopLossPct: number;
    costPct: number;
    leverage: number;
    note: string;
  };
  screenedBars: number;
  baseline: FuturesSignalLabelBucket;
  buckets: FuturesSignalLabelBucket[];
  topPositive: FuturesSignalLabelBucket[];
  randomDirectionNote: string;
}

interface Feature {
  symbol: string;
  emaSlopePct: number;
  priceVsVwapPct: number;
  rsi: number;
  atrPct: number;
  volumeRatio: number;
  candleBodyPct: number;
  closePosition: number;
}

interface BucketDefinition {
  name: string;
  direction: "long" | "short";
  description: string;
  matches: (feature: Feature) => boolean;
}

const BUCKETS: BucketDefinition[] = [
  {
    name: "long-right-side-vwap-reclaim",
    direction: "long",
    description: "Long only: EMA slope positive, price near/above VWAP, RSI constructive, volume not dead.",
    matches: (f) => f.emaSlopePct > 0.03 && f.priceVsVwapPct >= -0.15 && f.priceVsVwapPct <= 0.85 && f.rsi >= 48 && f.rsi <= 68 && f.volumeRatio >= 0.8
  },
  {
    name: "long-high-volume-breakout",
    direction: "long",
    description: "Long only: strong candle closes high above VWAP with volume expansion.",
    matches: (f) => f.emaSlopePct > 0.05 && f.priceVsVwapPct > 0.15 && f.priceVsVwapPct <= 1.2 && f.volumeRatio >= 1.2 && f.closePosition >= 0.65 && f.rsi <= 74
  },
  {
    name: "short-vwap-breakdown",
    direction: "short",
    description: "Short only: EMA slope negative, price below VWAP, RSI not oversold, volume not dead.",
    matches: (f) => f.emaSlopePct < -0.03 && f.priceVsVwapPct <= -0.15 && f.priceVsVwapPct >= -1.2 && f.rsi >= 30 && f.rsi <= 55 && f.volumeRatio >= 0.8
  },
  {
    name: "short-high-volume-breakdown",
    direction: "short",
    description: "Short only: strong candle closes low below VWAP with volume expansion.",
    matches: (f) => f.emaSlopePct < -0.05 && f.priceVsVwapPct < -0.15 && f.priceVsVwapPct >= -1.4 && f.volumeRatio >= 1.2 && f.closePosition <= 0.35 && f.rsi >= 24
  },
  {
    name: "avoid-high-noise-altcoin",
    direction: "long",
    description: "Diagnostic long bucket: non-major symbols with high ATR noise.",
    matches: (f) => !["BTCUSDT", "ETHUSDT", "BNBUSDT"].includes(f.symbol) && f.atrPct >= 0.45
  }
];

export function createFuturesSignalLabelReportFromRows(input: FuturesSignalLabelInput): FuturesSignalLabelReport {
  const warmupBars = input.warmupBars ?? 240;
  const baselineOutcomes = [];
  const bucketOutcomes = new Map<string, { definition: BucketDefinition; outcomes: ReturnType<typeof labelLongOutcome>[] }>();
  let screenedBars = 0;

  for (const definition of BUCKETS) {
    bucketOutcomes.set(definition.name, { definition, outcomes: [] });
  }

  for (const symbolRows of input.symbols) {
    const rows = symbolRows.rows.map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
    const features = buildFeatures(symbolRows.symbol, rows);
    const maxIndex = rows.length - input.horizonBars - 1;
    for (let index = warmupBars; index <= maxIndex; index += 1) {
      screenedBars += 1;
      const labelOptions = {
        horizonBars: input.horizonBars,
        takeProfitPct: input.takeProfitPct,
        stopLossPct: input.stopLossPct,
        costPct: input.costPct
      };
      const longOutcome = labelLongOutcome(rows, index, labelOptions);
      const shortOutcome = labelShortOutcome(rows, index, labelOptions);
      baselineOutcomes.push(longOutcome, shortOutcome);

      const feature = features[index];
      if (!feature) {
        continue;
      }
      for (const item of bucketOutcomes.values()) {
        if (!item.definition.matches(feature)) {
          continue;
        }
        item.outcomes.push(item.definition.direction === "long" ? longOutcome : shortOutcome);
      }
    }
  }

  const baseline = toFuturesBucket(summarizeOutcomes("random-long-short-baseline", baselineOutcomes, "Every eligible candle labelled both long and short."), "both", input.leverage);
  const buckets = Array.from(bucketOutcomes.values())
    .map((item) => toFuturesBucket(summarizeOutcomes(item.definition.name, item.outcomes, item.definition.description), item.definition.direction, input.leverage))
    .sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    days: input.days,
    symbols: input.symbols.map((item) => item.symbol),
    assumptions: {
      horizonMinutes: input.horizonBars * 5,
      takeProfitPct: input.takeProfitPct,
      stopLossPct: input.stopLossPct,
      costPct: input.costPct,
      leverage: input.leverage,
      note: "Net PnL is measured on notional price move after estimated round-trip cost. Margin PnL multiplies that by leverage."
    },
    screenedBars,
    baseline,
    buckets,
    topPositive: buckets.filter((bucket) => bucket.trades >= 30 && bucket.netPnlPct > 0 && bucket.profitFactor >= 1).slice(0, 10),
    randomDirectionNote:
      "Random direction can be near 50/50 while net profitability is negative because costs, spread/slippage, asymmetric first-touch paths, and liquidation risk are paid by the trader."
  };
}

function toFuturesBucket(summary: ResearchScenarioSummary, direction: FuturesSignalLabelBucket["direction"], leverage: number): FuturesSignalLabelBucket {
  return {
    ...summary,
    direction,
    marginNetPnlPct: summary.netPnlPct * leverage,
    avgMarginPnlPct: summary.avgPnlPct * leverage
  };
}

function buildFeatures(symbol: string, rows: ParsedKline[]): Array<Feature | undefined> {
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  return rows.map((row, index) => {
    if (index < 30) {
      return undefined;
    }
    const recent = rows.slice(Math.max(0, index - 239), index + 1);
    const closeWindow = closes.slice(Math.max(0, index - 30), index + 1);
    const previousWindow = closes.slice(Math.max(0, index - 33), Math.max(1, index - 2));
    const emaFast = ema(closeWindow, 9);
    const previousFast = ema(previousWindow, 9) || emaFast;
    const avgVolume = volumes.slice(Math.max(0, index - 39), index + 1).reduce((sum, value) => sum + value, 0) / Math.min(index + 1, 40);
    const vwap = computeVwap(recent);
    const atr = computeAtr(recent, 14);
    const range = Math.max(row.high - row.low, 0);
    return {
      symbol,
      emaSlopePct: previousFast > 0 ? ((emaFast - previousFast) / previousFast) * 100 : 0,
      priceVsVwapPct: vwap > 0 ? ((row.close - vwap) / vwap) * 100 : 0,
      rsi: computeRsi(closeWindow, 14),
      atrPct: row.close > 0 ? (atr / row.close) * 100 : 0,
      volumeRatio: avgVolume > 0 ? row.volume / avgVolume : 1,
      candleBodyPct: row.open > 0 ? (Math.abs(row.close - row.open) / row.open) * 100 : 0,
      closePosition: range > 0 ? (row.close - row.low) / range : 0.5
    };
  });
}
