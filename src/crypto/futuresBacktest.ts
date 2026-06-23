import { fetchHistoricalKlines, historicalAnalysis } from "./backtest";
import type { BinanceClient } from "./binanceClient";
import { estimateFuturesLiquidationPrice, type FuturesDirection, type FuturesPaperConfig } from "./futuresPaper";
import { parseKline } from "./indicators";
import { assessMarketRegime } from "./marketRegime";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emaVwapTrendStrategy } from "./strategy";
import type { CryptoStrategy } from "./strategyTypes";
import type { BinanceKline, CryptoSignal, CryptoStrategyConfig, ParsedKline } from "./types";

export type FuturesBacktestExitReason = "liquidation" | "stop_loss" | "take_profit" | "signal_exit" | "timeout" | "end";

export interface FuturesBacktestTrade {
  symbol: string;
  direction: FuturesDirection;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  marginUsdt: number;
  notionalUsdt: number;
  quantity: number;
  liquidationPrice: number;
  grossPnlUsdt: number;
  costUsdt: number;
  pnlUsdt: number;
  reason: FuturesBacktestExitReason;
  entryScore: number;
}

export interface FuturesBacktestSymbolResult {
  symbol: string;
  candles: number;
  trades: FuturesBacktestTrade[];
  netPnlUsdt: number;
  winRate: number;
  maxDrawdownUsdt: number;
  profitFactor: number;
  exitReasons: Record<FuturesBacktestExitReason, number>;
}

export interface FuturesBacktestResult {
  generatedAt: string;
  days: number;
  strategyId?: string;
  initialCapitalUsdt: number;
  marginUsdt: number;
  maxOpenPositions: number;
  futuresConfig: FuturesPaperConfig;
  strategy: CryptoStrategyConfig;
  symbols: FuturesBacktestSymbolResult[];
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
    maxMarginUsedUsdt: number;
    marginUtilizationPct: number;
    skippedTrades: number;
  };
  note: string;
}

interface OpenFuturesBacktestPosition {
  direction: FuturesDirection;
  entryOpenTime: number;
  entryTime: string;
  entryPrice: number;
  marginUsdt: number;
  notionalUsdt: number;
  quantity: number;
  liquidationPrice: number;
  stopLoss: number;
  takeProfit: number;
  maxHoldingMinutes: number;
  entryScore: number;
}

function profitFactor(wins: number[], losses: number[]): number {
  if (losses.length > 0) {
    return wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0));
  }
  return wins.length > 0 ? 999 : 0;
}

function estimateFuturesCostsUsdt(entryNotional: number, exitNotional: number, config: FuturesPaperConfig): number {
  const feeCost = entryNotional * config.feeRate + exitNotional * config.feeRate;
  const entryFrictionCost = entryNotional * ((config.estimatedSlippagePct + config.priceImpactPct) / 100);
  return feeCost + entryFrictionCost;
}

function calculatePnl(
  position: OpenFuturesBacktestPosition,
  exitPrice: number,
  futuresConfig: FuturesPaperConfig,
  reason: FuturesBacktestExitReason
): Pick<FuturesBacktestTrade, "grossPnlUsdt" | "costUsdt" | "pnlUsdt"> {
  const exitNotional = exitPrice * position.quantity;
  const grossPnlUsdt =
    position.direction === "long"
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
  const costUsdt = estimateFuturesCostsUsdt(position.notionalUsdt, exitNotional, futuresConfig);
  const pnlUsdt = reason === "liquidation" ? -position.marginUsdt : Math.max(grossPnlUsdt - costUsdt, -position.marginUsdt);
  return { grossPnlUsdt, costUsdt, pnlUsdt };
}

function summarizeSymbol(symbol: string, candles: number, trades: FuturesBacktestTrade[]): FuturesBacktestSymbolResult {
  const pnls = trades.map((trade) => trade.pnlUsdt);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  const exitReasons: Record<FuturesBacktestExitReason, number> = {
    liquidation: 0,
    stop_loss: 0,
    take_profit: 0,
    signal_exit: 0,
    timeout: 0,
    end: 0
  };

  for (const trade of trades) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
    exitReasons[trade.reason] += 1;
  }

  return {
    symbol,
    candles,
    trades,
    netPnlUsdt: pnls.reduce((sum, value) => sum + value, 0),
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    maxDrawdownUsdt,
    profitFactor: profitFactor(wins, losses),
    exitReasons
  };
}

