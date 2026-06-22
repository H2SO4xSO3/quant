import { roundOrderToRules } from "./filters";
import type { CryptoBroker } from "./engine";
import type { TradeEventLog } from "./eventLog";
import type { CryptoJournal } from "./journal";
import type { CryptoJournalEntry, CryptoRiskConfig, CryptoStrategyConfig, NormalizedOrder } from "./types";

export type ExitTrigger = "stop_loss" | "take_profit" | "trailing_stop" | "timeout";

export interface ExitMonitorResult {
  timestamp: string;
  action: "none" | "watching" | "triggered";
  trigger?: ExitTrigger;
  entry?: CryptoJournalEntry;
  currentPrice?: number;
  executed: boolean;
  order?: NormalizedOrder;
  reason: string;
  exchangeResponse?: unknown;
  results?: ExitMonitorResult[];
  executedCount?: number;
}

function triggerFor(entry: CryptoJournalEntry, currentPrice: number, strategy?: CryptoStrategyConfig, now = Date.now()): ExitTrigger | undefined {
  if (entry.stopLoss && currentPrice <= entry.stopLoss) {
    return "stop_loss";
  }
  if (entry.takeProfit && currentPrice >= entry.takeProfit) {
    return "take_profit";
  }
  if (strategy?.maxHoldingMinutes && strategy.maxHoldingMinutes > 0) {
    const entryTime = Date.parse(entry.timestamp);
    if (Number.isFinite(entryTime) && now - entryTime >= strategy.maxHoldingMinutes * 60 * 1000) {
      return "timeout";
    }
  }
  return undefined;
}

function realizedPnl(entry: CryptoJournalEntry, currentPrice: number): number {
  const quantity = entry.quantity ?? 0;
  const entryPrice = entry.price ?? currentPrice;
  return (currentPrice - entryPrice) * quantity;
}

function updateProtectiveStop(entry: CryptoJournalEntry, currentPrice: number, strategy?: CryptoStrategyConfig): CryptoJournalEntry {
  if (!strategy || !entry.price || !entry.stopLoss || currentPrice <= entry.price) {
    return entry;
  }

  const profitPct = ((currentPrice - entry.price) / entry.price) * 100;
  let nextStop = entry.stopLoss;

  if (profitPct >= strategy.breakevenTriggerPct) {
    nextStop = Math.max(nextStop, entry.price * (1 + strategy.feeRate * 2));
  }
  if (profitPct >= strategy.trailingStopTriggerPct) {
    nextStop = Math.max(nextStop, currentPrice * (1 - strategy.trailingStopGivebackPct / 100));
  }

  return nextStop > entry.stopLoss ? { ...entry, stopLoss: nextStop } : entry;
}

function triggerLabel(trigger: ExitTrigger): string {
  switch (trigger) {
    case "stop_loss":
      return "Stop-loss";
    case "take_profit":
      return "Take-profit";
    case "trailing_stop":
      return "Trailing stop";
    case "timeout":
      return "Timeout";
  }
}

function primaryResult(timestamp: string, results: ExitMonitorResult[]): ExitMonitorResult {
  const primary = results.find((result) => result.executed) ?? results.find((result) => result.action === "triggered") ?? results[0];
  return {
    ...primary,
    timestamp,
    results,
    executedCount: results.filter((result) => result.executed).length
  };
}

