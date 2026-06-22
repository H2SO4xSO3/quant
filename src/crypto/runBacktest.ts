import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadCryptoBotConfig } from "./config";
import { aggregateBacktest, writeBacktestReport, type BacktestResult, type BacktestSymbolResult } from "./backtest";
import { buildBacktestSymbolRunnerArgs } from "./backtestStrategyArgs";
import { TradeEventLog } from "./eventLog";
import { rankBacktestResults } from "./strategyScoring";
import { TREND_BASKET_SYMBOLS } from "./strategies/factorLabelTrendBasket";
import type { CryptoStrategyConfig } from "./types";

const config = loadCryptoBotConfig();
const eventLog = new TradeEventLog(path.resolve(process.cwd(), "data/trade-events.json"));
const days = Number(process.argv[2] ?? 14);
const tsxCmd = path.resolve(process.cwd(), "node_modules/.bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const symbolRunner = path.resolve(process.cwd(), "src/crypto/runBacktestSymbol.ts");

interface CandidateStrategy {
  strategyId: string;
  strategy: CryptoStrategyConfig;
  symbols?: string[];
}

function runSymbolOnce(symbol: string, candidate: CandidateStrategy): BacktestSymbolResult {
  const runnerArgs = buildBacktestSymbolRunnerArgs({ symbolRunner, symbol, days, candidate });
  const command = process.platform === "win32" ? "cmd.exe" : tsxCmd;
  const args = process.platform === "win32" ? ["/c", tsxCmd, ...runnerArgs] : runnerArgs;
  const child = spawnSync(
    command,
    args,
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
      encoding: "utf8",
      timeout: 120_000
    }
  );

  if (child.status !== 0) {
    const details = [
      child.error?.message,
      child.stderr?.trim(),
      child.stdout?.trim(),
      child.signal ? `signal=${child.signal}` : undefined,
      `status=${child.status ?? "unknown"}`
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(`Backtest failed for ${symbol}:\n${details}`);
  }

  const line = child.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) {
    throw new Error(`Backtest for ${symbol} returned no JSON output`);
  }
  return JSON.parse(line) as BacktestSymbolResult;
}

