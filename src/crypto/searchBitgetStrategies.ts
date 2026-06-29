import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchBitgetHistoryCandles } from "./bitgetClient";
import { computeFramaChannelSeries, computeRangeFilterSeries } from "./tradingViewIndicators";
import { runFixedRiskSignalBacktest, type FixedRiskBacktestResult } from "./strategyResearch";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timeFromEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

interface CandidateSummary {
  rank: number;
  score: number;
  meetsTarget: boolean;
  config: Record<string, unknown>;
  trades: number;
  endingEquityUsdt: number;
  returnPct: number;
  avgDailyReturnPct: number;
  minDailyReturnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  daily: FixedRiskBacktestResult["daily"];
}

const symbol = process.env.BITGET_SYMBOL ?? "MUUSDT";
const productType = process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES";
const granularity = process.env.BITGET_GRANULARITY ?? "1m";
const days = numberFromEnv("BITGET_BACKTEST_DAYS", 14);
const warmupDays = numberFromEnv("BITGET_WARMUP_DAYS", 3);
const initialEquityUsdt = numberFromEnv("BITGET_INITIAL_EQUITY_USDT", 100);
const feeRate = numberFromEnv("BITGET_FEE_RATE", 0.0006);
const endTime = timeFromEnv("BITGET_BACKTEST_END_TIME") ?? Date.now();
const startTime = timeFromEnv("BITGET_BACKTEST_START_TIME") ?? endTime - days * 24 * 60 * 60 * 1000;
const warmupStartTime = startTime - warmupDays * 24 * 60 * 60 * 1000;
const outputPath = process.env.BITGET_STRATEGY_SEARCH_PATH ?? "data/bitget-muusdt-strategy-search.json";

const rows = await fetchBitgetHistoryCandles({
  symbol,
  productType,
  granularity,
  startTime: warmupStartTime,
  endTime
});

const frama = computeFramaChannelSeries(rows, { length: 26, bandsDistance: 1.5 });
const framaColors = frama.map((point) => point.candleColor);

const rangePeriods = [75, 100, 125];
const rangeMultipliers = [2, 2.5, 3];
const riskRewardRatios = [1, 1.5, 2];
const riskFractions = [0.02, 0.05];
const cooldownBars = [0, 5];
const maxLeverages = [25];
const percentStops = [0.004, 0.008];
const wickFilters = [
  { minStopPct: 0.002, maxStopPct: 0.02 },
  { minStopPct: 0.003, maxStopPct: 0.03 }
];
const colorGates = ["none", "withTrend"] as const;
const signalModes = ["normal", "inverse"] as const;

function signalsForMode(signals: ReturnType<typeof computeRangeFilterSeries>[number]["signal"][], mode: (typeof signalModes)[number]) {
  if (mode === "normal") {
    return signals;
  }
  return signals.map((signal) => (signal === "buy" ? "sell" : signal === "sell" ? "buy" : undefined));
}

function scoreResult(result: FixedRiskBacktestResult): number {
  const tradePenalty = result.trades.length < 20 ? 50 : 0;
  return (
    result.avgDailyReturnPct * 5 +
    result.minDailyReturnPct * 4 +
    result.profitFactor * 10 -
    result.maxDrawdownPct * 0.75 -
    tradePenalty
  );
}

function summarize(config: Record<string, unknown>, result: FixedRiskBacktestResult): Omit<CandidateSummary, "rank"> {
  const meetsTarget =
    result.avgDailyReturnPct >= 5 &&
    result.minDailyReturnPct >= 0 &&
    result.trades.length >= 20 &&
    result.maxDrawdownPct <= 50 &&
    result.profitFactor >= 1.2;
  return {
    score: scoreResult(result),
    meetsTarget,
    config,
    trades: result.trades.length,
    endingEquityUsdt: result.endingEquityUsdt,
    returnPct: result.returnPct,
    avgDailyReturnPct: result.avgDailyReturnPct,
    minDailyReturnPct: result.minDailyReturnPct,
    winRate: result.winRate,
    profitFactor: result.profitFactor,
    maxDrawdownPct: result.maxDrawdownPct,
    daily: result.daily
  };
}