export async function runExitMonitor(options: {
  broker: CryptoBroker;
  journal: CryptoJournal;
  riskConfig: CryptoRiskConfig;
  strategyConfig?: CryptoStrategyConfig;
  eventLog?: TradeEventLog;
}): Promise<ExitMonitorResult> {
  const timestamp = new Date().toISOString();
  const entries = options.journal.read().entries;
  const openEntries = entries.filter((entry) => entry.open && entry.side === "BUY");

  if (!openEntries.length) {
    const result = { timestamp, action: "none" as const, executed: false, reason: "No open spot position in the local journal" };
    options.eventLog?.append({ timestamp, type: "sell_check", message: result.reason });
    return result;
  }

  const results: ExitMonitorResult[] = [];
  for (const rawEntry of openEntries) {
    let openEntry = rawEntry;
    if (!openEntry.quantity || openEntry.quantity <= 0) {
      const result = { timestamp, action: "watching" as const, entry: openEntry, executed: false, reason: "Open position is missing quantity; auto-sell is disabled" };
      options.eventLog?.append({ timestamp, type: "sell_check", symbol: openEntry.symbol, message: result.reason, details: openEntry });
      results.push(result);
      continue;
    }

    if (!openEntry.stopLoss || !openEntry.takeProfit) {
      const result = {
        timestamp,
        action: "watching" as const,
        entry: openEntry,
        executed: false,
        reason: "Open position is missing stop-loss or take-profit; auto-sell is disabled"
      };
      options.eventLog?.append({ timestamp, type: "sell_check", symbol: openEntry.symbol, message: result.reason, details: openEntry });
      results.push(result);
      continue;
    }

    const currentPrice = await options.broker.fetchTickerPrice(openEntry.symbol);
    const protectedEntry = updateProtectiveStop(openEntry, currentPrice, options.strategyConfig);
    if (protectedEntry.stopLoss !== openEntry.stopLoss && openEntry.id) {
      const previousStopLoss = openEntry.stopLoss;
      const updated = options.journal.update(openEntry.id, (entry) => ({ ...entry, stopLoss: protectedEntry.stopLoss }));
      openEntry = updated ?? protectedEntry;
      options.eventLog?.append({
        timestamp,
        type: "sell_check",
        symbol: openEntry.symbol,
        price: currentPrice,
        quantity: openEntry.quantity,
        message: `Protective stop raised from ${previousStopLoss} to ${openEntry.stopLoss}`,
        details: { previousStopLoss, nextStopLoss: openEntry.stopLoss }
      });
    }

    const trigger = triggerFor(openEntry, currentPrice, options.strategyConfig);

    if (!trigger) {
      const result = {
        timestamp,
        action: "watching" as const,
        entry: openEntry,
        currentPrice,
        executed: false,
        reason: `Current price ${currentPrice} has not hit stop ${openEntry.stopLoss}, take-profit ${openEntry.takeProfit}, or timeout`
      };
      options.eventLog?.append({
        timestamp,
        type: "sell_check",
        symbol: openEntry.symbol,
        price: currentPrice,
        quantity: openEntry.quantity,
        message: result.reason
      });
      results.push(result);
      continue;
    }

    if (!options.riskConfig.liveTrading) {
      const result = {
        timestamp,
        action: "triggered" as const,
        trigger,
        entry: openEntry,
        currentPrice,
        executed: false,
        reason: "LIVE_EXIT_TRADING is off; sell trigger detected but no real order was sent"
      };
      options.eventLog?.append({
        timestamp,
        type: "sell_check",
        symbol: openEntry.symbol,
        price: currentPrice,
        quantity: openEntry.quantity,
        message: result.reason,
        details: { trigger }
      });
      results.push(result);
      continue;
    }

    const quantity = Number(openEntry.quantity);
    let order: NormalizedOrder;
    let exchangeResponse: unknown;
    try {
      const rules = await options.broker.getRules(openEntry.symbol);
      order = roundOrderToRules(
        { symbol: openEntry.symbol, side: "SELL", quantity, lastPrice: currentPrice },
        rules
      );
      await options.broker.testMarketOrder(order);
      exchangeResponse = await options.broker.placeMarketOrder(order);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = {
        timestamp,
        action: "triggered" as const,
        trigger,
        entry: openEntry,
        currentPrice,
        executed: false,
        reason: `Sell trigger detected, but order was not sent: ${reason}`
      };
      options.eventLog?.append({
        timestamp,
        type: "error",
        symbol: openEntry.symbol,
        price: currentPrice,
        quantity: openEntry.quantity,
        message: result.reason,
        details: { trigger, error: reason }
      });
      results.push(result);
      continue;
    }
    const pnl = realizedPnl(openEntry, currentPrice);
    const label = triggerLabel(trigger);

    if (openEntry.id) {
      options.journal.update(openEntry.id, (entry) => ({ ...entry, open: false, realizedPnlUsdt: pnl }));
    }
    options.journal.append({
      symbol: openEntry.symbol,
      side: "SELL",
      price: currentPrice,
      quantity,
      quoteQty: currentPrice * quantity,
      realizedPnlUsdt: pnl,
      open: false,
      timestamp,
      mode: "live",
      notes: [`${label} sell executed`]
    });
    options.eventLog?.append({
      timestamp,
      type: "sell",
      symbol: openEntry.symbol,
      price: currentPrice,
      quantity,
      quoteQty: currentPrice * quantity,
      realizedPnlUsdt: pnl,
      message: `LIVE SELL ${label.toLowerCase()} executed`,
      details: { trigger, order, exchangeResponse }
    });

    results.push({
      timestamp,
      action: "triggered",
      trigger,
      entry: openEntry,
      currentPrice,
      executed: true,
      order,
      reason: `${label} triggered and sold`,
      exchangeResponse
    });
  }

  return primaryResult(timestamp, results);
}
