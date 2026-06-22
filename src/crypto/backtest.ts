import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BinanceClient } from "./binanceClient";
import { computeAtr, computeBollingerBands, computeDonchianCloseChannel, computeDonchianCloseChannels, computeRsi, computeVolatilityChannel, computeVolumeRatio, computeVwap, ema, parseKline } from "./indicators";
import { assessMarketRegime } from "./marketRegime";
import { emaVwapTrendStrategy } from "./strategy";
import type { CryptoStrategy } from "./strategyTypes";
import type { BinanceKline, CryptoMarketAnalysis, CryptoStrategyConfig, ParsedKline } from "./types";

export interface BacktestTrade {
  symbol: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  entryQuoteQty: number;
  quantity: number;
  pnlUsdt: number;
  reason: "stop_loss" | "take_profit" | "trailing_stop" | "signal_exit" | "timeout" | "end";
  entryScore?: number;
  entryRsi?: number;
  entryAtrPct?: number;
  entryPriceVsVwapPct?: number;
  entryEmaFastSlopePct?: number;
  entryHigherTrendGapPct?: number;
  entryBuySellImbalance?: number;
  entryLargeTradeBuyRatio?: number;
  entryValueAreaPosition?: CryptoMarketAnalysis["volumeProfile"]["currentPricePosition"];
}

export interface BacktestSymbolResult {
  symbol: string;
  candles: number;
  trades: BacktestTrade[];
  netPnlUsdt: number;
  winRate: number;
  maxDrawdownUsdt: number;
  profitFactor: number;
  diagnostics: BacktestSymbolDiagnostics;
}

export interface BacktestSymbolDiagnostics {
  tradeCount: number;
  averagePnlUsdt: number;
  bestTradePnlUsdt: number;
  worstTradePnlUsdt: number;
  exitReasons: Record<BacktestTrade["reason"], number>;
  recommendation: "keep" | "watch" | "exclude";
  recommendationReason: string;
}

export interface BacktestResult {
  generatedAt: string;
  days: number;
  strategyId?: string;
  initialCapitalUsdt: number;
  orderQuoteQty: number;
  maxOpenPositions: number;
  strategy: CryptoStrategyConfig;
  symbols: BacktestSymbolResult[];
  totals: {
    trades: number;
    netPnlUsdt: number;
    endingCapitalUsdt: number;
    returnPct: number;
    winRate: number;
    maxDrawdownUsdt: number;
    maxDrawdownPct: number;
    profitFactor: number;
    maxConcurrentPositions: number;
    maxCapitalUsedUsdt: number;
    capitalUtilizationPct: number;
    skippedTrades: number;
  };
  note: string;
}

const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface KlineCacheFile {
  generatedAt: string;
  symbol: string;
  interval: string;
  days: number;
  rows: BinanceKline[];
}

function cachePath(symbol: string, interval: string, days: number): string {
  const safeSymbol = symbol.replace(/[^A-Z0-9]/gi, "_").toUpperCase();
  const safeInterval = interval.replace(/[^a-z0-9]/gi, "_");
  return path.resolve(process.cwd(), "data/backtest-cache", `${safeSymbol}-${safeInterval}-${days}d.json`);
}

