import express from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BinanceClient } from "./crypto/binanceClient";
import { loadCryptoBotConfig } from "./crypto/config";
import { runCryptoCycle } from "./crypto/engine";
import { TradeEventLog } from "./crypto/eventLog";
import { runExitMonitor } from "./crypto/exitMonitor";
import { CryptoJournal } from "./crypto/journal";
import { getStrategyById } from "./crypto/strategyRegistry";
import { PublicPolymarketClient } from "./polymarket_collector/client";
import { loadPolymarketCollectorConfig } from "./polymarket_collector/config";
import { PolymarketCollector } from "./polymarket_collector/collector";
import { JsonlPolymarketStore } from "./polymarket_collector/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.resolve(rootDir, "public");
const config = loadCryptoBotConfig();
const journal = new CryptoJournal(path.resolve(rootDir, "data/crypto-journal.json"));
const eventLog = new TradeEventLog(path.resolve(rootDir, "data/trade-events.json"));
const broker = new BinanceClient({ apiKey: config.apiKey, apiSecret: config.apiSecret, baseUrl: config.baseUrl });
const signalStrategy = getStrategyById(config.strategyId);
const polymarketConfig = loadPolymarketCollectorConfig(undefined, { cwd: rootDir });
const polymarketCollector = new PolymarketCollector({
  config: polymarketConfig,
  client: new PublicPolymarketClient(polymarketConfig),
  store: new JsonlPolymarketStore(polymarketConfig.dataDir)
});
const app = express();

let buyTimer: NodeJS.Timeout | undefined;
let exitTimer: NodeJS.Timeout | undefined;
let polymarketTimer: NodeJS.Timeout | undefined;
let buyBusy = false;
let exitBusy = false;
let polymarketBusy = false;
let latestBuyResult: unknown;
let latestExitResult: unknown;
let latestPolymarketResult: unknown;

app.use(express.json());

function readBacktestReport() {
  const filePath = path.resolve(rootDir, "data/backtest-report.json");
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const report = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      current: report.current
        ? {
            generatedAt: report.current.generatedAt,
            days: report.current.days,
            strategyId: report.current.strategyId,
            initialCapitalUsdt: report.current.initialCapitalUsdt,
            orderQuoteQty: report.current.orderQuoteQty,
            maxOpenPositions: report.current.maxOpenPositions,
            strategy: report.current.strategy,
            totals: report.current.totals,
            symbols: report.current.symbols?.map((symbol: { symbol: string; candles: number; trades: unknown[]; netPnlUsdt: number; winRate: number; maxDrawdownUsdt: number; profitFactor: number }) => ({
              symbol: symbol.symbol,
              candles: symbol.candles,
              trades: symbol.trades.length,
              netPnlUsdt: symbol.netPnlUsdt,
              winRate: symbol.winRate,
              maxDrawdownUsdt: symbol.maxDrawdownUsdt,
              profitFactor: symbol.profitFactor
            }))
          }
        : undefined,
      optimized: report.optimized
        ? {
            best: {
              generatedAt: report.optimized.best.generatedAt,
              days: report.optimized.best.days,
              strategyId: report.optimized.best.strategyId,
              initialCapitalUsdt: report.optimized.best.initialCapitalUsdt,
              orderQuoteQty: report.optimized.best.orderQuoteQty,
              maxOpenPositions: report.optimized.best.maxOpenPositions,
              strategy: report.optimized.best.strategy,
              totals: report.optimized.best.totals
            },
            candidates: report.optimized.candidates?.map((candidate: { strategy: unknown; totals: unknown }) => ({
              strategy: candidate.strategy,
              totals: candidate.totals
            }))
          }
        : undefined
      ,
      guarded: report.guarded
        ? {
            generatedAt: report.guarded.generatedAt,
            days: report.guarded.days,
            strategyId: report.guarded.strategyId,
            initialCapitalUsdt: report.guarded.initialCapitalUsdt,
            orderQuoteQty: report.guarded.orderQuoteQty,
            maxOpenPositions: report.guarded.maxOpenPositions,
            strategy: report.guarded.strategy,
            totals: report.guarded.totals,
            symbols: report.guarded.symbols?.map((symbol: { symbol: string; candles: number; trades: unknown[]; netPnlUsdt: number; winRate: number; maxDrawdownUsdt: number; profitFactor: number }) => ({
              symbol: symbol.symbol,
              candles: symbol.candles,
              trades: symbol.trades.length,
              netPnlUsdt: symbol.netPnlUsdt,
              winRate: symbol.winRate,
              maxDrawdownUsdt: symbol.maxDrawdownUsdt,
              profitFactor: symbol.profitFactor
            }))
          }
        : undefined
    };
  } catch {
    return undefined;
  }
}

