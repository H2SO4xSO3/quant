import { formatChanStructureLabel } from "./chanStructure";
import { analyzeMarket } from "./indicators";
import type { CryptoBroker } from "./engine";
import type { TradeEventLog } from "./eventLog";
import type { CryptoJournal } from "./journal";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import { emaVwapTrendStrategy } from "./strategy";
import { trendGapPct } from "./tradeMath";
import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoJournalEntry, CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "./types";

export interface PaperCycleOptions {
  broker: Pick<CryptoBroker, "fetchMarket" | "fetchTickerPrice">;
  journal: CryptoJournal;
  symbols: string[];
  strategyConfig?: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
  eventLog?: TradeEventLog;
  initialCapitalUsdt: number;
  orderQuoteQty: number;
  maxOpenPositions: number;
}

export interface PaperCycleResult {
  timestamp: string;
  opened: CryptoJournalEntry[];
  closed: CryptoJournalEntry[];
  scanned: CryptoSignal[];
  account: PaperAccountSummary;
}

export interface PaperAccountSummary {
  initialCapitalUsdt: number;
  cashUsdt: number;
  realizedPnlUsdt: number;
  openPositionCostUsdt: number;
  openPositions: number;
  equityUsdt: number;
  returnPct: number;
}


function entryDiagnostics(input: {
  signal: CryptoSignal;
  analysis: CryptoMarketAnalysis;
  strategyId: string;
  config: CryptoStrategyConfig;
  timestamp: string;
}): Partial<CryptoJournalEntry> {
  return {
    entryTime: input.timestamp,
    entryPrice: input.signal.entryPrice,
    strategyId: input.strategyId,
    entryReason: input.signal.reasons.join("; "),
    rsiAtEntry: input.analysis.trend?.rsi,
    priceVsVwapPctAtEntry: input.analysis.priceVsVwapPct,
    emaFastSlopeAtEntry: input.analysis.trend?.emaFastSlopePct,
    higherTrendGapPctAtEntry: input.analysis.trend ? trendGapPct(input.analysis.trend) : undefined,
    spreadPctAtEntry: input.analysis.liquidity.nearestAskDistancePct,
    estimatedSlippagePct: input.config.estimatedSlippagePct,
    btcTrendAtEntry: input.analysis.marketRegime?.trend ?? "unavailable",
    maxFavorableExcursionPct: 0,
    maxAdverseExcursionPct: 0
  };
}

function excursionDiagnostics(entry: CryptoJournalEntry, price: number): Pick<CryptoJournalEntry, "maxFavorableExcursionPct" | "maxAdverseExcursionPct"> {
  const entryPrice = entry.entryPrice ?? entry.price ?? price;
  const movePct = entryPrice > 0 ? ((price - entryPrice) / entryPrice) * 100 : 0;
  return {
    maxFavorableExcursionPct: Math.max(entry.maxFavorableExcursionPct ?? 0, movePct),
    maxAdverseExcursionPct: Math.min(entry.maxAdverseExcursionPct ?? 0, movePct)
  };
}

function exitDiagnostics(input: {
  entry: CryptoJournalEntry;
  exitPrice: number;
  exitQuote: number;
  realizedPnlUsdt: number;
  reason: NonNullable<CryptoJournalEntry["exitType"]>;
  timestamp: string;
}): Partial<CryptoJournalEntry> {
  const entryTimeMs = Date.parse(input.entry.entryTime ?? input.entry.timestamp);
  const exitTimeMs = Date.parse(input.timestamp);
  const entryQuote = input.entry.quoteQty ?? 0;
  return {
    entryTime: input.entry.entryTime ?? input.entry.timestamp,
    entryPrice: input.entry.entryPrice ?? input.entry.price,
    exitTime: input.timestamp,
    exitPrice: input.exitPrice,
    pnlUsdt: input.realizedPnlUsdt,
    pnlPct: entryQuote > 0 ? (input.realizedPnlUsdt / entryQuote) * 100 : 0,
    holdingMinutes: Number.isFinite(entryTimeMs) && Number.isFinite(exitTimeMs) ? (exitTimeMs - entryTimeMs) / 60_000 : undefined,
    entryReason: input.entry.entryReason ?? input.entry.notes?.join("; "),
    exitReason: input.reason,
    exitType: input.reason,
    strategyId: input.entry.strategyId,
    rsiAtEntry: input.entry.rsiAtEntry,
    priceVsVwapPctAtEntry: input.entry.priceVsVwapPctAtEntry,
    emaFastSlopeAtEntry: input.entry.emaFastSlopeAtEntry,
    higherTrendGapPctAtEntry: input.entry.higherTrendGapPctAtEntry,
    spreadPctAtEntry: input.entry.spreadPctAtEntry,
    estimatedSlippagePct: input.entry.estimatedSlippagePct,
    btcTrendAtEntry: input.entry.btcTrendAtEntry,
    ...excursionDiagnostics(input.entry, input.exitPrice)
  };
}
function paperEntries(journal: CryptoJournal): CryptoJournalEntry[] {
  return journal.read().entries.filter((entry) => entry.mode === "paper");
}

