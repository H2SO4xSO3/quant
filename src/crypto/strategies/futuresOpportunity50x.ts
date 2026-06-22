import { emaVwapTrendStrategy } from "../strategy";
import type { CryptoStrategy } from "../strategyTypes";
import type { CryptoSignal } from "../types";
import { vwapBreakdownShortStrategy } from "./vwapBreakdownShort";

function ranked(signals: CryptoSignal[]): CryptoSignal[] {
  return [...signals].sort((a, b) => b.score - a.score);
}

export function chooseBestOpportunitySignal(signals: CryptoSignal[]): CryptoSignal {
  const executable = ranked(signals).find((signal) => signal.action === "buy" || signal.action === "sell");
  if (executable) {
    return {
      ...executable,
      reasons: [...executable.reasons, `50x opportunity selector picked ${executable.action} score=${executable.score.toFixed(1)}`]
    };
  }

  const strongest = ranked(signals)[0];
  if (strongest) {
    return {
      ...strongest,
      action: "hold",
      reasons: ["No executable 50x opportunity passed current long/short gates", ...strongest.reasons]
    };
  }

  return {
    symbol: "NONE",
    action: "hold",
    score: 0,
    entryPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    orderQuoteQty: 0,
    reasons: ["No executable 50x opportunity passed current long/short gates"]
  };
}

export const futuresOpportunity50xStrategy: CryptoStrategy = {
  id: "futures-opportunity-50x",
  label: "Futures 50x long-or-short opportunity selector",
  generateSignal: (input) => chooseBestOpportunitySignal([
    emaVwapTrendStrategy.generateSignal(input),
    vwapBreakdownShortStrategy.generateSignal(input)
  ])
};