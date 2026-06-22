import { formatChanStructureLabel } from "./chanStructure";
import { analyzeMarket } from "./indicators";
import type { CryptoBroker } from "./engine";
import type { TradeEventLog } from "./eventLog";
import type { CryptoJournal } from "./journal";
import { DEFAULT_STRATEGY_CONFIG, emaVwapTrendStrategy } from "./strategy";
import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoJournalEntry, CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "./types";

export type FuturesDirection = "long" | "short";

export interface FuturesPaperConfig {
  leverage: number;
  feeRate: number;
  estimatedSlippagePct: number;
  priceImpactPct: number;
  maintenanceMarginRate: number;
}

export interface FuturesPaperCycleOptions {
  broker: Pick<CryptoBroker, "fetchMarket" | "fetchTickerPrice">;
  journal: CryptoJournal;
  symbols: string[];
  strategyConfig?: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
  eventLog?: TradeEventLog;
  futuresConfig: FuturesPaperConfig;
  initialCapitalUsdt: number;
  marginUsdt: number;
  maxOpenPositions: number;
}

export interface FuturesPaperAccountSummary {
  initialCapitalUsdt: number;
  cashUsdt: number;
  realizedPnlUsdt: number;
  openMarginUsdt: number;
  openNotionalUsdt: number;
  openPositions: number;
  equityAtMarginUsdt: number;
  returnPct: number;
}

export interface FuturesPaperCycleResult {
  timestamp: string;
  opened: CryptoJournalEntry[];
  closed: CryptoJournalEntry[];
  scanned: CryptoSignal[];
  account: FuturesPaperAccountSummary;
}

function futuresEntries(journal: CryptoJournal): CryptoJournalEntry[] {
  return journal.read().entries.filter((entry) => entry.mode === "futures_paper");
}

export function estimateFuturesLiquidationPrice(
  direction: FuturesDirection,
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number
): number {
  const marginPct = 1 / leverage;
  return direction === "long"
    ? entryPrice * (1 - marginPct + maintenanceMarginRate)
    : entryPrice * (1 + marginPct - maintenanceMarginRate);
}

function estimateFuturesCostsUsdt(entryNotional: number, exitNotional: number, config: FuturesPaperConfig): number {
  const feeCost = entryNotional * config.feeRate + exitNotional * config.feeRate;
  const entryFrictionCost = entryNotional * ((config.estimatedSlippagePct + config.priceImpactPct) / 100);
  return feeCost + entryFrictionCost;
}

export function summarizeFuturesPaperAccount(journal: CryptoJournal, initialCapitalUsdt: number): FuturesPaperAccountSummary {
  const entries = futuresEntries(journal);
  const closed = entries.filter((entry) => !entry.open && ((entry.direction ?? "long") === "long" ? entry.side === "SELL" : entry.side === "BUY"));
  const realizedPnlUsdt = closed.reduce((sum, entry) => sum + (entry.realizedPnlUsdt ?? 0), 0);
  const openEntries = entries.filter((entry) => entry.open);
  const openMarginUsdt = openEntries.reduce((sum, entry) => sum + (entry.marginUsdt ?? entry.quoteQty ?? 0), 0);
  const openNotionalUsdt = openEntries.reduce((sum, entry) => sum + (entry.notionalUsdt ?? 0), 0);
  const cashUsdt = initialCapitalUsdt + realizedPnlUsdt - openMarginUsdt;
  const equityAtMarginUsdt = initialCapitalUsdt + realizedPnlUsdt;

  return {
    initialCapitalUsdt,
    cashUsdt,
    realizedPnlUsdt,
    openMarginUsdt,
    openNotionalUsdt,
    openPositions: openEntries.length,
    equityAtMarginUsdt,
    returnPct: initialCapitalUsdt > 0 ? ((equityAtMarginUsdt - initialCapitalUsdt) / initialCapitalUsdt) * 100 : 0
  };
}

function openPositionKey(entry: CryptoJournalEntry): string {
  return `${entry.symbol}:${entry.direction ?? "long"}`;
}

