import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { TradeEventLog } from "./eventLog";
import { CryptoJournal } from "./journal";
import { createPaperAggressiveStrategy } from "./paperAggressive";
import { resolvePaperEventLogPath, resolvePaperJournalPath, resolvePaperStrategyId } from "./paperPaths";
import { runPaperCycle } from "./paperTrading";
import { getStrategyById } from "./strategyRegistry";

const config = loadCryptoBotConfig();
const journal = new CryptoJournal(resolvePaperJournalPath());
const eventLog = new TradeEventLog(resolvePaperEventLogPath());
const broker = new BinanceClient({ baseUrl: config.baseUrl });
const baseSignalStrategy = getStrategyById(resolvePaperStrategyId(config.strategyId));
const signalStrategy =
  process.env.PAPER_AGGRESSIVE === "true"
    ? createPaperAggressiveStrategy(baseSignalStrategy, { minScore: Number(process.env.PAPER_AGGRESSIVE_MIN_SCORE ?? config.strategy.minBuyScore) })
    : baseSignalStrategy;

runPaperCycle({
  broker,
  journal,
  eventLog,
  symbols: config.symbols,
  strategyConfig: config.strategy,
  signalStrategy,
  initialCapitalUsdt: config.backtestInitialCapitalUsdt,
  orderQuoteQty: config.risk.maxOrderUsdt,
  maxOpenPositions: config.risk.maxOpenPositions
})
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
