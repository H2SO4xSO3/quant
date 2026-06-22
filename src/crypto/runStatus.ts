import path from "node:path";
import { loadCryptoBotConfig } from "./config";
import { TradeEventLog } from "./eventLog";
import { CryptoJournal } from "./journal";

const config = loadCryptoBotConfig();
const journal = new CryptoJournal(path.resolve(process.cwd(), "data/crypto-journal.json"));
const eventLog = new TradeEventLog(path.resolve(process.cwd(), "data/trade-events.json"));
const entries = journal.read().entries;
const events = eventLog.read().events;
const openEntries = entries.filter((entry) => entry.side === "BUY" && entry.open);

console.log("Binance Spot Quant Bot");
console.log(`symbols: ${config.symbols.join(", ")}`);
console.log(`new-buy live trading: ${config.risk.liveTrading ? "ON" : "OFF"}`);
console.log(`exit live trading: ${config.exitRisk.liveTrading ? "ON" : "OFF"}`);
console.log(`max order USDT: ${config.risk.maxOrderUsdt}`);
console.log(`backtest initial capital USDT: ${config.backtestInitialCapitalUsdt}`);
console.log(`max per-position loss USDT: ${config.risk.maxPositionLossUsdt}`);
console.log(`max open positions: ${config.risk.maxOpenPositions}`);
console.log(`buy poll ms: ${config.pollMs}`);
console.log(`exit poll ms: ${config.exitPollMs}`);
console.log(`min buy score: ${config.strategy.minBuyScore}`);
console.log(`entry cooldown minutes: ${config.strategy.entryCooldownMinutes}`);
console.log(
  `protective stops: breakeven ${config.strategy.breakevenTriggerPct}%, trailing ${config.strategy.trailingStopTriggerPct}%/${config.strategy.trailingStopGivebackPct}%`
);
console.log(`AI review: ${config.aiReview.enabled ? `ON (${config.aiReview.model})` : "OFF"}`);
console.log(`AI key configured: ${config.aiReview.apiKey ? "yes" : "no"}`);
console.log(
  `backtest guard: ${config.backtestGuard.enabled ? "ON" : "OFF"} (portfolio minPnL>${config.backtestGuard.minNetPnlUsdt}U, PF>=${config.backtestGuard.minProfitFactor}; symbol guard=${config.backtestGuard.requireSymbolHealth ? "ON" : "OFF"})`
);
console.log(`credentials configured: ${config.apiKey && config.apiSecret ? "yes" : "no"}`);
console.log(`open positions: ${openEntries.length}`);

for (const entry of openEntries) {
  console.log(
    [
      `- ${entry.symbol}`,
      `qty=${entry.quantity ?? "unknown"}`,
      `entry=${entry.price ?? "unknown"}`,
      `stop=${entry.stopLoss ?? "unknown"}`,
      `take=${entry.takeProfit ?? "unknown"}`,
      `time=${entry.timestamp}`
    ].join(" ")
  );
}

if (events.length > 0) {
  console.log("latest events:");
  for (const event of events.slice(0, 5)) {
    console.log(`- ${event.timestamp} ${event.type} ${event.symbol ?? "-"} ${event.message}`);
  }
}
