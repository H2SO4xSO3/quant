import { analyzeMarket } from "./indicators";
import { reviewSignalWithAi } from "./aiReview";
import { evaluateBacktestGuard } from "./backtestGuard";
import { roundOrderToRules } from "./filters";
import { evaluateRisk } from "./risk";
import { DEFAULT_STRATEGY_CONFIG, emaVwapTrendStrategy } from "./strategy";
import type { CryptoMarketBundle } from "./binanceClient";
import type { TradeEventLog } from "./eventLog";
import type { CryptoJournal } from "./journal";
import type { CryptoStrategy } from "./strategyTypes";
import type { AiReviewConfig, AiTradeReview, BacktestGuardConfig, CryptoJournalEntry, CryptoRiskConfig, CryptoRiskDecision, CryptoSignal, CryptoStrategyConfig, NormalizedOrder, SymbolRules } from "./types";

export interface CryptoBroker {
  fetchMarket(symbol: string): Promise<CryptoMarketBundle>;
  fetchTickerPrice(symbol: string): Promise<number>;
  getRules(symbol: string): Promise<SymbolRules>;
  testMarketOrder(order: NormalizedOrder): Promise<unknown>;
  placeMarketOrder(order: NormalizedOrder): Promise<unknown>;
}

export interface CryptoCycleOptions {
  broker: CryptoBroker;
  journal: CryptoJournal;
  symbols: string[];
  riskConfig: CryptoRiskConfig;
  strategyConfig?: CryptoStrategyConfig;
  signalStrategy?: CryptoStrategy;
  aiReviewConfig?: AiReviewConfig;
  backtestGuardConfig?: BacktestGuardConfig;
  aiReviewer?: (config: AiReviewConfig, signal: CryptoSignal) => Promise<AiTradeReview>;
  eventLog?: TradeEventLog;
}

export interface CryptoCycleResult {
  timestamp: string;
  signal: CryptoSignal;
  risk: CryptoRiskDecision;
  executed: boolean;
  order?: NormalizedOrder;
  exchangeResponse?: unknown;
  decisions: CryptoCycleDecision[];
  executedCount: number;
}

export interface CryptoCycleDecision {
  timestamp: string;
  signal: CryptoSignal;
  risk: CryptoRiskDecision;
  executed: boolean;
  order?: NormalizedOrder;
  exchangeResponse?: unknown;
}