function closeReason(entry: CryptoJournalEntry, signal: CryptoSignal, price: number, strategyConfig: CryptoStrategyConfig, now = Date.now()): string | undefined {
  const direction = entry.direction ?? "long";
  if (entry.liquidationPrice !== undefined && (direction === "long" ? price <= entry.liquidationPrice : price >= entry.liquidationPrice)) {
    return "liquidation";
  }
  if (entry.stopLoss !== undefined && (direction === "long" ? price <= entry.stopLoss : price >= entry.stopLoss)) {
    return "stop_loss";
  }
  if (entry.takeProfit !== undefined && (direction === "long" ? price >= entry.takeProfit : price <= entry.takeProfit)) {
    return "take_profit";
  }
  if (signal.score < strategyConfig.signalExitScore || signal.reasons.some((reason) => reason.startsWith("Exit invalidation:"))) {
    return "signal_exit";
  }
  const maxHoldingMinutes = signal.maxHoldingMinutes ?? strategyConfig.maxHoldingMinutes;
  const entryTime = Date.parse(entry.timestamp);
  if (maxHoldingMinutes > 0 && Number.isFinite(entryTime) && now - entryTime >= maxHoldingMinutes * 60 * 1000) {
    return "timeout";
  }
  return undefined;
}

function withChanEntryNote(signal: CryptoSignal, analysis: CryptoMarketAnalysis): string[] {
  const chan = analysis.technical?.chan;
  return chan ? [...signal.reasons, formatChanStructureLabel(chan)] : signal.reasons;
}

function realizedFuturesPnl(entry: CryptoJournalEntry, exitPrice: number, config: FuturesPaperConfig, reason: string): { grossPnlUsdt: number; costUsdt: number; netPnlUsdt: number; exitNotionalUsdt: number } {
  const quantity = entry.quantity ?? 0;
  const entryPrice = entry.price ?? exitPrice;
  const entryNotional = entry.notionalUsdt ?? entryPrice * quantity;
  const exitNotional = exitPrice * quantity;
  const grossPnlUsdt = (entry.direction ?? "long") === "long" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
  const costUsdt = estimateFuturesCostsUsdt(entryNotional, exitNotional, config);
  const marginUsdt = entry.marginUsdt ?? entry.quoteQty ?? 0;
  const netPnlUsdt = reason === "liquidation" ? -marginUsdt : Math.max(grossPnlUsdt - costUsdt, -marginUsdt);

  return { grossPnlUsdt, costUsdt, netPnlUsdt, exitNotionalUsdt: exitNotional };
}

