import path from "node:path";
import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { TradeEventLog } from "./eventLog";
import { runExitMonitor } from "./exitMonitor";
import { CryptoJournal } from "./journal";

const config = loadCryptoBotConfig();
const journal = new CryptoJournal(path.resolve(process.cwd(), "data/crypto-journal.json"));
const eventLog = new TradeEventLog(path.resolve(process.cwd(), "data/trade-events.json"));
const broker = new BinanceClient({ apiKey: config.apiKey, apiSecret: config.apiSecret, baseUrl: config.baseUrl });

runExitMonitor({ broker, journal, eventLog, riskConfig: config.exitRisk, strategyConfig: config.strategy })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