function exitFor(position: OpenFuturesBacktestPosition, current: ParsedKline, signal: CryptoSignal, strategy: CryptoStrategyConfig) {
  if (position.direction === "long") {
    if (current.low <= position.liquidationPrice) {
      return { reason: "liquidation" as const, price: position.liquidationPrice };
    }
    if (current.low <= position.stopLoss) {
      return { reason: "stop_loss" as const, price: position.stopLoss };
    }
    if (current.high >= position.takeProfit) {
      return { reason: "take_profit" as const, price: position.takeProfit };
    }
  } else {
    if (current.high >= position.liquidationPrice) {
      return { reason: "liquidation" as const, price: position.liquidationPrice };
    }
    if (current.high >= position.stopLoss) {
      return { reason: "stop_loss" as const, price: position.stopLoss };
    }
    if (current.low <= position.takeProfit) {
      return { reason: "take_profit" as const, price: position.takeProfit };
    }
  }

  if (position.maxHoldingMinutes > 0 && current.openTime - position.entryOpenTime >= position.maxHoldingMinutes * 60 * 1000) {
    return { reason: "timeout" as const, price: current.close };
  }
  if (signal.score < strategy.signalExitScore || signal.reasons.some((reason) => reason.startsWith("Exit invalidation:"))) {
    return { reason: "signal_exit" as const, price: current.close };
  }
  return undefined;
}

function toTrade(
  symbol: string,
  position: OpenFuturesBacktestPosition,
  current: ParsedKline,
  exitPrice: number,
  reason: FuturesBacktestExitReason,
  futuresConfig: FuturesPaperConfig
): FuturesBacktestTrade {
  return {
    symbol,
    direction: position.direction,
    entryTime: position.entryTime,
    exitTime: new Date(current.openTime).toISOString(),
    entryPrice: position.entryPrice,
    exitPrice,
    marginUsdt: position.marginUsdt,
    notionalUsdt: position.notionalUsdt,
    quantity: position.quantity,
    liquidationPrice: position.liquidationPrice,
    reason,
    entryScore: position.entryScore,
    ...calculatePnl(position, exitPrice, futuresConfig, reason)
  };
}

