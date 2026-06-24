import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { TradeEventLog } from "./eventLog";
import { runFuturesPaperCycle, type FuturesPaperConfig } from "./futuresPaper";
import { wrapStrategyWithFuturesSignalLabelGate } from "./futuresSignalLabelGate";
import { CryptoJournal } from "./journal";
import { getStrategyById } from "./strategyRegistry";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = loadCryptoBotConfig();
const strategyId = process.env.FUTURES_PAPER_STRATEGY_ID ?? config.strategyId;
const journalPath = process.env.FUTURES_PAPER_JOURNAL_PATH ?? "data/futures-paper-journal.json";
const eventPath = process.env.FUTURES_PAPER_EVENTS_PATH ?? "data/futures-paper-events.json";
const labelGateEnabled = process.env.FUTURES_LABEL_GATE_ENABLED !== "false";
const labelGateReportPath = process.env.FUTURES_LABEL_GATE_REPORT_PATH ?? "data/futures-signal-label-research-30d.json";
const futuresConfig: FuturesPaperConfig = {
  leverage: numberFromEnv("FUTURES_PAPER_LEVERAGE", 20),
  feeRate: numberFromEnv("FUTURES_FEE_RATE", 0.0004),
  estimatedSlippagePct: numberFromEnv("FUTURES_ESTIMATED_SLIPPAGE_PCT", config.strategy.estimatedSlippagePct),
  priceImpactPct: numberFromEnv("FUTURES_PRICE_IMPACT_PCT", config.strategy.priceImpactPct),
  maintenanceMarginRate: numberFromEnv("FUTURES_MAINTENANCE_MARGIN_RATE", 0.005)
};

const broker = new BinanceClient({ baseUrl: config.baseUrl });
const journal = new CryptoJournal(journalPath);
const eventLog = new TradeEventLog(eventPath);
const signalStrategy = wrapStrategyWithFuturesSignalLabelGate(getStrategyById(strategyId), {
  enabled: labelGateEnabled,
  reportPath: labelGateReportPath,
  minTrades: numberFromEnv("FUTURES_LABEL_GATE_MIN_TRADES", 30),
  minNetPnlPct: numberFromEnv("FUTURES_LABEL_GATE_MIN_NET_PNL_PCT", 0),
  minProfitFactor: numberFromEnv("FUTURES_LABEL_GATE_MIN_PROFIT_FACTOR", 1),
  maxAgeHours: numberFromEnv("FUTURES_LABEL_GATE_MAX_AGE_HOURS", 72)
});

runFuturesPaperCycle({
  broker,
  journal,
  eventLog,
  symbols: config.symbols,
  strategyConfig: config.strategy,
  signalStrategy,
  futuresConfig,
  initialCapitalUsdt: config.backtestInitialCapitalUsdt,
  marginUsdt: numberFromEnv("FUTURES_PAPER_MARGIN_USDT", config.risk.maxOrderUsdt),
  maxOpenPositions: numberFromEnv("FUTURES_PAPER_MAX_OPEN_POSITIONS", config.risk.maxOpenPositions)
})
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