export async function runFuturesPaperCycle(options: FuturesPaperCycleOptions): Promise<FuturesPaperCycleResult> {
  const timestamp = new Date().toISOString();
  const strategyConfig = options.strategyConfig ?? DEFAULT_STRATEGY_CONFIG;
  const signalStrategy = options.signalStrategy ?? emaVwapTrendStrategy;
  const opened: CryptoJournalEntry[] = [];
  const closed: CryptoJournalEntry[] = [];
  const scanned: CryptoSignal[] = [];

  for (const symbol of options.symbols) {
    const bundle = await options.broker.fetchMarket(symbol);
    const analysis = analyzeMarket({ symbol, ...bundle, strategyConfig });
    const signal = signalStrategy.generateSignal({ analysis, orderQuoteQty: options.marginUsdt, config: strategyConfig });
    scanned.push(signal);

    const entries = futuresEntries(options.journal);
    const existing = entries.find((entry) => entry.symbol === symbol && entry.open);
    if (existing) {
      const currentPrice = await options.broker.fetchTickerPrice(symbol);
      const reason = closeReason(existing, signal, currentPrice, strategyConfig);
      if (reason && existing.id) {
        const pnl = realizedFuturesPnl(existing, currentPrice, options.futuresConfig, reason);
        options.journal.update(existing.id, (entry) => ({ ...entry, open: false, realizedPnlUsdt: pnl.netPnlUsdt }));
        const closeEntry = options.journal.append({
          symbol,
          side: (existing.direction ?? "long") === "long" ? "SELL" : "BUY",
          direction: existing.direction,
          leverage: existing.leverage,
          price: currentPrice,
          quantity: existing.quantity,
          quoteQty: pnl.exitNotionalUsdt,
          marginUsdt: existing.marginUsdt,
          notionalUsdt: pnl.exitNotionalUsdt,
          liquidationPrice: existing.liquidationPrice,
          realizedPnlUsdt: pnl.netPnlUsdt,
          open: false,
          timestamp,
          mode: "futures_paper",
          notes: [
            reason === "liquidation" ? "Futures paper liquidation exit" : `Futures paper ${reason} exit`,
            `Futures ${existing.direction ?? "long"} ${existing.leverage}x`,
            `Estimated futures costs ${pnl.costUsdt.toFixed(6)}U`,
            `Gross futures PnL ${pnl.grossPnlUsdt.toFixed(6)}U`,
            ...signal.reasons
          ]
        });
        closed.push(closeEntry);
        options.eventLog?.append({
          timestamp,
          type: (existing.direction ?? "long") === "long" ? "sell" : "buy",
          symbol,
          price: currentPrice,
          quantity: existing.quantity,
          quoteQty: pnl.exitNotionalUsdt,
          realizedPnlUsdt: pnl.netPnlUsdt,
          message: `FUTURES PAPER ${existing.direction} CLOSE ${symbol} ${reason}`,
          details: pnl
        });
      }
      continue;
    }

    if (signal.action !== "buy" && signal.action !== "sell") {
      options.eventLog?.append({
        timestamp,
        type: "scan",
        symbol,
        score: signal.score,
        price: signal.entryPrice,
        quoteQty: signal.orderQuoteQty,
        message: `FUTURES PAPER ${symbol} ${signal.action} score=${signal.score.toFixed(1)}`
      });
      continue;
    }

    const direction: FuturesDirection = signal.action === "buy" ? "long" : "short";
    const account = summarizeFuturesPaperAccount(options.journal, options.initialCapitalUsdt);
    const openKeys = new Set(futuresEntries(options.journal).filter((entry) => entry.open).map(openPositionKey));
    const marginUsdt = signal.orderQuoteQty;
    const notionalUsdt = marginUsdt * options.futuresConfig.leverage;
    if (account.openPositions >= options.maxOpenPositions || account.cashUsdt < marginUsdt || openKeys.has(`${symbol}:${direction}`)) {
      options.eventLog?.append({
        timestamp,
        type: "risk_block",
        symbol,
        score: signal.score,
        price: signal.entryPrice,
        quoteQty: marginUsdt,
        message: "FUTURES PAPER skipped by virtual account limits"
      });
      continue;
    }

    const quantity = notionalUsdt / signal.entryPrice;
    const liquidationPrice = estimateFuturesLiquidationPrice(direction, signal.entryPrice, options.futuresConfig.leverage, options.futuresConfig.maintenanceMarginRate);
    const openEntry = options.journal.append({
      symbol,
      side: direction === "long" ? "BUY" : "SELL",
      direction,
      leverage: options.futuresConfig.leverage,
      price: signal.entryPrice,
      quantity,
      quoteQty: marginUsdt,
      marginUsdt,
      notionalUsdt,
      liquidationPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      realizedPnlUsdt: 0,
      open: true,
      timestamp,
      mode: "futures_paper",
      notes: [`Futures ${direction} ${options.futuresConfig.leverage}x`, ...withChanEntryNote(signal, analysis)]
    });
    opened.push(openEntry);
    options.eventLog?.append({
      timestamp,
      type: direction === "long" ? "buy" : "sell",
      symbol,
      score: signal.score,
      price: signal.entryPrice,
      quantity,
      quoteQty: notionalUsdt,
      message: `FUTURES PAPER ${direction.toUpperCase()} ${symbol} ${options.futuresConfig.leverage}x score=${signal.score.toFixed(1)}`
    });
  }

  return {
    timestamp,
    opened,
    closed,
    scanned,
    account: summarizeFuturesPaperAccount(options.journal, options.initialCapitalUsdt)
  };
}