export function backtestFuturesSymbolFromRows(options: {
  symbol: string;
  raw5m: BinanceKline[];
  raw15m: BinanceKline[];
  rawBenchmark5m?: BinanceKline[];
  rawBenchmark15m?: BinanceKline[];
  marginUsdt: number;
  strategyConfig: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
  futuresConfig: FuturesPaperConfig;
}): FuturesBacktestSymbolResult {
  const rows5m = options.raw5m.map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const rows15m = options.raw15m.map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const benchmarkRows5m = (options.rawBenchmark5m ?? options.raw5m).map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const benchmarkRows15m = (options.rawBenchmark15m ?? options.raw15m).map(parseKline).filter((row) => row.close > 0 && row.volume > 0);
  const signalStrategy = options.signalStrategy ?? emaVwapTrendStrategy;
  const trades: FuturesBacktestTrade[] = [];
  let position: OpenFuturesBacktestPosition | undefined;
  let nextEntryOpenTime = 0;

  for (let index = 240; index < rows5m.length; index += 1) {
    const current = rows5m[index];
    const recentRows = rows5m.slice(Math.max(0, index - 239), index + 1);
    const longRecentRows = rows5m.slice(Math.max(0, index - 864), index + 1);
    const higherWindow = rows15m.filter((row) => row.openTime <= current.openTime).slice(-200);
    const analysis = historicalAnalysis(options.symbol, recentRows, higherWindow, options.strategyConfig, longRecentRows);
    const benchmarkRecentRows = benchmarkRows5m.filter((row) => row.openTime <= current.openTime).slice(-240);
    const benchmarkHigherWindow = benchmarkRows15m.filter((row) => row.openTime <= current.openTime).slice(-200);
    if (benchmarkRecentRows.length >= 60 && benchmarkHigherWindow.length >= 20) {
      analysis.marketRegime = assessMarketRegime(historicalAnalysis("BTCUSDT", benchmarkRecentRows, benchmarkHigherWindow, options.strategyConfig));
    }
    const signal = signalStrategy.generateSignal({ analysis, orderQuoteQty: options.marginUsdt, config: options.strategyConfig });

    if (position) {
      const exit = exitFor(position, current, signal, options.strategyConfig);
      if (exit) {
        trades.push(toTrade(options.symbol, position, current, exit.price, exit.reason, options.futuresConfig));
        position = undefined;
        nextEntryOpenTime = current.openTime + options.strategyConfig.entryCooldownMinutes * 60 * 1000;
      }
      continue;
    }

    if (current.openTime < nextEntryOpenTime || (signal.action !== "buy" && signal.action !== "sell")) {
      continue;
    }

    const direction: FuturesDirection = signal.action === "buy" ? "long" : "short";
    const entryPrice = signal.entryPrice;
    const notionalUsdt = signal.orderQuoteQty * options.futuresConfig.leverage;
    position = {
      direction,
      entryOpenTime: current.openTime,
      entryTime: new Date(current.openTime).toISOString(),
      entryPrice,
      marginUsdt: signal.orderQuoteQty,
      notionalUsdt,
      quantity: notionalUsdt / entryPrice,
      liquidationPrice: estimateFuturesLiquidationPrice(direction, entryPrice, options.futuresConfig.leverage, options.futuresConfig.maintenanceMarginRate),
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      maxHoldingMinutes: signal.maxHoldingMinutes ?? options.strategyConfig.maxHoldingMinutes,
      entryScore: signal.score
    };
  }

  const last = rows5m.at(-1);
  if (position && last) {
    trades.push(toTrade(options.symbol, position, last, last.close, "end", options.futuresConfig));
  }

  return summarizeSymbol(options.symbol, rows5m.length, trades);
}

export function aggregateFuturesBacktest(result: Omit<FuturesBacktestResult, "totals">): FuturesBacktestResult["totals"] {
  const sorted = result.symbols
    .flatMap((symbol) => symbol.trades)
    .sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const accepted: FuturesBacktestTrade[] = [];
  let skippedTrades = 0;

  for (const trade of sorted) {
    const entryTime = Date.parse(trade.entryTime);
    const openTrades = accepted.filter((candidate) => Date.parse(candidate.entryTime) <= entryTime && Date.parse(candidate.exitTime) > entryTime);
    const marginInUse = openTrades.reduce((sum, candidate) => sum + candidate.marginUsdt, 0);
    if (openTrades.length >= result.maxOpenPositions || marginInUse + trade.marginUsdt > result.initialCapitalUsdt) {
      skippedTrades += 1;
      continue;
    }
    accepted.push(trade);
  }

  const wins = accepted.filter((trade) => trade.pnlUsdt > 0);
  const losses = accepted.filter((trade) => trade.pnlUsdt < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  let maxConcurrentPositions = 0;
  let maxMarginUsedUsdt = 0;

  for (const trade of [...accepted].sort((a, b) => Date.parse(a.exitTime) - Date.parse(b.exitTime))) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
  }

  const events = accepted
    .flatMap((trade) => [
      { time: Date.parse(trade.entryTime), delta: 1 },
      { time: Date.parse(trade.exitTime), delta: -1 }
    ])
    .sort((a, b) => a.time - b.time || a.delta - b.delta);
  let concurrent = 0;
  for (const event of events) {
    concurrent += event.delta;
    maxConcurrentPositions = Math.max(maxConcurrentPositions, concurrent);
  }
  for (const trade of accepted) {
    const entryTime = Date.parse(trade.entryTime);
    const openTrades = accepted.filter((candidate) => Date.parse(candidate.entryTime) <= entryTime && Date.parse(candidate.exitTime) > entryTime);
    maxMarginUsedUsdt = Math.max(maxMarginUsedUsdt, openTrades.reduce((sum, candidate) => sum + candidate.marginUsdt, 0));
  }

  const netPnlUsdt = accepted.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  return {
    trades: accepted.length,
    netPnlUsdt,
    endingCapitalUsdt: result.initialCapitalUsdt + netPnlUsdt,
    returnPct: result.initialCapitalUsdt > 0 ? (netPnlUsdt / result.initialCapitalUsdt) * 100 : 0,
    winRate: accepted.length > 0 ? wins.length / accepted.length : 0,
    maxDrawdownUsdt,
    maxDrawdownPct: result.initialCapitalUsdt > 0 ? (maxDrawdownUsdt / result.initialCapitalUsdt) * 100 : 0,
    profitFactor: profitFactor(
      wins.map((trade) => trade.pnlUsdt),
      losses.map((trade) => trade.pnlUsdt)
    ),
    maxConcurrentPositions,
    maxMarginUsedUsdt,
    marginUtilizationPct: result.initialCapitalUsdt > 0 ? (maxMarginUsedUsdt / result.initialCapitalUsdt) * 100 : 0,
    skippedTrades
  };
}