export function summarizePaperAccount(journal: CryptoJournal, initialCapitalUsdt: number): PaperAccountSummary {
  const entries = paperEntries(journal);
  const realizedPnlUsdt = entries
    .filter((entry) => entry.side === "SELL")
    .reduce((sum, entry) => sum + entry.realizedPnlUsdt, 0);
  const openBuys = entries.filter((entry) => entry.side === "BUY" && entry.open);
  const openPositionCostUsdt = openBuys.reduce((sum, entry) => sum + (entry.quoteQty ?? 0), 0);
  const cashUsdt = initialCapitalUsdt + realizedPnlUsdt - openPositionCostUsdt;
  const equityUsdt = cashUsdt + openPositionCostUsdt;

  return {
    initialCapitalUsdt,
    cashUsdt,
    realizedPnlUsdt,
    openPositionCostUsdt,
    openPositions: openBuys.length,
    equityUsdt,
    returnPct: initialCapitalUsdt > 0 ? ((equityUsdt - initialCapitalUsdt) / initialCapitalUsdt) * 100 : 0
  };
}

function estimateRoundTripCostUsdt(entryQuote: number, exitQuote: number, config: CryptoStrategyConfig): number {
  const feeCost = entryQuote * config.feeRate + exitQuote * config.feeRate;
  const frictionCost = entryQuote * ((config.estimatedSlippagePct + config.priceImpactPct) / 100);
  return feeCost + frictionCost;
}

function elapsedHoldingMinutes(entry: CryptoJournalEntry, now: number): number | undefined {
  const entryTime = Date.parse(entry.timestamp);
  return Number.isFinite(entryTime) ? (now - entryTime) / 60_000 : undefined;
}

function shouldDeferTimeoutExit(entry: CryptoJournalEntry, price: number, config: CryptoStrategyConfig, maxHoldingMinutes: number, now: number): boolean {
  const quantity = entry.quantity ?? 0;
  const entryPrice = entry.price ?? price;
  const entryQuote = entry.quoteQty ?? entryPrice * quantity;
  const exitQuote = price * quantity;
  const grossPnlUsdt = (price - entryPrice) * quantity;
  const realizedPnlUsdt = grossPnlUsdt - estimateRoundTripCostUsdt(entryQuote, exitQuote, config);
  const holdingMinutes = elapsedHoldingMinutes(entry, now);

  return holdingMinutes !== undefined && holdingMinutes < maxHoldingMinutes * 2 && grossPnlUsdt > 0 && realizedPnlUsdt < 0;
}

function closeReason(entry: CryptoJournalEntry, signal: CryptoSignal, price: number, config: CryptoStrategyConfig, now = Date.now()) {
  if (entry.stopLoss && price <= entry.stopLoss) {
    return "stop_loss";
  }
  if (entry.takeProfit && price >= entry.takeProfit) {
    return "take_profit";
  }
  if (signal.score < config.signalExitScore || signal.reasons.some((reason) => reason.startsWith("Exit invalidation:"))) {
    return "signal_exit";
  }
  const maxHoldingMinutes = signal.maxHoldingMinutes ?? config.maxHoldingMinutes;
  const entryTime = Date.parse(entry.timestamp);
  if (maxHoldingMinutes > 0 && Number.isFinite(entryTime) && now - entryTime >= maxHoldingMinutes * 60 * 1000) {
    if (shouldDeferTimeoutExit(entry, price, config, maxHoldingMinutes, now)) {
      return undefined;
    }
    return "timeout";
  }
  return undefined;
}

function openSymbols(entries: CryptoJournalEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.mode === "paper" && entry.side === "BUY" && entry.open).map((entry) => entry.symbol));
}
function withChanEntryNote(signal: CryptoSignal, analysis: CryptoMarketAnalysis): string[] {
  const chan = analysis.technical?.chan;
  return chan ? [...signal.reasons, formatChanStructureLabel(chan)] : signal.reasons;
}