function state() {
  const entries = journal.read().entries;
  const events = eventLog.read().events;
  return {
    generatedAt: new Date().toISOString(),
    config: {
      symbols: config.symbols,
      strategyId: signalStrategy.id,
      liveTrading: config.risk.liveTrading,
      exitLiveTrading: config.exitRisk.liveTrading,
      maxOrderUsdt: config.risk.maxOrderUsdt,
      dailyMaxLossUsdt: config.risk.dailyMaxLossUsdt,
      backtestInitialCapitalUsdt: config.backtestInitialCapitalUsdt,
      maxPositionLossUsdt: config.risk.maxPositionLossUsdt,
      maxOpenPositions: config.risk.maxOpenPositions,
      pollMs: config.pollMs,
      exitPollMs: config.exitPollMs,
      minBuyScore: config.strategy.minBuyScore,
      strategy: config.strategy,
      aiReview: {
        enabled: config.aiReview.enabled,
        configured: Boolean(config.aiReview.apiKey),
        model: config.aiReview.model
      },
      backtestGuard: {
        enabled: config.backtestGuard.enabled,
        minNetPnlUsdt: config.backtestGuard.minNetPnlUsdt,
        minProfitFactor: config.backtestGuard.minProfitFactor,
        minTrades: config.backtestGuard.minTrades,
        maxAgeHours: config.backtestGuard.maxAgeHours
      },
      autoStartBuyLoop: config.autoStartBuyLoop,
      autoStartExitGuardian: config.autoStartExitGuardian,
      polymarket: {
        enabled: polymarketConfig.enabled,
        symbols: polymarketConfig.symbols,
        timeframes: polymarketConfig.timeframes,
        pollIntervalSeconds: polymarketConfig.pollIntervalSeconds,
        saveOrderbook: polymarketConfig.saveOrderbook,
        saveTrades: polymarketConfig.saveTrades,
        dataDir: polymarketConfig.dataDir
      },
      credentialsConfigured: Boolean(config.apiKey && config.apiSecret)
    },
    loops: {
      buyRunning: Boolean(buyTimer),
      exitRunning: Boolean(exitTimer),
      polymarketRunning: Boolean(polymarketTimer),
      buyBusy,
      exitBusy,
      polymarketBusy
    },
    openPositions: entries.filter((entry) => entry.open && entry.side === "BUY"),
    entries: entries.slice(0, 60),
    events: events.slice(0, 120),
    latestBuyResult,
    latestExitResult,
    latestPolymarketResult,
    backtest: readBacktestReport()
  };
}

async function runBuyOnce() {
  if (buyBusy) {
    return latestBuyResult;
  }
  buyBusy = true;
  try {
    latestBuyResult = await runCryptoCycle({
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
    return latestBuyResult;
  } catch (error) {
    eventLog.append({ type: "error", message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    buyBusy = false;
  }
}

async function runExitOnce() {
  if (exitBusy) {
    return latestExitResult;
  }
  exitBusy = true;
  try {
    latestExitResult = await runExitMonitor({ broker, journal, eventLog, riskConfig: config.exitRisk, strategyConfig: config.strategy });
    return latestExitResult;
  } catch (error) {
    eventLog.append({ type: "error", message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    exitBusy = false;
  }
}

function startBuyLoop() {
  if (!buyTimer) {
    void runBuyOnce();
    buyTimer = setInterval(() => void runBuyOnce(), Math.max(10_000, config.pollMs));
    eventLog.append({ type: "system", message: `Buy scan loop started (${config.pollMs}ms)` });
  }
}

function stopBuyLoop() {
  if (buyTimer) {
    clearInterval(buyTimer);
    buyTimer = undefined;
    eventLog.append({ type: "system", message: "Buy scan loop stopped" });
  }
}

function startExitLoop() {
  if (!exitTimer) {
    void runExitOnce();
    exitTimer = setInterval(() => void runExitOnce(), Math.max(5_000, config.exitPollMs));
    eventLog.append({ type: "system", message: `Exit guardian started (${config.exitPollMs}ms)` });
  }
}

function stopExitLoop() {
  if (exitTimer) {
    clearInterval(exitTimer);
    exitTimer = undefined;
    eventLog.append({ type: "system", message: "Exit guardian stopped" });
  }
}

async function runPolymarketOnce() {
  if (polymarketBusy) {
    return latestPolymarketResult;
  }
  polymarketBusy = true;
  try {
    latestPolymarketResult = await polymarketCollector.collectOnce();
    return latestPolymarketResult;
  } catch (error) {
    console.warn(`Polymarket collector failed: ${error instanceof Error ? error.message : String(error)}`);
    return latestPolymarketResult;
  } finally {
    polymarketBusy = false;
  }
}

function startPolymarketLoop() {
  if (!polymarketTimer) {
    void runPolymarketOnce();
    polymarketTimer = setInterval(() => void runPolymarketOnce(), Math.max(5_000, polymarketConfig.pollIntervalSeconds * 1000));
    eventLog.append({ type: "system", message: `Polymarket collector started (${polymarketConfig.pollIntervalSeconds}s)` });
  }
}

app.get("/api/status", (_request, response) => {
  response.json(state());
});

app.post("/api/scan-once", async (_request, response) => {
  response.json(await runBuyOnce());
});

app.post("/api/exit-once", async (_request, response) => {
  response.json(await runExitOnce());
});

app.post("/api/buy-loop/start", (_request, response) => {
  startBuyLoop();
  response.json(state());
});

app.post("/api/buy-loop/stop", (_request, response) => {
  stopBuyLoop();
  response.json(state());
});

app.post("/api/exit-loop/start", (_request, response) => {
  startExitLoop();
  response.json(state());
});

app.post("/api/exit-loop/stop", (_request, response) => {
  stopExitLoop();
  response.json(state());
});

app.use(express.static(publicDir));

app.use((_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

if (config.autoStartBuyLoop) {
  startBuyLoop();
}

if (config.autoStartExitGuardian) {
  startExitLoop();
}

if (polymarketConfig.enabled) {
  startPolymarketLoop();
}

app.listen(config.dashboardPort, "127.0.0.1", () => {
  console.log(`Binance quant dashboard listening on http://127.0.0.1:${config.dashboardPort}`);
});
