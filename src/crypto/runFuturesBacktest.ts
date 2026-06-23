import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { runFuturesBacktest, writeFuturesBacktestReport } from "./futuresBacktest";
import type { FuturesPaperConfig } from "./futuresPaper";
import { getStrategyById } from "./strategyRegistry";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = loadCryptoBotConfig();
const days = Number(process.argv[2] ?? 14);
const strategyId = process.argv[3] ?? process.env.FUTURES_BACKTEST_STRATEGY_ID ?? "futures-opportunity-50x";
const outputPath = process.env.FUTURES_BACKTEST_REPORT_PATH ?? "data/futures-backtest-report.json";
const futuresConfig: FuturesPaperConfig = {
  leverage: numberFromEnv("FUTURES_PAPER_LEVERAGE", 50),
  feeRate: numberFromEnv("FUTURES_FEE_RATE", 0.0004),
  estimatedSlippagePct: numberFromEnv("FUTURES_ESTIMATED_SLIPPAGE_PCT", config.strategy.estimatedSlippagePct),
  priceImpactPct: numberFromEnv("FUTURES_PRICE_IMPACT_PCT", config.strategy.priceImpactPct),
  maintenanceMarginRate: numberFromEnv("FUTURES_MAINTENANCE_MARGIN_RATE", 0.005)
};

runFuturesBacktest({
  client: new BinanceClient({ baseUrl: config.baseUrl }),
  symbols: config.symbols,
  days,
  initialCapitalUsdt: config.backtestInitialCapitalUsdt,
  marginUsdt: numberFromEnv("FUTURES_PAPER_MARGIN_USDT", 20),
  maxOpenPositions: numberFromEnv("FUTURES_PAPER_MAX_OPEN_POSITIONS", 5),
  strategyConfig: config.strategy,
  strategyId,
  signalStrategy: getStrategyById(strategyId),
  futuresConfig
})
  .then((report) => {
    writeFuturesBacktestReport(report, outputPath);
    console.log(JSON.stringify(report, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