function readKlineCache(symbol: string, interval: string, days: number): BinanceKline[] | undefined {
  const filePath = cachePath(symbol, interval, days);
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const cached = JSON.parse(readFileSync(filePath, "utf8")) as KlineCacheFile;
    const generatedAt = Date.parse(cached.generatedAt);
    if (
      cached.symbol === symbol &&
      cached.interval === interval &&
      cached.days === days &&
      Number.isFinite(generatedAt) &&
      Date.now() - generatedAt <= CACHE_MAX_AGE_MS &&
      Array.isArray(cached.rows)
    ) {
      return cached.rows;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function writeKlineCache(symbol: string, interval: string, days: number, rows: BinanceKline[]): void {
  const filePath = cachePath(symbol, interval, days);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), symbol, interval, days, rows }, null, 2)}\n`,
    "utf8"
  );
}

export async function fetchHistoricalKlines(client: BinanceClient, symbol: string, interval: string, days: number): Promise<BinanceKline[]> {
  const cached = readKlineCache(symbol, interval, days);
  if (cached) {
    return cached;
  }

  const intervalMs = interval === "15m" ? FIFTEEN_MINUTES : FIVE_MINUTES;
  const end = Date.now();
  let cursor = end - days * 24 * 60 * 60 * 1000;
  const rows: BinanceKline[] = [];

  while (cursor < end) {
    const chunk = await client.fetchKlines(symbol, interval, cursor, end, 1000);
    if (chunk.length === 0) {
      break;
    }
    rows.push(...chunk);
    const lastOpenTime = Number(chunk.at(-1)?.[0] ?? cursor);
    const next = lastOpenTime + intervalMs;
    if (next <= cursor) {
      break;
    }
    cursor = next;
  }

  const seen = new Set<number>();
  const result = rows.filter((row) => {
    const openTime = Number(row[0]);
    if (seen.has(openTime)) {
      return false;
    }
    seen.add(openTime);
    return true;
  });
  writeKlineCache(symbol, interval, days, result);
  return result;
}

export function summarizeSymbolDiagnostics(
  trades: BacktestTrade[],
  summary: { netPnlUsdt: number; profitFactor: number; winRate: number }
): BacktestSymbolDiagnostics {
  const exitReasons: BacktestSymbolDiagnostics["exitReasons"] = {
    stop_loss: 0,
    take_profit: 0,
    trailing_stop: 0,
    signal_exit: 0,
    timeout: 0,
    end: 0
  };

  for (const trade of trades) {
    exitReasons[trade.reason] += 1;
  }

  const pnls = trades.map((trade) => trade.pnlUsdt);
  const averagePnlUsdt = pnls.reduce((sum, value) => sum + value, 0) / Math.max(pnls.length, 1);
  const bestTradePnlUsdt = pnls.length > 0 ? Math.max(...pnls) : 0;
  const worstTradePnlUsdt = pnls.length > 0 ? Math.min(...pnls) : 0;
  let recommendation: BacktestSymbolDiagnostics["recommendation"] = "watch";
  let recommendationReason = "Need more trades before making a symbol-level decision";

  if (trades.length >= 3 && summary.netPnlUsdt > 0 && summary.profitFactor >= 1) {
    recommendation = "keep";
    recommendationReason = "Positive net PnL with profit factor at or above 1";
  } else if (trades.length >= 3 && summary.netPnlUsdt <= 0 && summary.profitFactor < 0.9) {
    recommendation = "exclude";
    recommendationReason = "Negative net PnL with weak profit factor";
  }

  return {
    tradeCount: trades.length,
    averagePnlUsdt,
    bestTradePnlUsdt,
    worstTradePnlUsdt,
    exitReasons,
    recommendation,
    recommendationReason
  };
}

function summarizeTrades(symbol: string, candles: number, trades: BacktestTrade[]): BacktestSymbolResult {
  const pnl = trades.map((trade) => trade.pnlUsdt);
  const wins = pnl.filter((value) => value > 0);
  const losses = pnl.filter((value) => value < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const value of pnl) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const summary = {
    symbol,
    candles,
    trades,
    netPnlUsdt: pnl.reduce((sum, value) => sum + value, 0),
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    maxDrawdownUsdt: maxDrawdown,
    profitFactor: profitFactorFromValues(wins, losses)
  };
  return { ...summary, diagnostics: summarizeSymbolDiagnostics(trades, summary) };
}

function profitFactorFromValues(wins: number[], losses: number[]): number {
  if (losses.length > 0) {
    return wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0));
  }
  return wins.length > 0 ? 999 : 0;
}

function classify(fast: number, slow: number, price: number): "bullish" | "neutral" | "bearish" {
  if (fast > slow && price > slow) {
    return "bullish";
  }
  if (fast < slow && price < slow) {
    return "bearish";
  }
  return "neutral";
}

function syntheticVolumeProfile(rows: ParsedKline[], price: number, vwap: number): CryptoMarketAnalysis["volumeProfile"] {
  const low = Math.min(...rows.map((row) => row.low));
  const high = Math.max(...rows.map((row) => row.high));
  const range = Math.max(high - low, 0.00000001);
  const valueAreaLow = low + range * 0.15;
  const valueAreaHigh = high - range * 0.15;
  const pointOfControl = vwap > 0 ? vwap : price;

  return {
    pointOfControl: { price: pointOfControl, volume: rows.at(-1)?.volume ?? 0, intensity: 1 },
    valueAreaLow,
    valueAreaHigh,
    currentPricePosition: price < valueAreaLow ? "below_value" : price > valueAreaHigh ? "above_value" : "inside_value"
  };
}

function historicalAnalysis(
  symbol: string,
  rows: ParsedKline[],
  higherRows: ParsedKline[],
  strategy: CryptoStrategyConfig,
  longRows: ParsedKline[] = rows
): CryptoMarketAnalysis {
  const current = rows.at(-1)!;
  const price = current.close;
  const closes = rows.map((row) => row.close);
  const higherCloses = higherRows.length > 0 ? higherRows.map((row) => row.close) : closes;
  const emaFast = ema(closes, strategy.emaFastPeriod);
  const emaSlow = ema(closes, strategy.emaSlowPeriod);
  const emaTrend = ema(closes, strategy.emaTrendPeriod);
  const previousFast = ema(closes.slice(0, Math.max(1, closes.length - 3)), strategy.emaFastPeriod) || emaFast;
  const higherFast = ema(higherCloses, strategy.higherEmaFastPeriod);
  const higherSlow = ema(higherCloses, strategy.higherEmaSlowPeriod);
  const trend = classify(emaFast, emaSlow, price);
  const higherTrend = classify(higherFast, higherSlow, higherCloses.at(-1) ?? price);
  const emaFastSlopePct = previousFast > 0 ? ((emaFast - previousFast) / previousFast) * 100 : 0;
  const rsi = computeRsi(closes, strategy.rsiPeriod);
  const atr = computeAtr(rows, strategy.atrPeriod);
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  const vwap = computeVwap(rows);
  const priceVsVwapPct = vwap > 0 ? ((price - vwap) / vwap) * 100 : 0;
  const averageVolume = rows.slice(-40).reduce((sum, row) => sum + row.volume, 0) / Math.max(Math.min(rows.length, 40), 1);
  const bullishVolumeExpansion = current.volume > averageVolume * 1.2 && current.close > current.open;
  const candleDirection = current.close >= current.open ? 1 : -1;
  const high = Math.max(...rows.map((row) => row.high));
  const low = Math.min(...rows.map((row) => row.low));
  const returnLookback = rows.at(-7);
  const recentReturn6Pct = returnLookback && returnLookback.close > 0 ? ((current.close - returnLookback.close) / returnLookback.close) * 100 : 0;
  const candleRange = Math.max(current.high - current.low, 0);
  const closePosition = candleRange > 0 ? (current.close - current.low) / candleRange : 0.5;
  const candleBodyPct = current.open > 0 ? (Math.abs(current.close - current.open) / current.open) * 100 : 0;
  const lowerWickPct = current.open > 0 ? ((Math.min(current.open, current.close) - current.low) / current.open) * 100 : 0;
  const upperWickPct = current.open > 0 ? ((current.high - Math.max(current.open, current.close)) / current.open) * 100 : 0;

  return {
    symbol,
    price,
    vwap,
    priceVsVwapPct,
    volatilityPct: price > 0 ? ((high - low) / price) * 100 : 0,
    trend: {
      emaFast,
      emaSlow,
      emaTrend,
      emaFastSlopePct,
      higherEmaFast: higherFast,
      higherEmaSlow: higherSlow,
      rsi,
      atr,
      atrPct,
      trend,
      higherTrend
    },
    technical: {
      bollinger: computeBollingerBands(closes),
      volatilityChannel: computeVolatilityChannel(rows),
      donchianClose: computeDonchianCloseChannel(longRows),
      donchianCloseByPeriod: computeDonchianCloseChannels(longRows),
      volumeRatio: computeVolumeRatio(rows),
      recentReturn6Pct,
      candleBodyPct,
      closePosition,
      lowerWickPct,
      upperWickPct
    },
    volumeProfile: syntheticVolumeProfile(rows, price, vwap),
    footprint: {
      buyVolume: bullishVolumeExpansion ? current.volume * 0.6 : current.volume * (candleDirection > 0 ? 0.52 : 0.46),
      sellVolume: bullishVolumeExpansion ? current.volume * 0.4 : current.volume * (candleDirection > 0 ? 0.48 : 0.54),
      buySellImbalance: bullishVolumeExpansion ? 0.2 : candleDirection > 0 ? 0.04 : -0.08
    },
    deepTrades: {
      largeTradeCount: bullishVolumeExpansion ? 1 : 0,
      largeTradeBuyRatio: bullishVolumeExpansion ? 0.64 : candleDirection > 0 ? 0.52 : 0.45,
      score: bullishVolumeExpansion ? 0.64 : candleDirection > 0 ? 0.52 : 0.45
    },
    liquidity: {
      bidWallPrice: price * 0.999,
      askWallPrice: price * 1.001,
      bidAskImbalance: candleDirection > 0 ? 0.13 : 0,
      nearestAskDistancePct: 0.05
    },
    reasons: []
  };
}

export function aggregateBacktest(result: Omit<BacktestResult, "totals">): BacktestResult["totals"] {
  const initialCapitalUsdt = result.initialCapitalUsdt;
  const maxOpenPositions = result.maxOpenPositions;
  const sortedByEntry = result.symbols
    .flatMap((symbol) => symbol.trades)
    .sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const acceptedTrades: BacktestTrade[] = [];
  let skippedTrades = 0;

  for (const trade of sortedByEntry) {
    const entryTime = Date.parse(trade.entryTime);
    const openTrades = acceptedTrades.filter((accepted) => Date.parse(accepted.entryTime) <= entryTime && Date.parse(accepted.exitTime) > entryTime);
    const capitalInUse = openTrades.reduce((sum, trade) => sum + trade.entryQuoteQty, 0);
    const requiredCapital = trade.entryQuoteQty;
    if (openTrades.length >= maxOpenPositions || capitalInUse + requiredCapital > initialCapitalUsdt) {
      skippedTrades += 1;
      continue;
    }
    acceptedTrades.push(trade);
  }

  const trades = acceptedTrades;
  const wins = trades.filter((trade) => trade.pnlUsdt > 0);
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxConcurrentPositions = 0;

  for (const trade of trades.sort((a, b) => Date.parse(a.exitTime) - Date.parse(b.exitTime))) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const events = trades.flatMap((trade) => [
    { time: Date.parse(trade.entryTime), delta: 1 },
    { time: Date.parse(trade.exitTime), delta: -1 }
  ]).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let concurrent = 0;
  for (const event of events) {
    concurrent += event.delta;
    maxConcurrentPositions = Math.max(maxConcurrentPositions, concurrent);
  }

  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  let maxCapitalUsedUsdt = 0;
  for (const trade of trades) {
    const entryTime = Date.parse(trade.entryTime);
    const openTrades = trades.filter((candidate) => Date.parse(candidate.entryTime) <= entryTime && Date.parse(candidate.exitTime) > entryTime);
    maxCapitalUsedUsdt = Math.max(maxCapitalUsedUsdt, openTrades.reduce((sum, candidate) => sum + candidate.entryQuoteQty, 0));
  }

  return {
    trades: trades.length,
    netPnlUsdt,
    endingCapitalUsdt: initialCapitalUsdt + netPnlUsdt,
    returnPct: initialCapitalUsdt > 0 ? (netPnlUsdt / initialCapitalUsdt) * 100 : 0,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    maxDrawdownUsdt: maxDrawdown,
    maxDrawdownPct: initialCapitalUsdt > 0 ? (maxDrawdown / initialCapitalUsdt) * 100 : 0,
    profitFactor: profitFactorFromValues(
      wins.map((trade) => trade.pnlUsdt),
      losses.map((trade) => trade.pnlUsdt)
    ),
    maxConcurrentPositions,
    maxCapitalUsedUsdt,
    capitalUtilizationPct: initialCapitalUsdt > 0 ? (maxCapitalUsedUsdt / initialCapitalUsdt) * 100 : 0,
    skippedTrades
  };
}

export async function backtestSymbol(options: {
  client: BinanceClient;
  symbol: string;
  days: number;
  orderQuoteQty: number;
  strategy: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
}): Promise<BacktestSymbolResult> {
  const benchmarkSymbol = "BTCUSDT";
  const [raw5m, raw15m, rawBenchmark5m, rawBenchmark15m] = await Promise.all([
    fetchHistoricalKlines(options.client, options.symbol, "5m", options.days),
    fetchHistoricalKlines(options.client, options.symbol, "15m", options.days),
    options.symbol === benchmarkSymbol
      ? Promise.resolve(undefined)
      : fetchHistoricalKlines(options.client, benchmarkSymbol, "5m", options.days),
    options.symbol === benchmarkSymbol
      ? Promise.resolve(undefined)
      : fetchHistoricalKlines(options.client, benchmarkSymbol, "15m", options.days)
  ]);
  const rows5m = raw5m.map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const rows15m = raw15m.map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const benchmarkRows5m = (rawBenchmark5m ?? raw5m).map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const benchmarkRows15m = (rawBenchmark15m ?? raw15m).map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const trades: BacktestTrade[] = [];
  let position:
    | {
        entryOpenTime: number;
        entryTime: string;
        entryPrice: number;
        quantity: number;
        stopLoss: number;
        initialStopLoss: number;
        takeProfit: number;
        maxHoldingMinutes: number;
        entryFee: number;
        diagnostics: Omit<
          BacktestTrade,
          | "symbol"
          | "entryTime"
          | "exitTime"
          | "entryPrice"
          | "exitPrice"
          | "entryQuoteQty"
          | "quantity"
          | "pnlUsdt"
          | "reason"
        >;
      }
    | undefined;
  let nextEntryOpenTime = 0;

  for (let index = 240; index < rows5m.length; index += 1) {
    const current = rows5m[index];
    const recentRows = rows5m.slice(Math.max(0, index - 239), index + 1);
    const longRecentRows = rows5m.slice(Math.max(0, index - 864), index + 1);
    const higherWindow = rows15m
      .filter((row) => row.openTime <= current.openTime)
      .slice(-200);
    const analysis = historicalAnalysis(options.symbol, recentRows, higherWindow, options.strategy, longRecentRows);
    const benchmarkRecentRows = benchmarkRows5m
      .filter((row) => row.openTime <= current.openTime)
      .slice(-240);
    const benchmarkHigherWindow = benchmarkRows15m
      .filter((row) => row.openTime <= current.openTime)
      .slice(-200);
    if (benchmarkRecentRows.length >= 60 && benchmarkHigherWindow.length >= 20) {
      analysis.marketRegime = assessMarketRegime(historicalAnalysis(benchmarkSymbol, benchmarkRecentRows, benchmarkHigherWindow, options.strategy));
    }
    const signal = (options.signalStrategy ?? emaVwapTrendStrategy).generateSignal({
      analysis,
      orderQuoteQty: options.orderQuoteQty,
      config: options.strategy
    });

    if (position) {
      const profitPct = ((current.close - position.entryPrice) / position.entryPrice) * 100;
      if (profitPct >= options.strategy.breakevenTriggerPct) {
        position.stopLoss = Math.max(position.stopLoss, position.entryPrice * (1 + options.strategy.feeRate * 2));
      }
      if (profitPct >= options.strategy.trailingStopTriggerPct) {
        position.stopLoss = Math.max(position.stopLoss, current.close * (1 - options.strategy.trailingStopGivebackPct / 100));
      }

      let exitPrice = 0;
      let reason: BacktestTrade["reason"] | undefined;
      if (current.low <= position.stopLoss) {
        exitPrice = position.stopLoss;
        reason = position.stopLoss > position.initialStopLoss ? "trailing_stop" : "stop_loss";
      } else if (current.high >= position.takeProfit) {
        exitPrice = position.takeProfit;
        reason = "take_profit";
      } else if (
        position.maxHoldingMinutes > 0 &&
        current.openTime - position.entryOpenTime >= position.maxHoldingMinutes * 60 * 1000
      ) {
        exitPrice = current.close;
        reason = "timeout";
      } else if (signal.score < options.strategy.signalExitScore) {
        exitPrice = current.close;
        reason = "signal_exit";
      }

      if (reason) {
        const exitQuote = exitPrice * position.quantity;
        const exitFee = exitQuote * options.strategy.feeRate;
        trades.push({
          symbol: options.symbol,
          entryTime: position.entryTime,
          exitTime: new Date(current.openTime).toISOString(),
          entryPrice: position.entryPrice,
          exitPrice,
          entryQuoteQty: position.entryPrice * position.quantity,
          quantity: position.quantity,
          pnlUsdt: (exitPrice - position.entryPrice) * position.quantity - position.entryFee - exitFee,
          reason,
          ...position.diagnostics
        });
        position = undefined;
        nextEntryOpenTime = current.openTime + options.strategy.entryCooldownMinutes * 60 * 1000;
      }
      continue;
    }

    if (current.openTime < nextEntryOpenTime) {
      continue;
    }

    if (signal.action === "buy") {
      const entryFee = signal.orderQuoteQty * options.strategy.feeRate;
      position = {
        entryOpenTime: current.openTime,
        entryTime: new Date(current.openTime).toISOString(),
        entryPrice: current.close,
        quantity: signal.orderQuoteQty / current.close,
        stopLoss: signal.stopLoss,
        initialStopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        maxHoldingMinutes: signal.maxHoldingMinutes ?? options.strategy.maxHoldingMinutes,
        entryFee,
        diagnostics: {
          entryScore: signal.score,
          entryRsi: analysis.trend?.rsi,
          entryAtrPct: analysis.trend?.atrPct,
          entryPriceVsVwapPct: analysis.priceVsVwapPct,
          entryEmaFastSlopePct: analysis.trend?.emaFastSlopePct,
          entryHigherTrendGapPct:
            analysis.trend && analysis.trend.higherEmaSlow > 0
              ? ((analysis.trend.higherEmaFast - analysis.trend.higherEmaSlow) / analysis.trend.higherEmaSlow) * 100
              : undefined,
          entryBuySellImbalance: analysis.footprint.buySellImbalance,
          entryLargeTradeBuyRatio: analysis.deepTrades.largeTradeBuyRatio,
          entryValueAreaPosition: analysis.volumeProfile.currentPricePosition
        }
      };
    }
  }

  if (position && rows5m.at(-1)) {
    const last = rows5m.at(-1)!;
    const exitQuote = last.close * position.quantity;
    trades.push({
      symbol: options.symbol,
      entryTime: position.entryTime,
      exitTime: new Date(last.openTime).toISOString(),
      entryPrice: position.entryPrice,
      exitPrice: last.close,
      entryQuoteQty: position.entryPrice * position.quantity,
      quantity: position.quantity,
      pnlUsdt: (last.close - position.entryPrice) * position.quantity - position.entryFee - exitQuote * options.strategy.feeRate,
      reason: "end",
      ...position.diagnostics
    });
  }

  return summarizeTrades(options.symbol, rows5m.length, trades);
}

export async function runBacktest(options: {
  client: BinanceClient;
  symbols: string[];
  days: number;
  initialCapitalUsdt: number;
  maxOpenPositions: number;
  orderQuoteQty: number;
  strategy: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
}): Promise<BacktestResult> {
  const symbols = [];
  for (const symbol of options.symbols) {
    symbols.push(await backtestSymbol({ ...options, symbol }));
  }
  const base = {
    generatedAt: new Date().toISOString(),
    days: options.days,
    initialCapitalUsdt: options.initialCapitalUsdt,
    orderQuoteQty: options.orderQuoteQty,
    maxOpenPositions: options.maxOpenPositions,
    strategy: options.strategy,
    symbols,
    note: "Backtest uses historical klines and synthetic footprint/depth approximations. It excludes live order-book slippage and cannot prove future profitability."
  };
  return { ...base, totals: aggregateBacktest(base) };
}

export async function optimizeBacktest(options: {
  client: BinanceClient;
  symbols: string[];
  days: number;
  initialCapitalUsdt: number;
  maxOpenPositions: number;
  orderQuoteQty: number;
  strategy: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
}): Promise<{ best: BacktestResult; candidates: BacktestResult[] }> {
  const candidates: BacktestResult[] = [];
  const minScores = [62, 66, 70];
  const atrMultipliers = [1.2, 1.6, 2.0];
  const takeProfitMultipliers = [1.2, 1.45, 1.8];

  for (const minBuyScore of minScores) {
    for (const atrStopMultiplier of atrMultipliers) {
      for (const takeProfitRiskMultiple of takeProfitMultipliers) {
        candidates.push(
          await runBacktest({
            ...options,
            strategy: { ...options.strategy, minBuyScore, atrStopMultiplier, takeProfitRiskMultiple }
          })
        );
      }
    }
  }

  const scored = candidates
    .filter((candidate) => candidate.totals.trades >= 2)
    .map((candidate) => ({
      candidate,
      score: candidate.totals.netPnlUsdt - candidate.totals.maxDrawdownUsdt * 0.25
    }));
  const best = (scored.sort((a, b) => b.score - a.score)[0]?.candidate ?? candidates[0]) as BacktestResult;
  return { best, candidates };
}

export function writeBacktestReport(report: unknown, filePath = path.resolve(process.cwd(), "data/backtest-report.json")): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
