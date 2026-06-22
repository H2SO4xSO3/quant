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
const intervalMs = Math.max(5_000, Math.min(config.exitPollMs, 60_000));

async function tick() {
  const result = await runExitMonitor({ broker, journal, eventLog, riskConfig: config.exitRisk, strategyConfig: config.strategy });
  const price = result.currentPrice ? ` price=${result.currentPrice}` : "";
  const count = result.results ? ` checked=${result.results.length} executedCount=${result.executedCount ?? 0}` : "";
  console.log(`[${result.timestamp}] exit-monitor ${result.action}${result.trigger ? ` ${result.trigger}` : ""}${price} executed=${result.executed}${count} ${result.reason}`);
}

void tick();
setInterval(() => void tick().catch((error) => console.error(error)), intervalMs);