function applyEntryCooldown(signal: CryptoSignal, entries: CryptoJournalEntry[], cooldownMinutes = 0, minBuyScore = DEFAULT_STRATEGY_CONFIG.minBuyScore, now = Date.now()): CryptoSignal {
  if (signal.action !== "buy" || cooldownMinutes <= 0) {
    return signal;
  }
  const latestSameSymbol = entries
    .filter((entry) => entry.symbol === signal.symbol && (entry.side === "BUY" || entry.side === "SELL"))
    .map((entry) => Date.parse(entry.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  if (!latestSameSymbol) {
    return signal;
  }

  const elapsedMinutes = (now - latestSameSymbol) / 60_000;
  if (elapsedMinutes >= cooldownMinutes) {
    return signal;
  }

  return {
    ...signal,
    action: "hold",
    reasons: [
      ...signal.reasons,
      `${signal.symbol} is still in the ${cooldownMinutes}m entry cooldown (${elapsedMinutes.toFixed(0)}m elapsed)`
    ]
  };
}

async function applyAiReview(
  signal: CryptoSignal,
  config: AiReviewConfig | undefined,
  reviewer: ((config: AiReviewConfig, signal: CryptoSignal) => Promise<AiTradeReview>) | undefined,
  minBuyScore = DEFAULT_STRATEGY_CONFIG.minBuyScore
): Promise<CryptoSignal> {
  if (signal.action !== "buy" || !config?.enabled) {
    return signal;
  }

  try {
    const review = await (reviewer ?? reviewSignalWithAi)(config, signal);
    if (review.decision === "approve") {
      return { ...signal, aiReview: review, reasons: [...signal.reasons, `AI review approved: ${review.reason}`] };
    }
    return {
      ...signal,
      action: "hold",
      aiReview: review,
      reasons: [...signal.reasons, `AI review vetoed the buy: ${review.reason}`]
    };
  } catch (error) {
    const review: AiTradeReview = {
      decision: "veto",
      confidence: 0,
      reason: error instanceof Error ? error.message : String(error),
      riskTags: ["ai_unavailable"]
    };
    return {
      ...signal,
      action: "hold",
      aiReview: review,
      reasons: [...signal.reasons, `AI review unavailable; buy blocked because AI_REVIEW_ENABLED=true: ${review.reason}`]
    };
  }
}

function applyBacktestGuard(signal: CryptoSignal, config: BacktestGuardConfig | undefined, minBuyScore = DEFAULT_STRATEGY_CONFIG.minBuyScore): CryptoSignal {
  if (signal.action !== "buy" || !config?.enabled) {
    return signal;
  }
  const decision = evaluateBacktestGuard(config, new Date(), signal.symbol);
  if (decision.allowed) {
    return signal;
  }
  return {
    ...signal,
    action: "hold",
    reasons: [...signal.reasons, ...decision.reasons.map((reason) => `Backtest guard blocked the buy: ${reason}`)]
  };
}

function scanMessage(signal: CryptoSignal): string {
  const blockers = signal.reasons.filter(
    (reason) =>
      reason.includes("blocked") ||
      reason.includes("cooldown") ||
      reason.includes("floor") ||
      reason.includes("outside the") ||
      reason.includes("does not clear") ||
      reason.includes("below the") ||
      reason.includes("above the") ||
      reason.includes("too ")
  );
  const blocked = signal.action !== "buy" && signal.score >= DEFAULT_STRATEGY_CONFIG.minBuyScore && blockers.length > 0;
  if (blocked) {
    return `${signal.symbol} ${signal.action} rawScore=${signal.score.toFixed(1)} blocked=${blockers[0]}`;
  }
  return `${signal.symbol} ${signal.action} score=${signal.score.toFixed(1)}`;
}

function fallbackDecision(timestamp: string, candidates: CryptoSignal[]): CryptoCycleDecision {
  const signal = candidates[0] ?? {
    symbol: "NONE",
    action: "hold" as const,
    score: 0,
    entryPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    orderQuoteQty: 0,
    reasons: ["No symbols were configured"]
  };
  return {
    timestamp,
    signal,
    risk: { allowed: false, mode: "dry_run", reasons: ["No executable signal was selected"] },
    executed: false
  };
}

function parseFilledMarketBuy(exchangeResponse: unknown): { quantity: number; quoteQty: number } | { reason: string } {
  const response = exchangeResponse as { executedQty?: string; cummulativeQuoteQty?: string; status?: string };
  const status = typeof response.status === "string" ? response.status.toUpperCase() : undefined;
  if (status && status !== "FILLED") {
    return { reason: `Exchange order status is ${status}, not FILLED` };
  }

  const quantity = Number(response.executedQty);
  const quoteQty = Number(response.cummulativeQuoteQty);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(quoteQty) || quoteQty <= 0) {
    return { reason: "Exchange response is missing positive executedQty/cummulativeQuoteQty; local position was not opened" };
  }

  return { quantity, quoteQty };
}

export async function runCryptoCycle(options: CryptoCycleOptions): Promise<CryptoCycleResult> {
  const strategyConfig = options.strategyConfig ?? DEFAULT_STRATEGY_CONFIG;
  const signalStrategy = options.signalStrategy ?? emaVwapTrendStrategy;
  const candidates = await Promise.all(
    options.symbols.map(async (symbol) => {
      const bundle = await options.broker.fetchMarket(symbol);
      const analysis = analyzeMarket({ symbol, ...bundle, strategyConfig });
      return signalStrategy.generateSignal({ analysis, orderQuoteQty: options.riskConfig.maxOrderUsdt, config: strategyConfig });
    })
  );
  const entries = options.journal.read().entries;
  const workingEntries = [...entries];
  const cooldownMinutes = strategyConfig.entryCooldownMinutes;
  const timestamp = new Date().toISOString();
  const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);
  const openPositions = workingEntries.filter((entry) => entry.open && entry.side === "BUY").length;
  const availableSlots = Math.max(0, options.riskConfig.maxOpenPositions - openPositions);
  const targetExecutions = options.riskConfig.liveTrading ? availableSlots : 0;
  const maxDryRunDecisions = Math.max(1, options.riskConfig.maxOpenPositions);
  const decisions: CryptoCycleDecision[] = [];

  for (const candidate of sortedCandidates) {
    if (options.riskConfig.liveTrading && targetExecutions <= 0 && decisions.length >= 1) {
      break;
    }
    if (options.riskConfig.liveTrading && targetExecutions > 0 && decisions.filter((decision) => decision.executed).length >= targetExecutions) {
      break;
    }
    if (!options.riskConfig.liveTrading && decisions.length >= maxDryRunDecisions) {
      break;
    }

    const deterministicSignal = applyEntryCooldown(candidate, workingEntries, cooldownMinutes, strategyConfig.minBuyScore);
    const aiReviewedSignal = await applyAiReview(deterministicSignal, options.aiReviewConfig, options.aiReviewer, strategyConfig.minBuyScore);
    const signal = applyBacktestGuard(aiReviewedSignal, options.backtestGuardConfig, strategyConfig.minBuyScore);
    const risk = evaluateRisk(signal, options.riskConfig, workingEntries);
    options.eventLog?.append({
      timestamp,
      type: "scan",
      symbol: signal.symbol,
      score: signal.score,
      price: signal.entryPrice,
      quoteQty: signal.orderQuoteQty,
      message: scanMessage(signal),
      details: signal.aiReview ? { aiReview: signal.aiReview } : undefined
    });

    if (!risk.allowed) {
      options.eventLog?.append({
        timestamp,
        type: "risk_block",
        symbol: signal.symbol,
        score: signal.score,
        price: signal.entryPrice,
        quoteQty: signal.orderQuoteQty,
        message: risk.reasons.join("; ") || "Risk manager blocked the signal",
        details: risk
      });

      if (signal.action === "buy") {
        const entry = options.journal.append({
          symbol: signal.symbol,
          side: "BUY",
          price: signal.entryPrice,
          quoteQty: signal.orderQuoteQty,
          realizedPnlUsdt: 0,
          open: false,
          timestamp,
          mode: risk.mode,
          notes: [...signal.reasons, ...risk.reasons]
        });
        workingEntries.unshift(entry);
      }

      decisions.push({ timestamp, signal, risk, executed: false });
      continue;
    }

    const rules = await options.broker.getRules(signal.symbol);
    const order = roundOrderToRules(
      { symbol: signal.symbol, side: "BUY", quoteOrderQty: signal.orderQuoteQty, lastPrice: signal.entryPrice },
      rules
    );
    await options.broker.testMarketOrder(order);
    const exchangeResponse = await options.broker.placeMarketOrder(order);
    const fill = parseFilledMarketBuy(exchangeResponse);

    if ("reason" in fill) {
      options.eventLog?.append({
        timestamp,
        type: "error",
        symbol: signal.symbol,
        score: signal.score,
        price: signal.entryPrice,
        quoteQty: signal.orderQuoteQty,
        message: fill.reason,
        details: { order, exchangeResponse }
      });
      decisions.push({ timestamp, signal, risk, executed: false, order, exchangeResponse });
      continue;
    }

    const entry = options.journal.append({
      symbol: signal.symbol,
      side: "BUY",
      price: signal.entryPrice,
      quantity: fill.quantity,
      quoteQty: fill.quoteQty,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      realizedPnlUsdt: 0,
      open: true,
      timestamp,
      mode: "live",
      notes: signal.reasons
    });
    workingEntries.unshift(entry);
    options.eventLog?.append({
      timestamp,
      type: "buy",
      symbol: signal.symbol,
      score: signal.score,
      price: signal.entryPrice,
      quantity: fill.quantity,
      quoteQty: fill.quoteQty,
      message: `LIVE BUY ${signal.symbol} score=${signal.score.toFixed(1)}`,
      details: { order, exchangeResponse, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit }
    });

    decisions.push({ timestamp, signal, risk, executed: true, order, exchangeResponse });
  }

  const primary = decisions.find((decision) => decision.executed) ?? decisions[0] ?? fallbackDecision(timestamp, sortedCandidates);
  return {
    ...primary,
    decisions,
    executedCount: decisions.filter((decision) => decision.executed).length
  };
}
