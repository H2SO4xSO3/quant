import type { CryptoJournalEntry, CryptoRiskConfig, CryptoRiskDecision, CryptoSignal } from "./types";

function isToday(timestamp: string): boolean {
  return new Date(timestamp).toDateString() === new Date().toDateString();
}

export function evaluateRisk(signal: CryptoSignal, config: CryptoRiskConfig, entries: CryptoJournalEntry[]): CryptoRiskDecision {
  const reasons: string[] = [];
  const mode = config.liveTrading ? "live" : "dry_run";

  if (!config.liveTrading) {
    reasons.push("LIVE_TRADING is off; the signal is recorded only and no real buy order will be sent");
  }
  if (signal.action !== "buy") {
    reasons.push("Strategy did not produce a buy signal");
  }
  if (signal.orderQuoteQty > config.maxOrderUsdt) {
    reasons.push(`Order amount ${signal.orderQuoteQty}U is above the ${config.maxOrderUsdt}U limit`);
  }

  const maxPositionLossUsdt = config.maxPositionLossUsdt ?? 3;
  const plannedLoss =
    signal.entryPrice > 0 ? ((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * signal.orderQuoteQty : 0;
  if (plannedLoss > maxPositionLossUsdt + 0.01) {
    reasons.push(`Planned loss ${plannedLoss.toFixed(2)}U is above the ${maxPositionLossUsdt}U per-position cap`);
  }

  const dailyPnl = entries.filter((entry) => isToday(entry.timestamp)).reduce((sum, entry) => sum + entry.realizedPnlUsdt, 0);
  if (dailyPnl <= -Math.abs(config.dailyMaxLossUsdt)) {
    reasons.push(`Daily loss limit ${config.dailyMaxLossUsdt}U has already been reached`);
  }

  const openPositions = entries.filter((entry) => entry.open && entry.side === "BUY");
  if (openPositions.length >= config.maxOpenPositions) {
    reasons.push(`There are already ${openPositions.length} open position(s), reaching the max open-position limit`);
  }
  if (openPositions.some((entry) => entry.symbol === signal.symbol)) {
    reasons.push(`${signal.symbol} already has an open position`);
  }

  return { allowed: reasons.length === 0, mode, reasons };
}