const bestCandidates: Omit<CandidateSummary, "rank">[] = [];
const targetMatches: Omit<CandidateSummary, "rank">[] = [];
let tested = 0;

function keepCandidate(candidate: Omit<CandidateSummary, "rank">): void {
  if (candidate.meetsTarget) {
    targetMatches.push(candidate);
  }
  bestCandidates.push(candidate);
  bestCandidates.sort((left, right) => {
    if (left.meetsTarget !== right.meetsTarget) {
      return left.meetsTarget ? -1 : 1;
    }
    return right.score - left.score;
  });
  bestCandidates.splice(50);
}

for (const samplingPeriod of rangePeriods) {
  for (const rangeMultiplier of rangeMultipliers) {
    const range = computeRangeFilterSeries(rows, { samplingPeriod, rangeMultiplier });
    const rawSignals = range.map((point) => point.signal);
    for (const signalMode of signalModes) {
      const signals = signalsForMode(rawSignals, signalMode);
      for (const riskRewardRatio of riskRewardRatios) {
        for (const riskFraction of riskFractions) {
          for (const cooldown of cooldownBars) {
            for (const maxLeverage of maxLeverages) {
              for (const colorGate of colorGates) {
                for (const stopPct of percentStops) {
                  tested += 1;
                  const config = { samplingPeriod, rangeMultiplier, signalMode, stopMode: "percent", stopPct, riskRewardRatio, riskFraction, cooldown, maxLeverage, colorGate };
                  const result = runFixedRiskSignalBacktest({
                    symbol,
                    rows,
                    signals,
                    framaColors: colorGate === "withTrend" ? framaColors : undefined,
                    colorGate,
                    initialEquityUsdt,
                    riskFraction,
                    riskRewardRatio,
                    maxLeverage,
                    feeRate,
                    tradeStartTime: startTime,
                    stopMode: "percent",
                    stopPct,
                    cooldownBars: cooldown,
                    allowReverse: true
                  });
                  keepCandidate(summarize(config, result));
                }
                for (const filter of wickFilters) {
                  tested += 1;
                  const config = { samplingPeriod, rangeMultiplier, signalMode, stopMode: "wick", ...filter, riskRewardRatio, riskFraction, cooldown, maxLeverage, colorGate };
                  const result = runFixedRiskSignalBacktest({
                    symbol,
                    rows,
                    signals,
                    framaColors: colorGate === "withTrend" ? framaColors : undefined,
                    colorGate,
                    initialEquityUsdt,
                    riskFraction,
                    riskRewardRatio,
                    maxLeverage,
                    feeRate,
                    tradeStartTime: startTime,
                    stopMode: "wick",
                    minStopPct: filter.minStopPct,
                    maxStopPct: filter.maxStopPct,
                    cooldownBars: cooldown,
                    allowReverse: true
                  });
                  keepCandidate(summarize(config, result));
                }
              }
            }
          }
        }
      }
    }
  }
}

const ranked = bestCandidates.map((candidate, index) => ({ rank: index + 1, ...candidate }));
const matches = targetMatches
  .sort((left, right) => right.score - left.score)
  .slice(0, 50)
  .map((candidate, index) => ({ rank: index + 1, ...candidate }));

const report = {
  generatedAt: new Date().toISOString(),
  exchange: "bitget",
  productType,
  symbol,
  granularity,
  startTime: new Date(startTime).toISOString(),
  endTime: new Date(endTime).toISOString(),
  warmupStartTime: new Date(warmupStartTime).toISOString(),
  sourceCandles: rows.length,
  tradingCandles: rows.filter((row) => row.openTime >= startTime).length,
  tested,
  target: {
    avgDailyReturnPctGte: 5,
    minDailyReturnPctGte: 0,
    maxDrawdownPctLte: 50,
    minTrades: 20,
    profitFactorGte: 1.2
  },
  best: ranked[0],
  matches,
  top: ranked
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (process.env.BITGET_STRATEGY_SEARCH_SILENT !== "1") {
  console.log(JSON.stringify(report, null, 2));
}
