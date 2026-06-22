import path from "node:path";
import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { runCryptoCycle } from "./engine";
import { TradeEventLog } from "./eventLog";
import { CryptoJournal } from "./journal";
import { getStrategyById } from "./strategyRegistry";

const config = loadCryptoBotConfig();
const journal = new CryptoJournal(path.resolve(process.cwd(), "data/crypto-journal.json"));
const eventLog = new TradeEventLog(path.resolve(process.cwd(), "data/trade-events.json"));
const broker = new BinanceClient({ apiKey: config.apiKey, apiSecret: config.apiSecret, baseUrl: config.baseUrl });
const signalStrategy = getStrategyById(config.strategyId);

async function tick() {
  const result = await runCryptoCycle({
    broker,
    journal,
    eventLog,
    symbols: config.symbols,
    riskConfig: config.risk,
    strategyConfig: config.strategy,
    signalStrategy,
    aiReviewConfig: config.aiReview,
    backtestGuardConfig: config.backtestGuard
  });
  const batch = result.decisions.length > 1 ? ` batch=${result.decisions.length} executedCount=${result.executedCount}` : "";
  console.log(`[${result.timestamp}] ${result.signal.symbol} ${result.signal.action} score=${result.signal.score.toFixed(1)} mode=${result.risk.mode} executed=${result.executed}${batch}`);
  if (result.risk.reasons.length > 0) {
    console.log(`risk: ${result.risk.reasons.join("; ")}`);
  }
}

void tick();
setInterval(() => void tick().catch((error) => console.error(error)), config.pollMs);
