import { loadCryptoBotConfig } from "./config";
import { fetchBitgetKlinesForInterval } from "./bitgetBacktest";
import { aggregateFuturesBacktest, backtestFuturesSymbolFromRows, writeFuturesBacktestReport } from "./futuresBacktest";
import type { FuturesBacktestResult, FuturesBacktestSymbolResult } from "./futuresBacktest";
import type { FuturesPaperConfig } from "./futuresPaper";
import { getStrategyById } from "./strategyRegistry";
import type { BinanceKline } from "./types";

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

function symbolsFromEnv(fallback: string[]): string[] {
  return (process.env.BITGET_SYMBOLS ?? process.env.CRYPTO_SYMBOLS ?? fallback.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

const config = loadCryptoBotConfig();
const days = Number(process.argv[2] ?? process.env.BITGET_BACKTEST_DAYS ?? 14);
const strategyId = process.argv[3] ?? process.env.BITGET_BACKTEST_STRATEGY_ID ?? "bitget-composite-router";
const productType = process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES";
const outputPath = process.env.BITGET_BACKTEST_REPORT_PATH ?? "data/bitget-futures-backtest-report.json";
const endTime = timeFromEnv("BITGET_BACKTEST_END_TIME") ?? Date.now();
const startTime = timeFromEnv("BITGET_BACKTEST_START_TIME") ?? endTime - days * 24 * 60 * 60 * 1000;
const symbols = symbolsFromEnv(config.symbols);
const strategy = getStrategyById(strategyId);
const klineCache = new Map<string, BinanceKline[]>();
const futuresConfig: FuturesPaperConfig = {
  leverage: numberFromEnv("FUTURES_PAPER_LEVERAGE", numberFromEnv("BITGET_LEVERAGE", 5)),
  feeRate: numberFromEnv("FUTURES_FEE_RATE", numberFromEnv("BITGET_FEE_RATE", 0.0006)),
  estimatedSlippagePct: numberFromEnv("FUTURES_ESTIMATED_SLIPPAGE_PCT", config.strategy.estimatedSlippagePct),
  priceImpactPct: numberFromEnv("FUTURES_PRICE_IMPACT_PCT", config.strategy.priceImpactPct),
  maintenanceMarginRate: numberFromEnv("FUTURES_MAINTENANCE_MARGIN_RATE", numberFromEnv("BITGET_MAINTENANCE_MARGIN_RATE", 0.005))
};

async function getKlines(symbol: string, interval: "5m" | "15m" | "1h"): Promise<BinanceKline[]> {
  const key = `${symbol}:${interval}`;
  const cached = klineCache.get(key);
  if (cached) {
    return cached;
  }
  const rows = await fetchBitgetKlinesForInterval({ symbol, productType, interval, startTime, endTime });
  klineCache.set(key, rows);
  return rows;
}

async function runSymbol(symbol: string): Promise<FuturesBacktestSymbolResult> {
  const raw5m = await getKlines(symbol, "5m");
  const raw15m = await getKlines(symbol, "15m");
  const rawHourly = await getKlines(symbol, "1h");
  const rawBenchmark5m = symbol === "BTCUSDT" ? undefined : await getKlines("BTCUSDT", "5m");
  const rawBenchmark15m = symbol === "BTCUSDT" ? undefined : await getKlines("BTCUSDT", "15m");

  return backtestFuturesSymbolFromRows({
    symbol,
    raw5m,
    raw15m,
    rawHourly,
    rawBenchmark5m,
    rawBenchmark15m,
    marginUsdt: numberFromEnv("FUTURES_PAPER_MARGIN_USDT", numberFromEnv("BITGET_MARGIN_USDT", 20)),
    strategyConfig: config.strategy,
    signalStrategy: strategy,
    futuresConfig
  });
}

const symbolResults: FuturesBacktestSymbolResult[] = [];
for (const symbol of symbols) {
  symbolResults.push(await runSymbol(symbol));
}
const base: Omit<FuturesBacktestResult, "totals"> = {
  generatedAt: new Date().toISOString(),
  days,
  strategyId,
  initialCapitalUsdt: config.backtestInitialCapitalUsdt,
  marginUsdt: numberFromEnv("FUTURES_PAPER_MARGIN_USDT", numberFromEnv("BITGET_MARGIN_USDT", 20)),
  maxOpenPositions: numberFromEnv("FUTURES_PAPER_MAX_OPEN_POSITIONS", numberFromEnv("BITGET_MAX_OPEN_POSITIONS", 5)),
  futuresConfig,
  strategy: config.strategy,
  symbols: symbolResults,
  note: `Bitget ${productType} futures-candle backtest. Uses Bitget 5m/15m/1H klines, shared futures execution model, synthetic kline-derived flow/liquidity. Biased evidence, not live readiness.`
};
const report = {
  exchange: "bitget",
  productType,
  startTime: new Date(startTime).toISOString(),
  endTime: new Date(endTime).toISOString(),
  ...base,
  totals: aggregateFuturesBacktest(base)
};

writeFuturesBacktestReport(report, outputPath);
console.log(JSON.stringify(report, null, 2));
