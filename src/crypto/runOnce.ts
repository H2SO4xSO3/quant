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

runCryptoCycle({
  broker,
  journal,
  eventLog,
  symbols: config.symbols,
  riskConfig: config.risk,
  strategyConfig: config.strategy,
  signalStrategy,
  aiReviewConfig: config.aiReview,
  backtestGuardConfig: config.backtestGuard
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