export async function runPaperCycle(options: PaperCycleOptions): Promise<PaperCycleResult> {
  const timestamp = new Date().toISOString();
  const strategyConfig = options.strategyConfig ?? DEFAULT_STRATEGY_CONFIG;
  const signalStrategy = options.signalStrategy ?? emaVwapTrendStrategy;
  const opened: CryptoJournalEntry[] = [];
  const closed: CryptoJournalEntry[] = [];
  const scanned: CryptoSignal[] = [];

  for (const symbol of options.symbols) {
    const bundle = await options.broker.fetchMarket(symbol);
    const analysis = analyzeMarket({ symbol, ...bundle, strategyConfig });
    const signal = signalStrategy.generateSignal({ analysis, orderQuoteQty: options.orderQuoteQty, config: strategyConfig });
    scanned.push(signal);

    const entries = paperEntries(options.journal);
    const existing = entries.find((entry) => entry.symbol === symbol && entry.side === "BUY" && entry.open);
    if (existing) {
      const currentPrice = await options.broker.fetchTickerPrice(symbol);
      const reason = closeReason(existing, signal, currentPrice, strategyConfig);
      if (existing.id) {
        const excursions = excursionDiagnostics(existing, currentPrice);
        options.journal.update(existing.id, (entry) => ({ ...entry, ...excursions }));
        Object.assign(existing, excursions);
      }
      if (reason && existing.id) {
        const quantity = existing.quantity ?? 0;
        const entryPrice = existing.price ?? currentPrice;
        const entryQuote = existing.quoteQty ?? entryPrice * quantity;
        const exitQuote = currentPrice * quantity;
        const grossPnlUsdt = (currentPrice - entryPrice) * quantity;
        const estimatedCostUsdt = estimateRoundTripCostUsdt(entryQuote, exitQuote, strategyConfig);
        const realizedPnlUsdt = grossPnlUsdt - estimatedCostUsdt;
        const diagnostics = exitDiagnostics({ entry: existing, exitPrice: currentPrice, exitQuote, realizedPnlUsdt, reason, timestamp });
        options.journal.update(existing.id, (entry) => ({ ...entry, ...diagnostics, open: false, realizedPnlUsdt }));
        const sell = options.journal.append({
          symbol,
          side: "SELL",
          price: currentPrice,
          quantity,
          quoteQty: exitQuote,
          realizedPnlUsdt,
          open: false,
          timestamp,
          mode: "paper",
          notes: [`Paper ${reason} exit`, `Estimated paper costs ${estimatedCostUsdt.toFixed(6)}U`, ...signal.reasons],
          ...diagnostics
        });
        closed.push(sell);
        options.eventLog?.append({
          timestamp,
          type: "sell",
          symbol,
          price: currentPrice,
          quantity,
          quoteQty: exitQuote,
          realizedPnlUsdt,
          message: `PAPER SELL ${symbol} ${reason}`,
          details: { grossPnlUsdt, estimatedCostUsdt }
        });
      }
      continue;
    }

    if (signal.action !== "buy") {
      options.eventLog?.append({
        timestamp,
        type: "scan",
        symbol,
        score: signal.score,
        price: signal.entryPrice,
        quoteQty: signal.orderQuoteQty,
        message: `PAPER ${symbol} ${signal.action} score=${signal.score.toFixed(1)}`
      });
      continue;
    }

    const account = summarizePaperAccount(options.journal, options.initialCapitalUsdt);
    const symbolsWithOpenPositions = openSymbols(paperEntries(options.journal));
    if (
      account.openPositions >= options.maxOpenPositions ||
      account.cashUsdt < signal.orderQuoteQty ||
      symbolsWithOpenPositions.has(symbol)
    ) {
      options.eventLog?.append({
        timestamp,
        type: "risk_block",
        symbol,
        score: signal.score,
        price: signal.entryPrice,
        quoteQty: signal.orderQuoteQty,
        message: "PAPER buy skipped by virtual account limits"
      });
      continue;
    }

    const quantity = signal.orderQuoteQty / signal.entryPrice;
    const buy = options.journal.append({
      symbol,
      side: "BUY",
      price: signal.entryPrice,
      quantity,
      quoteQty: signal.orderQuoteQty,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      realizedPnlUsdt: 0,
      open: true,
      timestamp,
      mode: "paper",
      notes: withChanEntryNote(signal, analysis),
      ...entryDiagnostics({
        signal,
        analysis,
        strategyId: signalStrategy.id,
        config: strategyConfig,
        timestamp
      })
    });
    opened.push(buy);
    options.eventLog?.append({
      timestamp,
      type: "buy",
      symbol,
      score: signal.score,
      price: signal.entryPrice,
      quantity,
      quoteQty: signal.orderQuoteQty,
      message: `PAPER BUY ${symbol} score=${signal.score.toFixed(1)}`
    });
  }

  return {
    timestamp,
    opened,
    closed,
    scanned,
    account: summarizePaperAccount(options.journal, options.initialCapitalUsdt)
  };
}