export async function backtestFuturesSymbol(options: {
  client: BinanceClient;
  symbol: string;
  days: number;
  marginUsdt: number;
  strategyConfig: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
  futuresConfig: FuturesPaperConfig;
}): Promise<FuturesBacktestSymbolResult> {
  const benchmarkSymbol = "BTCUSDT";
  const [raw5m, raw15m, rawBenchmark5m, rawBenchmark15m] = await Promise.all([
    fetchHistoricalKlines(options.client, options.symbol, "5m", options.days),
    fetchHistoricalKlines(options.client, options.symbol, "15m", options.days),
    options.symbol === benchmarkSymbol ? Promise.resolve(undefined) : fetchHistoricalKlines(options.client, benchmarkSymbol, "5m", options.days),
    options.symbol === benchmarkSymbol ? Promise.resolve(undefined) : fetchHistoricalKlines(options.client, benchmarkSymbol, "15m", options.days)
  ]);
  return backtestFuturesSymbolFromRows({
    symbol: options.symbol,
    raw5m,
    raw15m,
    rawBenchmark5m,
    rawBenchmark15m,
    marginUsdt: options.marginUsdt,
    strategyConfig: options.strategyConfig,
    signalStrategy: options.signalStrategy,
    futuresConfig: options.futuresConfig
  });
}

export async function runFuturesBacktest(options: {
  client: BinanceClient;
  symbols: string[];
  days: number;
  initialCapitalUsdt: number;
  marginUsdt: number;
  maxOpenPositions: number;
  strategyConfig: CryptoStrategyConfig;
  strategyId?: string;
  signalStrategy?: CryptoStrategy;
  futuresConfig: FuturesPaperConfig;
}): Promise<FuturesBacktestResult> {
  const symbols: FuturesBacktestSymbolResult[] = [];
  for (const symbol of options.symbols) {
    symbols.push(
      await backtestFuturesSymbol({
        client: options.client,
        symbol,
        days: options.days,
        marginUsdt: options.marginUsdt,
        strategyConfig: options.strategyConfig,
        signalStrategy: options.signalStrategy,
        futuresConfig: options.futuresConfig
      })
    );
  }

  const base = {
    generatedAt: new Date().toISOString(),
    days: options.days,
    strategyId: options.strategyId,
    initialCapitalUsdt: options.initialCapitalUsdt,
    marginUsdt: options.marginUsdt,
    maxOpenPositions: options.maxOpenPositions,
    futuresConfig: options.futuresConfig,
    strategy: options.strategyConfig,
    symbols,
    note: "Futures backtest supports long and short paper-style execution with leverage, fees, slippage, price impact, liquidation, stop loss, take profit, timeout, and signal exits. Historical kline analysis remains synthetic and cannot prove future profitability."
  };
  return { ...base, totals: aggregateFuturesBacktest(base) };
}

export function writeFuturesBacktestReport(
  report: unknown,
  filePath = path.resolve(process.cwd(), "data/futures-backtest-report.json")
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