function runSymbol(symbol: string, candidate: CandidateStrategy): BacktestSymbolResult {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return runSymbolOnce(symbol, candidate);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        eventLog.append({
          type: "error",
          symbol,
          message: `Backtest child process failed; retrying attempt ${attempt + 1}/${maxAttempts}`,
          details: { strategyId: candidate.strategyId, error: error instanceof Error ? error.message : String(error) }
        });
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function runPortfolio(candidate: CandidateStrategy): BacktestResult {
  const symbols = (candidate.symbols ?? config.symbols).map((symbol) => runSymbol(symbol, candidate));
  const base = {
    generatedAt: new Date().toISOString(),
    days,
    initialCapitalUsdt: config.backtestInitialCapitalUsdt,
    orderQuoteQty: config.risk.maxOrderUsdt,
    maxOpenPositions: config.risk.maxOpenPositions,
    strategy: candidate.strategy,
    strategyId: candidate.strategyId,
    symbols,
    note: "Backtest uses historical klines and kline-derived confirmations. It excludes live order-book slippage and cannot prove future profitability."
  };
  return { ...base, totals: aggregateBacktest(base) };
}

function candidateStrategies(): CandidateStrategy[] {
  return [
    { strategyId: "ema-vwap-trend", strategy: config.strategy },
    { strategyId: "ema-vwap-trend", strategy: { ...config.strategy, minBuyScore: 80, atrStopMultiplier: 1.8, takeProfitRiskMultiple: 1.8 } },
    { strategyId: "ema-vwap-trend", strategy: { ...config.strategy, minBuyScore: 94, atrStopMultiplier: 2.4, takeProfitRiskMultiple: 2.4 } },
    {
      strategyId: "ema-vwap-quality-breakout",
      strategy: {
        ...config.strategy,
        minBuyScore: 80,
        minPriceVwapPct: 0.4,
        maxPriceVwapPct: 0.9,
        minEmaFastSlopePct: 0.08,
        takeProfitRiskMultiple: 1.8
      }
    },
    {
      strategyId: "bollinger-breakeven",
      strategy: {
        ...config.strategy,
        minBuyScore: 78,
        atrStopMultiplier: 1.1,
        takeProfitRiskMultiple: 1.1,
        minTakeProfitPct: 0.32,
        minExpectedValuePct: 0
      }
    },
    {
      strategyId: "bollinger-breakeven",
      strategy: {
        ...config.strategy,
        minBuyScore: 84,
        atrStopMultiplier: 0.9,
        takeProfitRiskMultiple: 1,
        minTakeProfitPct: 0.24,
        minExpectedValuePct: 0
      }
    },
    {
      strategyId: "aberration-volatility-breakout",
      strategy: {
        ...config.strategy,
        minBuyScore: 78,
        atrStopMultiplier: 1.6,
        takeProfitRiskMultiple: 1.45,
        minPriceVwapPct: 0.08,
        maxPriceVwapPct: 2.4,
        minEmaFastSlopePct: 0.02,
        minTakeProfitPct: 0.35,
        minExpectedValuePct: -0.05
      }
    },
    {
      strategyId: "aberration-volatility-breakout",
      strategy: {
        ...config.strategy,
        minBuyScore: 84,
        atrStopMultiplier: 2,
        takeProfitRiskMultiple: 1.8,
        minPriceVwapPct: 0.12,
        maxPriceVwapPct: 2,
        minEmaFastSlopePct: 0.03,
        minTakeProfitPct: 0.45,
        minExpectedValuePct: 0
      }
    },
    {
      strategyId: "factor-label-capitulation-reclaim",
      strategy: {
        ...config.strategy,
        minBuyScore: 80,
        minTakeProfitPct: 0.3,
        minExpectedValuePct: -0.2,
        maxHoldingMinutes: 120,
        entryCooldownMinutes: 0,
        breakevenTriggerPct: 999,
        trailingStopTriggerPct: 999,
        trailingStopGivebackPct: 999,
        signalExitScore: -1
      }
    },
    {
      strategyId: "factor-label-alt-rebound",
      strategy: {
        ...config.strategy,
        minBuyScore: 80,
        minTakeProfitPct: 0.3,
        minExpectedValuePct: -0.2,
        maxHoldingMinutes: 240,
        entryCooldownMinutes: 0,
        breakevenTriggerPct: 999,
        trailingStopTriggerPct: 999,
        trailingStopGivebackPct: 999,
        signalExitScore: -1
      }
    },
    {
      strategyId: "factor-label-bnb-breakout",
      strategy: {
        ...config.strategy,
        minBuyScore: 80,
        minTakeProfitPct: 0.3,
        minExpectedValuePct: -0.2,
        maxHoldingMinutes: 0,
        entryCooldownMinutes: 0,
        breakevenTriggerPct: 999,
        trailingStopTriggerPct: 999,
        trailingStopGivebackPct: 999,
        signalExitScore: 20
      }
    },
    {
      strategyId: "factor-label-composite",
      strategy: {
        ...config.strategy,
        minBuyScore: 80,
        minTakeProfitPct: 0.3,
        minExpectedValuePct: -0.2,
        maxHoldingMinutes: 0,
        entryCooldownMinutes: 0,
        breakevenTriggerPct: 999,
        trailingStopTriggerPct: 999,
        trailingStopGivebackPct: 999,
        signalExitScore: 20
      }
    },
    {
      strategyId: "factor-label-trend-basket",
      symbols: TREND_BASKET_SYMBOLS,
      strategy: {
        ...config.strategy,
        minBuyScore: 80,
        minTakeProfitPct: 0.3,
        minExpectedValuePct: -0.2,
        maxHoldingMinutes: 0,
        entryCooldownMinutes: 0,
        breakevenTriggerPct: 999,
        trailingStopTriggerPct: 999,
        trailingStopGivebackPct: 999,
        signalExitScore: 20
      }
    }
  ];
}

function symbolIsHealthy(symbol: BacktestSymbolResult): boolean {
  return (
    symbol.trades.length >= config.backtestGuard.minSymbolTrades &&
    symbol.netPnlUsdt > config.backtestGuard.minSymbolNetPnlUsdt &&
    symbol.profitFactor >= config.backtestGuard.minSymbolProfitFactor
  );
}

function guardedPortfolio(result: BacktestResult): BacktestResult {
  const symbols = result.symbols.filter(symbolIsHealthy);
  const base = {
    ...result,
    symbols,
    note: `${result.note} Guarded portfolio includes only symbols passing per-symbol backtest health thresholds.`
  };
  return { ...base, totals: aggregateBacktest(base) };
}

try {
  const current = runPortfolio({ strategyId: config.strategyId, strategy: config.strategy });
  const candidates = candidateStrategies().map((candidate) => runPortfolio(candidate));
  const rankedCandidates = rankBacktestResults(candidates);
  const best = rankedCandidates[0];
  const guarded = guardedPortfolio(current);
  const report = { current, guarded, optimized: { best, candidates: rankedCandidates } };
  writeBacktestReport(report);
  eventLog.append({
    type: "backtest",
    message: `Backtest ${days}d complete: current return=${current.totals.returnPct.toFixed(3)}%; guarded return=${guarded.totals.returnPct.toFixed(3)}%; best trades=${best.totals.trades}, pnl=${best.totals.netPnlUsdt.toFixed(4)}U`,
    details: { current: current.totals, guarded: guarded.totals, guardedSymbols: guarded.symbols.map((symbol) => symbol.symbol), best: best.totals, bestStrategy: best.strategy }
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  eventLog.append({ type: "error", message: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exit(1);
}
